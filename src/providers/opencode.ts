import type { Database } from "bun:sqlite";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, basename } from "node:path";
import { HOME, isDenied } from "../core/paths";
import { costOf } from "../core/pricing";
import { redact } from "../core/redact";
import type { Provider, Usage } from "../core/types";

/**
 * Adapter de OpenCode.
 *
 * Formato verificado leyendo el codigo de anomalyco/opencode (antes sst/opencode):
 *   - `packages/opencode/src/storage/storage.ts` -> la raiz es `Global.Path.data/storage`
 *     y las claves son rutas: session/<projectID>/<id>.json, message/<sessionID>/<id>.json,
 *     part/<messageID>/<id>.json, project/<id>.json, session_diff/<id>.json
 *   - `packages/opencode/src/session/session.ts` -> Info { id, slug, projectID, directory,
 *     parentID?, title, agent?, version, cost?, tokens?, summary?, time {created, updated} }
 *     con Tokens { input, output, reasoning, cache { read, write } }
 *   - `packages/opencode/src/session/message.ts` -> metadata.assistant { modelID, providerID,
 *     cost, tokens } con la misma forma de Tokens
 *
 * A diferencia de Claude Code y Codex, **OpenCode calcula y guarda el coste el mismo**.
 * Se usa su numero; solo si falta se recurre a config/pricing.json.
 */
/** Se resuelve en cada llamada: XDG_DATA_HOME puede cambiar entre ejecuciones. */
function dataRoots(): string[] {
  const xdg = process.env["XDG_DATA_HOME"];
  return [
    xdg ? join(xdg, "opencode") : null,
    join(HOME, ".local", "share", "opencode"),
    join(HOME, "AppData", "Local", "opencode"),
  ].filter((p): p is string => !!p);
}

export function storageRoot(): string | null {
  for (const r of dataRoots()) {
    const s = join(r, "storage");
    if (existsSync(s)) return s;
  }
  return null;
}

/** La raiz existe aunque nunca se haya usado: el instalador crea el esqueleto vacio. */
export function installRoot(): string | null {
  return dataRoots().find(existsSync) ?? (existsSync(join(HOME, ".opencode")) ? join(HOME, ".opencode") : null);
}

function walkJson(dir: string, depth = 4): string[] {
  const out: string[] = [];
  if (depth < 0 || !existsSync(dir)) return out;
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...walkJson(p, depth - 1));
    else if (e.name.endsWith(".json") && !isDenied(p)) out.push(p);
  }
  return out;
}

export function listSessionFiles(root = storageRoot()): string[] {
  return root ? walkJson(join(root, "session")) : [];
}

const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

export interface OpenCodeSession {
  id: string;
  title: string | null;
  directory: string | null;
  model: string | null;
  agent: string | null;
  version: string | null;
  isChild: boolean;
  createdAt: string | null;
  updatedAt: string | null;
  usage: Usage;
  cost: number | null;
  additions: number;
  deletions: number;
}

export function parseSession(file: string): OpenCodeSession | null {
  let raw: Record<string, unknown>;
  try { raw = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>; } catch { return null; }
  const id = typeof raw["id"] === "string" ? raw["id"] : basename(file, ".json");
  if (!id) return null;

  const t = obj(raw["tokens"]);
  const cache = obj(t["cache"]);
  const model = obj(raw["model"]);
  const time = obj(raw["time"]);
  const summary = obj(raw["summary"]);
  const modelId = typeof model["id"] === "string" ? model["id"] : null;
  const provider = typeof model["providerID"] === "string" ? model["providerID"] : null;

  return {
    id,
    title: typeof raw["title"] === "string" && raw["title"] ? redact(raw["title"]).slice(0, 200) : null,
    directory: typeof raw["directory"] === "string" ? raw["directory"] : null,
    model: modelId ? (provider ? `${provider}/${modelId}` : modelId) : null,
    agent: typeof raw["agent"] === "string" ? raw["agent"] : null,
    version: typeof raw["version"] === "string" ? raw["version"] : null,
    isChild: typeof raw["parentID"] === "string" && !!raw["parentID"],
    createdAt: num(time["created"]) ? new Date(num(time["created"])).toISOString() : null,
    updatedAt: num(time["updated"]) ? new Date(num(time["updated"])).toISOString() : null,
    usage: {
      input: num(t["input"]),
      output: num(t["output"]) + num(t["reasoning"]),
      cacheWrite5m: num(cache["write"]),
      cacheWrite1h: 0,
      cacheRead: num(cache["read"]),
      webSearches: 0,
      webFetches: 0,
    },
    // `cost` puede faltar (sesion sin turnos de asistente); 0 legitimo se distingue de ausente
    cost: typeof raw["cost"] === "number" && Number.isFinite(raw["cost"]) ? raw["cost"] : null,
    additions: num(summary["additions"]),
    deletions: num(summary["deletions"]),
  };
}

