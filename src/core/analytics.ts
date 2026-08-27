import type { Database } from "bun:sqlite";

const TOK = "(input + output + cache_w5 + cache_w1 + cache_read)";

export interface Filters { from?: string; to?: string; project?: string; model?: string; provider?: string }

function where(f: Filters, alias = "m", sAlias = "s"): { sql: string; args: unknown[] } {
  const parts: string[] = [];
  const args: unknown[] = [];
  if (f.from) { parts.push(`${alias}.ts >= ?`); args.push(f.from); }
  if (f.to) { parts.push(`${alias}.ts <= ?`); args.push(f.to); }
  if (f.project) { parts.push(`${sAlias}.project = ?`); args.push(f.project); }
  if (f.model) { parts.push(`${alias}.model = ?`); args.push(f.model); }
  if (f.provider) { parts.push(`${alias}.provider = ?`); args.push(f.provider); }
  return { sql: parts.length ? "WHERE " + parts.join(" AND ") : "", args };
}

/**
 * Valores disponibles para los desplegables. SIN filtrar a proposito: si se filtrara,
 * elegir un proveedor sin datos vaciaria su propio desplegable y no habria como volver.
 */
/** Subconsulta con los ids de sesion que pasan el filtro. La reutilizan skills y actividad. */
export function whereSessions(f: Filters): { sql: string; args: unknown[] } {
  const w = where(f);
  return {
    sql: `SELECT DISTINCT m.session_id FROM messages m JOIN sessions s ON s.id = m.session_id ${w.sql}`,
    args: w.args,
  };
}

/**
 * Las tool calls se acotan por sesion Y por tiempo. Solo por sesion, una sesion que
 * roza el rango metia todas sus llamadas, incluidas las de fuera.
 */
export function whereTools(f: Filters): { sql: string; args: unknown[] } {
  const ws = whereSessions(f);
  const parts = [`t.session_id IN (${ws.sql})`];
  const args = [...ws.args];
  if (f.from) { parts.push("t.ts >= ?"); args.push(f.from); }
  if (f.to) { parts.push("t.ts <= ?"); args.push(f.to); }
  return { sql: parts.join(" AND "), args };
}

export function facets(db: Database) {
  return {
    providers: db.query("SELECT provider, count(DISTINCT session_id) AS sessions FROM messages GROUP BY provider ORDER BY sessions DESC").all(),
    projects: db.query(`SELECT s.project, count(DISTINCT s.id) AS sessions
                        FROM sessions s JOIN messages m ON m.session_id = s.id
                        WHERE s.project IS NOT NULL GROUP BY s.project ORDER BY sessions DESC`).all(),
  };
}

export function overview(db: Database, f: Filters = {}) {
  const w = where(f);
  const totals = db.query(`
    SELECT count(DISTINCT m.session_id) AS sessions, count(*) AS messages,
           sum(m.input) AS input, sum(m.output) AS output,
           sum(m.cache_w5 + m.cache_w1) AS cache_write, sum(m.cache_read) AS cache_read,
           sum(${TOK}) AS tokens, sum(m.cost_usd) AS cost,
           sum(CASE WHEN m.priced = 0 AND m.model IS NOT NULL THEN 1 ELSE 0 END) AS unpriced
    FROM messages m JOIN sessions s ON s.id = m.session_id ${w.sql}`).get(...w.args);

  // los periodos son absolutos (hoy, 7d, 30d) pero si se filtra por proveedor, lo respetan
  const pw = f.provider ? " AND m.provider = ?" : "";
  const pa = f.provider ? [f.provider] : [];
  const period = (days: number) => {
    const from = new Date(Date.now() - days * 864e5).toISOString();
    return db.query("SELECT coalesce(sum(cost_usd),0) AS cost, coalesce(sum(" + TOK + "),0) AS tokens " +
      "FROM messages m WHERE m.ts >= ?" + pw).get(from, ...pa);
  };
  const today = new Date().toISOString().slice(0, 10);

  return {
    totals,
    today: db.query("SELECT coalesce(sum(cost_usd),0) AS cost, coalesce(sum(" + TOK + "),0) AS tokens " +
      "FROM messages m WHERE substr(m.ts,1,10) = ?" + pw).get(today, ...pa),
    week: period(7),
    month: period(30),
    models: db.query(`SELECT m.model, count(*) AS messages, sum(${TOK}) AS tokens, sum(m.cost_usd) AS cost,
                      max(m.priced) AS priced FROM messages m JOIN sessions s ON s.id=m.session_id
                      ${w.sql} ${w.sql ? "AND" : "WHERE"} m.model IS NOT NULL
                      GROUP BY m.model ORDER BY cost DESC`).all(...w.args),
    byProvider: db.query(`SELECT m.provider, count(DISTINCT m.session_id) AS sessions, count(*) AS messages,
                          sum(${TOK}) AS tokens, sum(m.cost_usd) AS cost,
                          min(CASE WHEN m.model IS NOT NULL THEN m.priced END) AS all_priced
                          FROM messages m JOIN sessions s ON s.id=m.session_id ${w.sql}
                          GROUP BY m.provider ORDER BY tokens DESC`).all(...w.args),
    projects: db.query(`SELECT s.project, count(DISTINCT s.id) AS sessions, sum(${TOK}) AS tokens, sum(m.cost_usd) AS cost
                        FROM messages m JOIN sessions s ON s.id=m.session_id ${w.sql}
                        GROUP BY s.project ORDER BY cost DESC`).all(...w.args),
  };
}

