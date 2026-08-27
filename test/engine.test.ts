import { test, expect } from "bun:test";
import { mkdtempSync, writeFileSync, appendFileSync, rmSync, readdirSync, statSync, mkdirSync, readFileSync } from "node:fs";
import { Database } from "bun:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { costOf, normalizeModel, rateFor, pricingStatus } from "../src/core/pricing";
import { redact, looksSecret } from "../src/core/redact";
import { isForeign, isDenied, assertReadOnly, HOME } from "../src/core/paths";
import { decodeProject } from "../src/providers/claude";
import { streamLines } from "../src/core/jsonl";
import { copyForReading, cursorProvider } from "../src/providers/cursor";
import { parseRollout, codexProvider } from "../src/providers/codex";
import { parseSession, sessionTools, opencodeProvider } from "../src/providers/opencode";
import { openDb } from "../src/core/db";
import { toCsv, sessionRows } from "../src/core/export";
import { overview, sessions as listSessions } from "../src/core/analytics";
import { overview } from "../src/core/analytics";

const U = (o: Partial<ReturnType<typeof zero>> = {}) => ({ ...zero(), ...o });
function zero() {
  return { input: 0, output: 0, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0, webSearches: 0, webFetches: 0 };
}

test("coste: ejemplo oficial de la doc (Opus 5, 50k in / 15k out = $0.625 sin runtime)", () => {
  const c = costOf("claude-opus-5", U({ input: 50_000, output: 15_000 }));
  expect(c.input).toBeCloseTo(0.25, 6);
  expect(c.output).toBeCloseTo(0.375, 6);
  expect(c.total).toBeCloseTo(0.625, 6);
});

test("coste: cache 5m y 1h usan tarifas distintas", () => {
  const w5 = costOf("claude-opus-5", U({ cacheWrite5m: 1_000_000 })).total;
  const w1 = costOf("claude-opus-5", U({ cacheWrite1h: 1_000_000 })).total;
  expect(w5).toBeCloseTo(6.25, 6);
  expect(w1).toBeCloseTo(10, 6);
  expect(costOf("claude-opus-5", U({ cacheRead: 1_000_000 })).total).toBeCloseTo(0.5, 6);
});

test("coste: fast mode y inference_geo us aplican sus multiplicadores", () => {
  expect(costOf("claude-opus-5", U({ output: 1_000_000 }), { speed: "fast" }).total).toBeCloseTo(50, 6);
  expect(costOf("claude-opus-5", U({ input: 1_000_000 }), { inferenceGeo: "us" }).total).toBeCloseTo(5.5, 6);
});

test("coste: web search se cobra por request, web fetch no", () => {
  expect(costOf("claude-opus-5", U({ webSearches: 100 })).total).toBeCloseTo(1, 6);
  expect(costOf("claude-opus-5", U({ webFetches: 100 })).total).toBeCloseTo(0, 6);
});

test("modelo desconocido no inventa coste: priced=false, total 0", () => {
  const c = costOf("claude-modelo-que-no-existe", U({ input: 1_000_000 }));
  expect(c.priced).toBe(false);
  expect(c.total).toBe(0);
});

test("normalizacion de ids de modelo", () => {
  expect(normalizeModel("claude-haiku-4-5-20251001")).toBe("claude-haiku-4-5");
  expect(normalizeModel("us.anthropic.claude-opus-5")).toBe("claude-opus-5");
  expect(rateFor("claude-sonnet-5")?.input).toBe(2);
});

test("redaccion de secretos", () => {
  const s = redact([
    "ANTHROPIC_API_KEY=sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAA",
    "token: ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123",
    "Authorization: Bearer abc.def.ghi",
    "DB_PASSWORD=hunter2000",
  ].join("\n"));
  expect(s).not.toContain("sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAA");
  expect(s).not.toContain("ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123");
  expect(s).not.toContain("hunter2000");
  expect(s).toContain("REDACTED");
  expect(looksSecret("hola mundo")).toBe(false);
});