/** Herramientas usadas: en v2 viven en part/<messageID>/*.json con {type:"tool", tool}. */
export function sessionTools(root: string, sessionId: string): Map<string, number> {
  const tools = new Map<string, number>();
  const msgDir = join(root, "message", sessionId);
  const bump = (name: unknown) => {
    if (typeof name === "string" && name) tools.set(name, (tools.get(name) ?? 0) + 1);
  };

  for (const f of walkJson(msgDir, 1)) {
    let m: Record<string, unknown>;
    try { m = JSON.parse(readFileSync(f, "utf8")) as Record<string, unknown>; } catch { continue; }
    // v1: metadata.tool es un Record<toolCallID, {title,...}>
    for (const [, v] of Object.entries(obj(obj(m["metadata"])["tool"]))) bump(obj(v)["title"]);
    // v2: las partes se guardan aparte, indexadas por messageID
    const id = typeof m["id"] === "string" ? m["id"] : basename(f, ".json");
    for (const p of walkJson(join(root, "part", id), 1)) {
      try {
        const part = JSON.parse(readFileSync(p, "utf8")) as Record<string, unknown>;
        if (part["type"] === "tool") bump(part["tool"]);
      } catch { /* parte ilegible: se ignora, no se inventa */ }
    }
  }
  return tools;
}

export const opencodeProvider: Provider = {
  id: "opencode",
  label: "OpenCode",

  detect() {
    const root = installRoot();
    if (!root) return { installed: false, root: null, note: "opencode.absent" };
    const store = storageRoot();
    const n = store ? listSessionFiles(store).length : 0;
    return n
      ? { installed: true, root, note: "opencode.sessions", noteParams: { n } }
      : { installed: true, root, note: "opencode.empty" };
  },

  index(db: Database) {
    const root = storageRoot();
    const files = listSessionFiles(root);
    if (!root || !files.length) return { files: 0, newBytes: 0, messages: 0 };

    const getFile = db.query<{ size: number; mtime: number }, [string]>(
      "SELECT size, mtime FROM files WHERE path = ?");
    const putFile = db.query(
      "INSERT INTO files(path,provider,size,mtime,offset,indexed_at) VALUES (?,?,?,?,?,?) " +
      "ON CONFLICT(path) DO UPDATE SET size=excluded.size, mtime=excluded.mtime, offset=excluded.offset, indexed_at=excluded.indexed_at");
    const putSess = db.query(
      "INSERT INTO sessions(id,provider,project,cwd,git_branch,version,entrypoint,title,first_ts,last_ts) VALUES (?,?,?,?,NULL,?,?,?,?,?) " +
      "ON CONFLICT(id) DO UPDATE SET project=excluded.project, cwd=coalesce(excluded.cwd,sessions.cwd), " +
      "version=coalesce(excluded.version,sessions.version), title=coalesce(excluded.title,sessions.title), " +
      "first_ts=coalesce(excluded.first_ts,sessions.first_ts), last_ts=coalesce(excluded.last_ts,sessions.last_ts)");
    const putMsg = db.query(
      "INSERT OR REPLACE INTO messages(uuid,session_id,ts,role,model,input,output,cache_w5,cache_w1,cache_read," +
      "web_searches,web_fetches,speed,inference_geo,is_sidechain,cost_usd,priced,provider) " +
      "VALUES (?,?,?,?,?,?,?,?,?,?,0,0,NULL,NULL,?,?,?,'opencode')");
    const delTools = db.query("DELETE FROM tool_calls WHERE session_id = ?");
    const putTool = db.query(
      "INSERT INTO tool_calls(session_id,message_uuid,ts,name,mcp_server,mcp_tool,skill,subagent) VALUES (?,?,?,?,NULL,NULL,NULL,?)");

    let touched = 0, newBytes = 0, sessions = 0;

    for (const file of files) {
      const st = statSync(file);
      const prev = getFile.get(file);
      if (prev && st.size === prev.size && st.mtimeMs === prev.mtime) continue;

      const s = parseSession(file);
      if (!s) continue;
      newBytes += st.size;

      const tx = db.transaction(() => {
        putSess.run(s.id, "opencode", s.directory ?? "(sin directorio)", s.directory,
          s.version, s.agent, s.title, s.createdAt, s.updatedAt);

        // OpenCode ya calculo el coste: se prefiere su numero al nuestro
        const own = s.cost !== null;
        const c = own ? { total: s.cost!, priced: true } : costOf(s.model, s.usage);
        putMsg.run(s.id + ":usage", s.id, s.updatedAt ?? s.createdAt, "assistant", s.model,
          s.usage.input, s.usage.output, s.usage.cacheWrite5m, s.usage.cacheWrite1h, s.usage.cacheRead,
          s.isChild ? 1 : 0, c.total, c.priced ? 1 : 0);

        delTools.run(s.id);
        for (const [name, n] of sessionTools(root, s.id)) {
          for (let i = 0; i < n; i++) putTool.run(s.id, s.id + ":usage", s.updatedAt, name, s.agent);
        }
        putFile.run(file, "opencode", st.size, st.mtimeMs, st.size, new Date().toISOString());
      });
      tx();
      touched++; sessions++;
    }

    return { files: touched, newBytes, messages: sessions };
  },
};