export function daily(db: Database, f: Filters = {}) {
  const w = where(f);
  return db.query(`SELECT substr(m.ts,1,10) AS day, sum(m.cost_usd) AS cost, sum(${TOK}) AS tokens,
                   count(DISTINCT m.session_id) AS sessions
                   FROM messages m JOIN sessions s ON s.id=m.session_id ${w.sql}
                   ${w.sql ? "AND" : "WHERE"} m.ts IS NOT NULL
                   GROUP BY day ORDER BY day`).all(...w.args);
}

export function bucketed(db: Database, unit: "week" | "month", f: Filters = {}) {
  const expr = unit === "week" ? "strftime('%Y-W%W', m.ts)" : "substr(m.ts,1,7)";
  const w = where(f);
  return db.query(`SELECT ${expr} AS bucket, sum(m.cost_usd) AS cost, sum(${TOK}) AS tokens,
                   count(DISTINCT m.session_id) AS sessions
                   FROM messages m JOIN sessions s ON s.id=m.session_id ${w.sql}
                   ${w.sql ? "AND" : "WHERE"} m.ts IS NOT NULL
                   GROUP BY bucket ORDER BY bucket`).all(...w.args);
}

export function sessions(db: Database, f: Filters & { limit?: number; offset?: number; sort?: string; q?: string } = {}) {
  // El filtro corta MENSAJES, no sesiones: si cortara sesiones, una que roza el rango
  // aportaria su coste entero y la suma no cuadraria con el total de Overview.
  const parts: string[] = ["m.session_id IS NOT NULL"];
  const args: unknown[] = [];
  if (f.from) { parts.push("m.ts >= ?"); args.push(f.from); }
  if (f.to) { parts.push("m.ts <= ?"); args.push(f.to); }
  if (f.project) { parts.push("s.project = ?"); args.push(f.project); }
  if (f.provider) { parts.push("m.provider = ?"); args.push(f.provider); }
  if (f.model) { parts.push("m.model = ?"); args.push(f.model); }
  if (f.q) { parts.push("(s.title LIKE ? OR s.id LIKE ?)"); args.push(`%${f.q}%`, `%${f.q}%`); }

  const t = whereTools(f);
  const sortCol = { cost: "cost", tokens: "tokens", date: "last_ts", tools: "tools" }[f.sort ?? "date"] ?? "last_ts";
  const limit = Math.min(f.limit ?? 100, 1000);

  return db.query(`
    SELECT s.id, s.project, s.title, s.git_branch, s.version, s.provider,
           coalesce(min(m.ts), s.first_ts) AS first_ts,
           coalesce(max(m.ts), s.last_ts) AS last_ts,
           (julianday(max(m.ts)) - julianday(min(m.ts))) * 86400 AS duration_s,
           count(*) AS messages, sum(${TOK}) AS tokens, sum(m.cost_usd) AS cost,
           group_concat(DISTINCT m.model) AS models,
           (SELECT count(*) FROM tool_calls t WHERE ${t.sql} AND t.session_id = s.id) AS tools
    FROM sessions s JOIN messages m ON m.session_id = s.id
    WHERE ${parts.join(" AND ")}
    GROUP BY s.id ORDER BY ${sortCol} DESC LIMIT ? OFFSET ?`).all(...t.args, ...args, limit, f.offset ?? 0);
}

