import type { Database } from "bun:sqlite";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join, basename } from "node:path";
import { HOME, isDenied } from "../core/paths";
import { streamLines, num } from "../core/jsonl";
import { costOf } from "../core/pricing";
import { redact } from "../core/redact";
import type { Provider, Usage } from "../core/types";

/**
 * Adapter de OpenAI Codex CLI.
 *
 * Formato verificado contra el codigo fuente de openai/codex (no de memoria):
 *   - `codex-rs/history/src/lib.rs`  -> RolloutLine { timestamp, ordinal?, #[serde(flatten)] item }
 *     y RolloutItem se serializa etiquetado como { type, payload }.
 *   - `codex-rs/protocol/src/protocol.rs` -> SessionMeta { session_id, id, timestamp, cwd,
 *     originator, cli_version, source, parent_thread_id, agent_role... }
 *     y TokenUsage { input_tokens, cached_input_tokens, cache_write_input_tokens,
 *     output_tokens, reasoning_output_tokens, total_tokens }
 *     dentro de TokenUsageInfo { total_token_usage, last_token_usage, model_context_window }.
 *
 * Los archivos viven en ~/.codex/sessions/YYYY/MM/DD/rollout-<ISO>-<uuid>.jsonl
 * (y ~/.codex/archived_sessions).
 *
 * TRAMPA IMPORTANTE: `total_token_usage` es ACUMULADO de la sesion, no del turno.
 * Sumar todos los eventos `token_count` multiplica el consumo por el numero de turnos.
 * Aqui se toma el maximo por sesion. (Es el bug que le exploto a ccusage, issue #950.)
 */
export const CODEX_ROOTS = [
  join(HOME, ".codex"),
  join(HOME, ".config", "codex"),
];

function sessionDirs(root: string): string[] {
  return [join(root, "sessions"), join(root, "archived_sessions")].filter(existsSync);
}

function activeRoot(): string | null {
  return CODEX_ROOTS.find((r) => existsSync(r)) ?? null;
}

/** Recorre YYYY/MM/DD sin asumir la profundidad exacta: busca cualquier .jsonl. */
function walkJsonl(dir: string, depth = 5): string[] {
  const out: string[] = [];
  if (depth < 0 || !existsSync(dir)) return out;
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...walkJsonl(p, depth - 1));
    else if (e.name.endsWith(".jsonl") && !isDenied(p)) out.push(p);
  }
  return out;
}

export function listRollouts(root = activeRoot()): string[] {
  if (!root) return [];
  return sessionDirs(root).flatMap((d) => walkJsonl(d));
}

const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

function usageFrom(tu: Record<string, unknown>): Usage {
  // el input reportado ya incluye el cacheado: se resta para no contarlo dos veces
  const input = num(tu["input_tokens"]);
  const cached = num(tu["cached_input_tokens"]);
  return {
    input: Math.max(0, input - cached),
    output: num(tu["output_tokens"]) + num(tu["reasoning_output_tokens"]),
    cacheWrite5m: num(tu["cache_write_input_tokens"]),
    cacheWrite1h: 0,
    cacheRead: cached,
    webSearches: 0,
    webFetches: 0,
  };
}

const totalOf = (u: Usage) => u.input + u.output + u.cacheWrite5m + u.cacheWrite1h + u.cacheRead;

export interface Rollout {
  sessionId: string;
  cwd: string | null;
  cliVersion: string | null;
  originator: string | null;
  model: string | null;
  effort: string | null;
  firstTs: string | null;
  lastTs: string | null;
  title: string | null;
  isSubagent: boolean;
  usage: Usage;
  tools: Map<string, number>;
  turns: number;
}

/** Parsea un rollout completo (o el trozo nuevo) sin cargarlo entero en memoria. */
export function parseRollout(path: string, offset: number, acc?: Rollout): { end: number; rollout: Rollout } {
  const r: Rollout = acc ?? {
    sessionId: basename(path, ".jsonl"),
    cwd: null, cliVersion: null, originator: null, model: null, effort: null,
    firstTs: null, lastTs: null, title: null, isSubagent: false,
    usage: { input: 0, output: 0, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0, webSearches: 0, webFetches: 0 },
    tools: new Map(), turns: 0,
  };

  const end = streamLines(path, offset, (line) => {
    let o: Record<string, unknown>;
    try { o = JSON.parse(line) as Record<string, unknown>; } catch { return; }

    const ts = typeof o["timestamp"] === "string" ? o["timestamp"] : null;
    if (ts) {
      if (!r.firstTs || ts < r.firstTs) r.firstTs = ts;
      if (!r.lastTs || ts > r.lastTs) r.lastTs = ts;
    }
    const payload = obj(o["payload"]);

    switch (o["type"]) {
      case "session_meta": {
        // el id real vive en el payload; el nombre del archivo es solo un respaldo
        const id = payload["id"] ?? payload["session_id"];
        if (typeof id === "string") r.sessionId = id;
        if (typeof payload["cwd"] === "string") r.cwd = payload["cwd"];
        if (typeof payload["cli_version"] === "string") r.cliVersion = payload["cli_version"];
        if (typeof payload["originator"] === "string") r.originator = payload["originator"];
        if (payload["parent_thread_id"] || payload["agent_role"] || payload["agent_nickname"]) r.isSubagent = true;
        break;
      }
      case "turn_context": {
        const settings = obj(obj(payload["collaboration_mode"])["settings"]);
        const model = payload["model"] ?? settings["model"];
        if (typeof model === "string") r.model = model;
        const effort = payload["reasoning_effort"] ?? settings["reasoning_effort"];
        if (typeof effort === "string") r.effort = effort;
        if (typeof payload["cwd"] === "string" && !r.cwd) r.cwd = payload["cwd"];
        r.turns++;
        break;
      }
      case "event_msg": {
        if (payload["type"] !== "token_count") break;
        const info = obj(payload["info"]);
        const tu = obj(info["total_token_usage"]);
        if (!Object.keys(tu).length) break;
        // ACUMULADO: se queda el mayor, nunca se suma
        const next = usageFrom(tu);
        if (totalOf(next) >= totalOf(r.usage)) r.usage = next;
        break;
      }
      case "response_item": {
        const t = payload["type"];
        if (t === "function_call" || t === "local_shell_call" || t === "custom_tool_call") {
          const name = typeof payload["name"] === "string" ? payload["name"]
            : t === "local_shell_call" ? "shell" : "tool";
          r.tools.set(name, (r.tools.get(name) ?? 0) + 1);
        } else if (t === "message" && payload["role"] === "user" && !r.title) {
          const c = payload["content"];
          const text = typeof c === "string" ? c
            : Array.isArray(c) ? (c.find((b) => typeof (b as { text?: string })?.text === "string") as { text?: string } | undefined)?.text
            : undefined;
          if (text && !text.startsWith("<")) r.title = redact(text).replace(/\s+/g, " ").slice(0, 200);
        }
        break;
      }
    }
  });

  return { end, rollout: r };
}