test("la redaccion no destroza texto normal (falsos positivos)", () => {
  for (const ok of [
    "spawn-task-no-para-pasos-del-ciclo",
    "transaction-desk-action-gating-pattern",
    "el token de la sesion caduca en 5 minutos",
  ]) expect(redact(ok)).toBe(ok);
});

test("guard read-only: escribir en una raiz externa lanza", () => {
  expect(isForeign(join(HOME, ".claude", "settings.json"))).toBe(true);
  expect(isForeign(join(HOME, ".claude-otro"))).toBe(false);
  expect(isForeign("C:/laragon/www/agent-engine/data/engine.db")).toBe(false);
  expect(() => assertReadOnly(join(HOME, ".claude", "settings.json"), "write")).toThrow(/READ-ONLY/);
  expect(() => assertReadOnly(join(HOME, ".claude", "x.jsonl"), "read")).not.toThrow();
  expect(isDenied(join(HOME, ".claude", ".credentials.json"))).toBe(true);
});

test("indexacion incremental: solo lee lo nuevo y respeta lineas parciales", () => {
  const dir = mkdtempSync(join(tmpdir(), "engine-"));
  const f = join(dir, "t.jsonl");
  try {
    writeFileSync(f, '{"a":1}\n{"a":2}\n');
    const seen1: string[] = [];
    const off1 = streamLines(f, 0, (l) => seen1.push(l));
    expect(seen1.length).toBe(2);

    // segunda pasada sin cambios: nada nuevo
    const seen2: string[] = [];
    expect(streamLines(f, off1, (l) => seen2.push(l))).toBe(off1);
    expect(seen2.length).toBe(0);

    // linea incompleta: no se consume, el offset no avanza mas alla del ultimo \n
    appendFileSync(f, '{"a":3}\n{"parcial"');
    const seen3: string[] = [];
    const off2 = streamLines(f, off1, (l) => seen3.push(l));
    expect(seen3).toEqual(['{"a":3}']);

    // al completarse la linea, se lee entera y sin duplicar la anterior
    appendFileSync(f, ':true}\n');
    const seen4: string[] = [];
    streamLines(f, off2, (l) => seen4.push(l));
    expect(seen4).toEqual(['{"parcial":true}']);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("proyecto codificado se decodifica a ruta legible", () => {
  expect(decodeProject("C--laragon-www-CashShip")).toBe("C:\\laragon\\www\\CashShip");
});

test("cursor: se lee una COPIA, el original no se toca", () => {
  const src = mkdtempSync(join(tmpdir(), "cursor-src-"));
  const out = mkdtempSync(join(tmpdir(), "cursor-out-"));
  try {
    // base sqlite de juguete + su WAL, como las que deja Cursor abierto
    const orig = join(src, "state.vscdb");
    const db = new Database(orig, { create: true });
    db.exec("PRAGMA journal_mode = WAL; CREATE TABLE t(a); INSERT INTO t VALUES (1);");
    db.close();
    const before = readdirSync(src).map((f) => f + ":" + statSync(join(src, f)).size).sort();

    const copy = copyForReading(orig, out);
    expect(copy).toBe(join(out, "state.vscdb"));
    // la copia se puede abrir y leer
    const read = new Database(copy!, { readonly: true });
    expect(read.query("SELECT count(*) c FROM t").get()).toEqual({ c: 1 });
    read.close();

    // el origen sigue byte a byte igual: ni -shm nuevo ni nada
    expect(readdirSync(src).map((f) => f + ":" + statSync(join(src, f)).size).sort()).toEqual(before);
  } finally {
    rmSync(src, { recursive: true, force: true });
    rmSync(out, { recursive: true, force: true });
  }
});

test("cursor: detect() devuelve CLAVE de traduccion, no prosa", () => {
  const d = cursorProvider.detect();
  if (d.installed) expect(d.note).toMatch(/^cursor\./);
  expect(cursorProvider.id).toBe("cursor");
});

/**
 * Codex no esta instalado en esta maquina, asi que no hay datos reales contra los que
 * contrastar. El fixture reproduce el esquema verificado en el codigo de openai/codex:
 * RolloutLine {timestamp, type, payload} con session_meta / turn_context / event_msg /
 * response_item, y TokenUsage con sus nombres de campo reales.
 */
function rollout(dir: string): string {
  const f = join(dir, "rollout-2026-08-27T10-00-00-11111111-2222-3333-4444-555555555555.jsonl");
  const L = (o: unknown) => JSON.stringify(o);
  writeFileSync(f, [
    L({ timestamp: "2026-08-27T10:00:00.000Z", type: "session_meta", payload: {
      session_id: "sess-1", id: "thread-abc", timestamp: "2026-08-27T10:00:00.000Z",
      cwd: "C:/proyecto", originator: "codex_cli_rs", cli_version: "0.52.0" } }),
    L({ timestamp: "2026-08-27T10:00:01.000Z", type: "turn_context", payload: {
      model: "gpt-5.5", reasoning_effort: "high", cwd: "C:/proyecto" } }),
    L({ timestamp: "2026-08-27T10:00:02.000Z", type: "response_item", payload: {
      type: "message", role: "user", content: [{ type: "input_text", text: "arregla el parser" }] } }),
    L({ timestamp: "2026-08-27T10:00:03.000Z", type: "response_item", payload: { type: "function_call", name: "shell" } }),
    L({ timestamp: "2026-08-27T10:00:04.000Z", type: "response_item", payload: { type: "function_call", name: "shell" } }),
    L({ timestamp: "2026-08-27T10:00:05.000Z", type: "event_msg", payload: { type: "token_count", info: {
      total_token_usage: { input_tokens: 1000, cached_input_tokens: 400, cache_write_input_tokens: 100,
                           output_tokens: 200, reasoning_output_tokens: 50, total_tokens: 1250 },
      last_token_usage: { input_tokens: 1000, cached_input_tokens: 400, cache_write_input_tokens: 100,
                          output_tokens: 200, reasoning_output_tokens: 50, total_tokens: 1250 },
      model_context_window: 272000 } } }),
    // segundo turno: total_token_usage es ACUMULADO, no del turno
    L({ timestamp: "2026-08-27T10:05:00.000Z", type: "turn_context", payload: { model: "gpt-5.5" } }),
    L({ timestamp: "2026-08-27T10:05:10.000Z", type: "event_msg", payload: { type: "token_count", info: {
      total_token_usage: { input_tokens: 3000, cached_input_tokens: 1500, cache_write_input_tokens: 100,
                           output_tokens: 500, reasoning_output_tokens: 100, total_tokens: 3600 },
      last_token_usage: { input_tokens: 2000, cached_input_tokens: 1100, cache_write_input_tokens: 0,
                          output_tokens: 300, reasoning_output_tokens: 50, total_tokens: 2350 },
      model_context_window: 272000 } } }),
    "",
  ].join(String.fromCharCode(10)));
  return f;
}

test("codex: el consumo acumulado NO se suma (o se multiplica por los turnos)", () => {
  const dir = mkdtempSync(join(tmpdir(), "codex-"));
  try {
    const { rollout: r } = parseRollout(rollout(dir), 0);
    // se queda el ultimo/mayor total_token_usage, no 1000+3000
    expect(r.usage.cacheRead).toBe(1500);
    expect(r.usage.input).toBe(1500);          // 3000 reportado - 1500 ya cacheado
    expect(r.usage.output).toBe(600);          // output + reasoning
    expect(r.usage.cacheWrite5m).toBe(100);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("codex: extrae identidad, modelo, titulo y tool calls del rollout", () => {
  const dir = mkdtempSync(join(tmpdir(), "codex-"));
  try {
    const { rollout: r } = parseRollout(rollout(dir), 0);
    expect(r.sessionId).toBe("thread-abc");
    expect(r.model).toBe("gpt-5.5");
    expect(r.effort).toBe("high");
    expect(r.cwd).toBe("C:/proyecto");
    expect(r.cliVersion).toBe("0.52.0");
    expect(r.title).toBe("arregla el parser");
    expect(r.turns).toBe(2);
    expect(r.tools.get("shell")).toBe(2);
    expect(r.firstTs).toBe("2026-08-27T10:00:00.000Z");
    expect(r.lastTs).toBe("2026-08-27T10:05:10.000Z");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("coste: modelos de OpenAI, verificados contra developers.openai.com", () => {
  // gpt-5.5: $5 input / $0.50 cached / $30 output por MTok
  expect(costOf("gpt-5.5", U({ input: 1_000_000 })).total).toBeCloseTo(5, 6);
  expect(costOf("gpt-5.5", U({ cacheRead: 1_000_000 })).total).toBeCloseTo(0.5, 6);
  expect(costOf("gpt-5.5", U({ output: 1_000_000 })).total).toBeCloseTo(30, 6);
  // gpt-5.3-codex: $1.75 / $0.175 / $14, y fast a $3.50 / $28
  expect(costOf("gpt-5.3-codex", U({ input: 1_000_000 })).total).toBeCloseTo(1.75, 6);
  expect(costOf("gpt-5.3-codex", U({ output: 1_000_000 }), { speed: "fast" }).total).toBeCloseTo(28, 6);
  // OpenAI no cobra extra la ESCRITURA de cache: va a precio de input
  expect(costOf("gpt-5.5", U({ cacheWrite5m: 1_000_000 })).total).toBeCloseTo(5, 6);
  expect(costOf("gpt-5.5", U({ input: 1_000_000 })).priced).toBe(true);
});

test("codex: detect() devuelve clave de traduccion", () => {
  const d = codexProvider.detect();
  expect(d.note).toMatch(/^codex\./);
});

test("las dos fuentes de tarifas estan verificadas y fechadas", () => {
  const st = pricingStatus();
  expect(st.verified).toBe(true);
  expect(st.sources.map((s) => s.vendor).sort()).toEqual(["anthropic", "openai"]);
  for (const s of st.sources) expect(s.verifiedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
});

/**
 * OpenCode esta instalado (v1.18.10) pero nunca se ha usado: su almacen esta vacio.
 * El fixture reproduce el esquema verificado en anomalyco/opencode:
 * session/<projectID>/<id>.json con Info { tokens {input,output,reasoning,cache{read,write}},
 * cost, model {id, providerID}, time {created, updated}, summary {additions, deletions} }.
 */
function opencodeStore(root: string) {
  const store = join(root, "storage");
  const sdir = join(store, "session", "proj-1");
  mkdirSync(sdir, { recursive: true });
  writeFileSync(join(sdir, "ses_abc.json"), JSON.stringify({
    id: "ses_abc", slug: "arreglar-el-parser", projectID: "proj-1",
    directory: "C:/proyecto", title: "Arreglar el parser", agent: "build", version: "1.18.10",
    model: { id: "claude-sonnet-5", providerID: "anthropic" },
    cost: 0.4211,
    tokens: { input: 1200, output: 800, reasoning: 200, cache: { read: 50000, write: 3000 } },
    summary: { additions: 120, deletions: 30, files: 4 },
    time: { created: 1787000000000, updated: 1787000600000 },
  }));
  // v2: las partes viven aparte, indexadas por messageID
  const mdir = join(store, "message", "ses_abc");
  mkdirSync(mdir, { recursive: true });
  writeFileSync(join(mdir, "msg_1.json"), JSON.stringify({ id: "msg_1", role: "assistant" }));
  const pdir = join(store, "part", "msg_1");
  mkdirSync(pdir, { recursive: true });
  writeFileSync(join(pdir, "prt_1.json"), JSON.stringify({ type: "tool", tool: "bash" }));
  writeFileSync(join(pdir, "prt_2.json"), JSON.stringify({ type: "tool", tool: "bash" }));
  writeFileSync(join(pdir, "prt_3.json"), JSON.stringify({ type: "text", text: "hola" }));
  return { store, session: join(sdir, "ses_abc.json") };
}

test("opencode: lee tokens, coste propio y metadatos de la sesion", () => {
  const dir = mkdtempSync(join(tmpdir(), "oc-"));
  try {
    const { session } = opencodeStore(dir);
    const s = parseSession(session)!;
    expect(s.id).toBe("ses_abc");
    expect(s.title).toBe("Arreglar el parser");
    expect(s.model).toBe("anthropic/claude-sonnet-5");
    expect(s.agent).toBe("build");
    expect(s.usage.output).toBe(1000);        // output + reasoning
    expect(s.usage.cacheRead).toBe(50000);
    expect(s.usage.cacheWrite5m).toBe(3000);
    expect(s.cost).toBeCloseTo(0.4211, 6);    // el numero de OpenCode, no el nuestro
    expect(s.additions).toBe(120);
    expect(s.createdAt).toBe(new Date(1787000000000).toISOString());
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("opencode: cuenta tool calls desde las partes v2", () => {
  const dir = mkdtempSync(join(tmpdir(), "oc-"));
  try {
    const { store } = opencodeStore(dir);
    const tools = sessionTools(store, "ses_abc");
    expect(tools.get("bash")).toBe(2);
    expect(tools.has("text")).toBe(false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("opencode: el modelo viene como provider/id y se normaliza para tarifar", () => {
  expect(normalizeModel("anthropic/claude-sonnet-5")).toBe("claude-sonnet-5");
  expect(normalizeModel("openai/gpt-5.5")).toBe("gpt-5.5");
  expect(costOf("anthropic/claude-sonnet-5", U({ input: 1_000_000 })).total).toBeCloseTo(2, 6);
  const d = opencodeProvider.detect();
  expect(d.note).toMatch(/^opencode\./);
});

test("opencode: index() completo aterriza sesion, tokens y tools en la BD", () => {
  const dir = mkdtempSync(join(tmpdir(), "oc-e2e-"));
  const dbDir = mkdtempSync(join(tmpdir(), "oc-db-"));
  const prevXdg = process.env["XDG_DATA_HOME"];
  try {
    mkdirSync(join(dir, "opencode"), { recursive: true });
    opencodeStore(join(dir, "opencode"));
    process.env["XDG_DATA_HOME"] = dir;

    const db = openDb(join(dbDir, "t.db"));
    const r = opencodeProvider.index(db);
    expect(r.messages).toBe(1);

    const sess = db.query("SELECT id, provider, title, cwd, version FROM sessions").get() as Record<string, unknown>;
    expect(sess["provider"]).toBe("opencode");
    expect(sess["title"]).toBe("Arreglar el parser");
    expect(sess["cwd"]).toBe("C:/proyecto");

    const msg = db.query("SELECT provider, model, input, output, cache_read, cost_usd, priced FROM messages").get() as Record<string, number | string>;
    expect(msg["provider"]).toBe("opencode");
    expect(msg["model"]).toBe("anthropic/claude-sonnet-5");
    expect(msg["cache_read"]).toBe(50000);
    expect(msg["cost_usd"]).toBeCloseTo(0.4211, 6);
    expect(msg["priced"]).toBe(1);

    expect(db.query("SELECT count(*) c FROM tool_calls WHERE name = 'bash'").get()).toEqual({ c: 2 });

    // segunda pasada sin cambios: no reindexa
    expect(opencodeProvider.index(db).files).toBe(0);
    db.close();
  } finally {
    if (prevXdg === undefined) delete process.env["XDG_DATA_HOME"]; else process.env["XDG_DATA_HOME"] = prevXdg;
    rmSync(dir, { recursive: true, force: true });
    rmSync(dbDir, { recursive: true, force: true });
  }
});

test("csv: un titulo con coma o comilla no corre las columnas", () => {
  const csv = toCsv([
    { id: "a", title: 'Arreglar el "parser", ya', cost: 1.5 },
    { id: "b", title: "linea1" + String.fromCharCode(10) + "linea2", cost: 0 },
    { id: "c", title: null, cost: 2 },
  ]);
  const lines = csv.split(String.fromCharCode(13, 10));
  expect(lines[0]).toBe("id,title,cost");
  expect(lines[1]).toBe('a,"Arreglar el ""parser"", ya",1.5');
  // el salto de linea embebido queda DENTRO de las comillas y no parte el registro
  expect(lines[2]).toBe('b,"linea1' + String.fromCharCode(10) + 'linea2",0');
  expect(lines.filter(Boolean).length).toBe(4);   // cabecera + 3 registros
  expect(csv).toContain('c,,2');               // null se exporta vacio, no "null"
  expect(toCsv([])).toBe("");
});

test("filtro por fecha: el export cuadra al centimo con el overview", () => {
  const dir = mkdtempSync(join(tmpdir(), "filtro-"));
  try {
    const db = openDb(join(dir, "t.db"));
    db.run("INSERT INTO sessions(id,provider,project,first_ts,last_ts) VALUES ('s1','claude','P','2026-08-05T00:00:00.000Z','2026-08-17T00:00:00.000Z')");
    const msg = (uuid: string, ts: string, cost: number) => db.run(
      "INSERT INTO messages(uuid,session_id,ts,role,model,input,output,cache_w5,cache_w1,cache_read," +
      "web_searches,web_fetches,is_sidechain,cost_usd,priced,provider) VALUES (?,?,?,'assistant','claude-opus-5',10,10,0,0,0,0,0,0,?,1,'claude')",
      [uuid, "s1", ts, cost]);
    msg("a", "2026-08-05T10:00:00.000Z", 1);   // dentro
    msg("b", "2026-08-09T10:00:00.000Z", 2);   // dentro
    msg("c", "2026-08-17T10:00:00.000Z", 40);  // FUERA, pero de la misma sesion

    const f = { from: "2026-08-01T00:00:00.000Z", to: "2026-08-10T23:59:59.999Z" };
    const total = overview(db, f).totals as { cost: number; messages: number };
    const rows = sessionRows(db, f) as Array<{ cost_usd: number; messages: number; last_ts: string }>;
    const list = listSessions(db, f) as Array<{ cost: number }>;

    // el mensaje de fuera del rango NO puede colarse por pertenecer a una sesion que lo toca
    expect(total.cost).toBeCloseTo(3, 6);
    expect(rows.reduce((a, r) => a + r.cost_usd, 0)).toBeCloseTo(total.cost, 6);
    expect(rows.reduce((a, r) => a + r.messages, 0)).toBe(total.messages);
    expect(list.reduce((a, r) => a + r.cost, 0)).toBeCloseTo(total.cost, 6);
    expect(rows[0]!.last_ts).toBe("2026-08-09T10:00:00.000Z");

    // sin filtro se ve la sesion entera
    expect((overview(db).totals as { cost: number }).cost).toBeCloseTo(43, 6);
    db.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

/** Carga web/i18n.js en un entorno de mentira: es un script de navegador, no un modulo. */
function loadDict() {
  const src = readFileSync(join(import.meta.dir, "..", "web", "i18n.js"), "utf8");
  const stub = { documentElement: {}, };
  const fn = new Function("document", "navigator", "location", "localStorage",
    src + ";return { DICT, t, setLang, LANGS, pickLang, browserLang };");
  return fn(stub, { language: "es" }, { search: "" }, { getItem: () => null, setItem: () => {} });
}

test("i18n: detecta el idioma del navegador respetando el orden de preferencia", () => {
  const { pickLang, browserLang } = loadDict();

  // subetiqueta primaria: es-ES, es-419 y es-MX son todos español
  expect(browserLang(["es-ES"])).toBe("es");
  expect(browserLang(["es-419"])).toBe("es");
  expect(browserLang(["en-GB"])).toBe("en");
  expect(browserLang(["EN-us"])).toBe("en");

  // gana el primero de la lista que conozcamos, no el primero de la lista
  expect(browserLang(["fr-FR", "es-ES", "en"])).toBe("es");
  expect(browserLang(["de-DE", "en-US", "es"])).toBe("en");

  // idioma no soportado: ingles, que es mas legible que un español que no entiende
  expect(browserLang(["ja-JP", "ko"])).toBe("en");
  expect(browserLang([])).toBe("en");
  expect(browserLang(undefined)).toBe("en");

  // precedencia: URL > guardado > navegador
  expect(pickLang("en", "es", ["es-ES"])).toBe("en");
  expect(pickLang(null, "es", ["en-US"])).toBe("es");
  expect(pickLang(null, null, ["es-CL"])).toBe("es");
  expect(pickLang("xx", null, ["es-CL"])).toBe("es");   // valor invento en la URL: se ignora
  expect(pickLang(null, "xx", ["en-US"])).toBe("en");   // guardado corrupto: se ignora
});

test("i18n: los dos idiomas tienen exactamente las mismas claves", () => {
  const { DICT } = loadDict();
  const es = Object.keys(DICT.es).sort();
  const en = Object.keys(DICT.en).sort();
  const faltanEn = es.filter((k) => !DICT.en[k]);
  const faltanEs = en.filter((k) => !DICT.es[k]);
  expect(faltanEn).toEqual([]);
  expect(faltanEs).toEqual([]);
  expect(es.length).toBeGreaterThan(150);
});

test("i18n: toda clave que usa la app existe en ambos idiomas", () => {
  const { DICT } = loadDict();
  const app = readFileSync(join(import.meta.dir, "..", "web", "app.js"), "utf8");
  const usadas = new Set<string>();
  // Se extraen las claves con RegExp construido desde String.raw para no pelear
  // con el escapado; el \b evita capturar el "t(" de palabras como select( o print(.
  const RE_T = new RegExp(String.raw`\bt\(\s*"([^"]+)"`, "g");
  const RE_TN = new RegExp(String.raw`\btn\(\s*"([^"]+)"`, "g");
  for (const m of app.matchAll(RE_T)) usadas.add(m[1]!);
  for (const m of app.matchAll(RE_TN)) { usadas.add(m[1]!); usadas.add(m[1]! + "_plural"); }
  // las compuestas t("prov." + x) no se ven aqui: las cubre el test de proveedores
  const esClave = new RegExp(String.raw`^[a-z][\w-]*(\.[\w-]+)+$`, "i");
  const claves = [...usadas].filter((k) => esClave.test(k));
  const faltan = claves.filter((k) => !DICT.es[k] || !DICT.en[k]);
  expect(faltan).toEqual([]);
  expect(claves.length).toBeGreaterThan(80);
});

test("i18n: cada clave de proveedor y recomendacion tiene texto en ambos idiomas", () => {
  const { DICT } = loadDict();
  const notas = ["claude.transcripts", "codex.absent", "codex.rollouts", "codex.empty",
    "cursor.sources", "cursor.empty", "opencode.absent", "opencode.sessions", "opencode.empty"];
  for (const n of notas) for (const l of ["es", "en"]) expect(DICT[l]["prov." + n]).toBeString();

  const recs = ["expensive-sessions", "cache-churn", "huge-context", "unused-tools",
    "no-skills-used", "repeated-prompts", "automation-candidates", "unverified-pricing"];
  for (const r of recs) for (const l of ["es", "en"]) {
    expect(DICT[l][`rec.${r}.title`]).toBeString();
    expect(DICT[l][`rec.${r}.detail`]).toBeString();
  }
});

test("i18n: los parametros {{x}} coinciden entre idiomas", () => {
  const { DICT } = loadDict();
  const params = (s: string) => [...s.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort();
  const distintos: string[] = [];
  for (const k of Object.keys(DICT.es)) {
    const a = JSON.stringify(params(DICT.es[k]));
    const b = JSON.stringify(params(DICT.en[k] ?? ""));
    if (a !== b) distintos.push(`${k}: es=${a} en=${b}`);
  }
  expect(distintos).toEqual([]);
});

test("la BD arranca vacia y responde sin datos", () => {
  const dir = mkdtempSync(join(tmpdir(), "engine-db-"));
  try {
    const db = openDb(join(dir, "t.db"));
    const o = overview(db);
    expect(o.models).toEqual([]);
    expect(o.totals.sessions).toBe(0);
    db.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