export function sessionDetail(db: Database, id: string) {
  const head = db.query("SELECT * FROM sessions WHERE id = ?").get(id);
  if (!head) return null;
  return {
    session: head,
    metrics: db.query(`SELECT count(*) AS messages, sum(input) AS input, sum(output) AS output,
                       sum(cache_w5+cache_w1) AS cache_write, sum(cache_read) AS cache_read,
                       sum(${TOK}) AS tokens, sum(cost_usd) AS cost,
                       sum(is_sidechain) AS sidechain_messages
                       FROM messages WHERE session_id = ?`).get(id),
    byModel: db.query(`SELECT model, count(*) AS messages, sum(${TOK}) AS tokens, sum(cost_usd) AS cost
                       FROM messages WHERE session_id = ? AND model IS NOT NULL GROUP BY model ORDER BY cost DESC`).all(id),
    tools: db.query("SELECT name, count(*) AS n FROM tool_calls WHERE session_id = ? GROUP BY name ORDER BY n DESC").all(id),
    skills: db.query("SELECT skill, count(*) AS n FROM tool_calls WHERE session_id = ? AND skill IS NOT NULL GROUP BY skill ORDER BY n DESC").all(id),
    subagents: db.query("SELECT subagent, count(*) AS n FROM tool_calls WHERE session_id = ? AND subagent IS NOT NULL GROUP BY subagent ORDER BY n DESC").all(id),
    timeline: db.query(`SELECT substr(ts,1,13) AS hour, count(*) AS messages, sum(cost_usd) AS cost
                        FROM messages WHERE session_id = ? AND ts IS NOT NULL GROUP BY hour ORDER BY hour`).all(id),
  };
}

export function activity(db: Database, f: Filters = {}) {
  const w = where(f);
  const t = whereTools(f);
  const scoped = (extra: string) => `SELECT ${extra} FROM tool_calls t WHERE ${t.sql}`;
  return {
    recentSessions: db.query(`SELECT s.id, s.project, s.title, s.last_ts, sum(m.cost_usd) AS cost, sum(${TOK}) AS tokens
                              FROM sessions s JOIN messages m ON m.session_id=s.id ${w.sql}
                              GROUP BY s.id ORDER BY s.last_ts DESC LIMIT 15`).all(...w.args),
    tools: db.query(scoped("t.name AS name, count(*) AS n") + " GROUP BY t.name ORDER BY n DESC LIMIT 30").all(...t.args),
    mcp: db.query(scoped("t.mcp_server AS server, t.mcp_tool AS tool, count(*) AS n") +
      " AND t.mcp_server IS NOT NULL GROUP BY server, tool ORDER BY n DESC LIMIT 25").all(...t.args),
    skills: db.query(scoped("t.skill AS skill, count(*) AS n") +
      " AND t.skill IS NOT NULL GROUP BY t.skill ORDER BY n DESC").all(...t.args),
    subagents: db.query(scoped("t.subagent AS subagent, count(*) AS n") +
      " AND t.subagent IS NOT NULL GROUP BY t.subagent ORDER BY n DESC").all(...t.args),
    byHour: db.query(`SELECT cast(substr(m.ts,12,2) AS INTEGER) AS hour, count(*) AS n
                      FROM messages m JOIN sessions s ON s.id=m.session_id ${w.sql}
                      ${w.sql ? "AND" : "WHERE"} m.ts IS NOT NULL GROUP BY hour ORDER BY hour`).all(...w.args),
    byWeekday: db.query(`SELECT strftime('%w', m.ts) AS weekday, count(*) AS n
                         FROM messages m JOIN sessions s ON s.id=m.session_id ${w.sql}
                         ${w.sql ? "AND" : "WHERE"} m.ts IS NOT NULL GROUP BY weekday ORDER BY weekday`).all(...w.args),
  };
}

export function graph(db: Database, limit = 60) {
  const nodes = new Map<string, { id: string; label: string; kind: string; weight: number }>();
  const links: Array<{ source: string; target: string; weight: number }> = [];
  const add = (id: string, label: string, kind: string, w: number) => {
    const cur = nodes.get(id);
    if (cur) cur.weight += w; else nodes.set(id, { id, label, kind, weight: w });
  };

  const rows = db.query<{ project: string; name: string; kind: string; n: number }, [number]>(`
    SELECT s.project AS project, t.name AS name, 'tool' AS kind, count(*) AS n
    FROM tool_calls t JOIN sessions s ON s.id = t.session_id
    WHERE t.skill IS NULL GROUP BY project, name
    UNION ALL
    SELECT s.project, t.skill, 'skill', count(*) FROM tool_calls t JOIN sessions s ON s.id = t.session_id
    WHERE t.skill IS NOT NULL GROUP BY 1,2
    UNION ALL
    SELECT s.project, t.subagent, 'subagent', count(*) FROM tool_calls t JOIN sessions s ON s.id = t.session_id
    WHERE t.subagent IS NOT NULL GROUP BY 1,2
    ORDER BY n DESC LIMIT ?`).all(limit);

  for (const r of rows) {
    if (!r.project || !r.name) continue;
    const p = `project:${r.project}`, n = `${r.kind}:${r.name}`;
    add(p, r.project, "project", r.n);
    add(n, r.name, r.kind, r.n);
    links.push({ source: p, target: n, weight: r.n });
  }
  return { nodes: [...nodes.values()], links };
}