export const codexProvider: Provider = {
  id: "codex",
  label: "OpenAI Codex CLI",

  detect() {
    const root = activeRoot();
    if (!root) return { installed: false, root: null, note: "codex.absent" };
    const n = listRollouts(root).length;
    return n
      ? { installed: true, root, note: "codex.rollouts", noteParams: { n } }
      : { installed: true, root, note: "codex.empty" };
  },

  index(db: Database) {
    const files = listRollouts();
    if (!files.length) return { files: 0, newBytes: 0, messages: 0 };

    const getFile = db.query<{ size: number; mtime: number; offset: number }, [string]>(
      "SELECT size, mtime, offset FROM files WHERE path = ?");
    const putFile = db.query(
      "INSERT INTO files(path,provider,size,mtime,offset,indexed_at) VALUES (?,?,?,?,?,?) " +
      "ON CONFLICT(path) DO UPDATE SET size=excluded.size, mtime=excluded.mtime, offset=excluded.offset, indexed_at=excluded.indexed_at");
    const putSess = db.query(
      "INSERT INTO sessions(id,provider,project,cwd,git_branch,version,entrypoint,title,first_ts,last_ts) VALUES (?,?,?,?,?,?,?,?,?,?) " +
      "ON CONFLICT(id) DO UPDATE SET cwd=coalesce(excluded.cwd,sessions.cwd), version=coalesce(excluded.version,sessions.version), " +
      "title=coalesce(sessions.title,excluded.title), " +
      "first_ts=min(coalesce(sessions.first_ts,excluded.first_ts),coalesce(excluded.first_ts,sessions.first_ts)), " +
      "last_ts=max(coalesce(sessions.last_ts,excluded.last_ts),coalesce(excluded.last_ts,sessions.last_ts))");
    // una fila por sesion: el consumo de Codex es acumulado, no por mensaje
    const putMsg = db.query(
      "INSERT OR REPLACE INTO messages(uuid,session_id,ts,role,model,input,output,cache_w5,cache_w1,cache_read," +
      "web_searches,web_fetches,speed,inference_geo,is_sidechain,cost_usd,priced,provider) " +
      "VALUES (?,?,?,?,?,?,?,?,?,?,0,0,NULL,NULL,?,?,?,'codex')");
    const delTools = db.query("DELETE FROM tool_calls WHERE session_id = ?");
    const putTool = db.query(
      "INSERT INTO tool_calls(session_id,message_uuid,ts,name,mcp_server,mcp_tool,skill,subagent) VALUES (?,?,?,?,NULL,NULL,NULL,?)");

    let touched = 0, newBytes = 0, sessions = 0;

    for (const path of files) {
      const st = statSync(path);
      const prev = getFile.get(path);
      if (prev && st.size === prev.size && st.mtimeMs === prev.mtime) continue;
      // el consumo acumulado obliga a releer el rollout entero: no hay reanudacion parcial fiable
      const { end, rollout } = parseRollout(path, 0);
      newBytes += end;

      const tx = db.transaction(() => {
        const project = rollout.cwd ?? "(sin cwd)";
        putSess.run(rollout.sessionId, "codex", project, rollout.cwd, null,
          rollout.cliVersion, rollout.originator, rollout.title, rollout.firstTs, rollout.lastTs);

        const c = costOf(rollout.model, rollout.usage);
        putMsg.run(rollout.sessionId + ":usage", rollout.sessionId, rollout.lastTs, "assistant", rollout.model,
          rollout.usage.input, rollout.usage.output, rollout.usage.cacheWrite5m, rollout.usage.cacheWrite1h,
          rollout.usage.cacheRead, rollout.isSubagent ? 1 : 0, c.total, c.priced ? 1 : 0);

        delTools.run(rollout.sessionId);
        for (const [name, n] of rollout.tools) {
          for (let i = 0; i < n; i++) {
            putTool.run(rollout.sessionId, rollout.sessionId + ":usage", rollout.lastTs, name, null);
          }
        }
        putFile.run(path, "codex", st.size, st.mtimeMs, end, new Date().toISOString());
      });
      tx();
      touched++; sessions++;
    }

    return { files: touched, newBytes, messages: sessions };
  },
};
