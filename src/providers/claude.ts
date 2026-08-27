import type { Database } from "bun:sqlite";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join, basename } from "node:path";
import { HOME, isDenied } from "../core/paths";
import { streamLines, num } from "../core/jsonl";
import { costOf } from "../core/pricing";
import { redact } from "../core/redact";
import type { Provider, Usage } from "../core/types";

export const CLAUDE_ROOT = join(HOME, ".claude");
const PROJECTS = join(CLAUDE_ROOT, "projects");

/** `C--dev-proyectos-Demo` -> `C:\dev\proyectos\Demo` (mejor esfuerzo, solo cosmetico) */
export function decodeProject(dir: string): string {
  if (/^[A-Za-z]--/.test(dir)) return dir[0] + ":\\" + dir.slice(3).replace(/-/g, "\\");
  return dir.replace(/^-/, "/").replace(/-/g, "/");
}

function listTranscripts(): Array<{ path: string; project: string }> {
  if (!existsSync(PROJECTS)) return [];
  const out: Array<{ path: string; project: string }> = [];
  for (const d of readdirSync(PROJECTS, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    const dir = join(PROJECTS, d.name);
    for (const f of readdirSync(dir)) {
      if (!f.endsWith(".jsonl")) continue;
      const p = join(dir, f);
      if (!isDenied(p)) out.push({ path: p, project: d.name });
    }
  }
  return out;
}


function usageOf(u: Record<string, unknown> | undefined): Usage {
  const cc = (u?.["cache_creation"] as Record<string, unknown> | undefined) ?? {};
  const w5 = num(cc["ephemeral_5m_input_tokens"]);
  const w1 = num(cc["ephemeral_1h_input_tokens"]);
  const legacy = num(u?.["cache_creation_input_tokens"]);
  const stu = (u?.["server_tool_use"] as Record<string, unknown> | undefined) ?? {};
  return {
    input: num(u?.["input_tokens"]),
    output: num(u?.["output_tokens"]),
    cacheWrite5m: w5 + w1 === 0 ? legacy : w5,
    cacheWrite1h: w1,
    cacheRead: num(u?.["cache_read_input_tokens"]),
    webSearches: num(stu["web_search_requests"]),
    webFetches: num(stu["web_fetch_requests"]),
  };
}

function firstText(content: unknown): string | null {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return null;
  for (const b of content) {
    const blk = b as { type?: string; text?: string } | null;
    if (blk && blk.type === "text" && typeof blk.text === "string") return blk.text;
  }
  return null;
}

export const claudeProvider: Provider = {
  id: "claude",
  label: "Claude Code",

  detect() {
    if (!existsSync(CLAUDE_ROOT)) return { installed: false, root: null };
    const n = existsSync(PROJECTS) ? listTranscripts().length : 0;
    return { installed: true, root: CLAUDE_ROOT, note: "claude.transcripts", noteParams: { n } };
  },

  index(db: Database) {
    const files = listTranscripts();
    const getFile = db.query<{ size: number; mtime: number; offset: number }, [string]>(
      "SELECT size, mtime, offset FROM files WHERE path = ?");
    const putFile = db.query(
      "INSERT INTO files(path,provider,size,mtime,offset,indexed_at) VALUES (?,?,?,?,?,?) " +
      "ON CONFLICT(path) DO UPDATE SET size=excluded.size, mtime=excluded.mtime, offset=excluded.offset, indexed_at=excluded.indexed_at");
    const putMsg = db.query(
      "INSERT OR REPLACE INTO messages(uuid,session_id,ts,role,model,input,output,cache_w5,cache_w1,cache_read,web_searches,web_fetches,speed,inference_geo,is_sidechain,cost_usd,priced) " +
      "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)");
    const putTool = db.query(
      "INSERT INTO tool_calls(session_id,message_uuid,ts,name,mcp_server,mcp_tool,skill,subagent) VALUES (?,?,?,?,?,?,?,?)");
    const putSess = db.query(
      "INSERT INTO sessions(id,provider,project,cwd,git_branch,version,entrypoint,title,first_ts,last_ts) VALUES (?,?,?,?,?,?,?,?,?,?) " +
      "ON CONFLICT(id) DO UPDATE SET project=excluded.project, cwd=coalesce(excluded.cwd,sessions.cwd), " +
      "git_branch=coalesce(excluded.git_branch,sessions.git_branch), version=coalesce(excluded.version,sessions.version), " +
      "entrypoint=coalesce(excluded.entrypoint,sessions.entrypoint), title=coalesce(sessions.title,excluded.title), " +
      "first_ts=min(coalesce(sessions.first_ts,excluded.first_ts),coalesce(excluded.first_ts,sessions.first_ts)), " +
      "last_ts=max(coalesce(sessions.last_ts,excluded.last_ts),coalesce(excluded.last_ts,sessions.last_ts))");
    const delTools = db.query("DELETE FROM tool_calls WHERE message_uuid = ?");

    let touched = 0, newBytes = 0, msgs = 0;

    for (const { path, project } of files) {
      const st = statSync(path);
      const prev = getFile.get(path);
      let offset = prev?.offset ?? 0;
      if (prev && st.size < prev.size) offset = 0;            // truncado/reescrito
      if (prev && st.size === prev.size && st.mtimeMs === prev.mtime) continue;
      if (offset >= st.size) {
        putFile.run(path, "claude", st.size, st.mtimeMs, offset, new Date().toISOString());
        continue;
      }

      const sessionId = basename(path, ".jsonl");
      const sess: Record<string, string | null> = {
        cwd: null, branch: null, version: null, entry: null, title: null, first: null, last: null,
      };

      const startOffset = offset;
      const tx = db.transaction(() => {
        const end = streamLines(path, startOffset, (line) => {
          let o: Record<string, unknown>;
          try { o = JSON.parse(line) as Record<string, unknown>; } catch { return; }

          const ts = typeof o["timestamp"] === "string" ? (o["timestamp"] as string) : null;
          if (ts) {
            if (!sess["first"] || ts < sess["first"]!) sess["first"] = ts;
            if (!sess["last"] || ts > sess["last"]!) sess["last"] = ts;
          }
          sess["cwd"] ??= (o["cwd"] as string) ?? null;
          sess["branch"] ??= (o["gitBranch"] as string) ?? null;
          sess["version"] ??= (o["version"] as string) ?? null;
          sess["entry"] ??= (o["entrypoint"] as string) ?? null;
          if (o["type"] === "custom-title" && o["customTitle"]) sess["title"] = redact(String(o["customTitle"])).slice(0, 200);
          if (o["type"] === "ai-title" && o["aiTitle"] && !sess["title"]) sess["title"] = redact(String(o["aiTitle"])).slice(0, 200);

          const m = o["message"] as Record<string, unknown> | undefined;
          const uuid = o["uuid"] as string | undefined;
          if (!m || typeof m !== "object" || !uuid) return;
          const role = o["type"] === "assistant" ? "assistant" : o["type"] === "user" ? "user" : o["type"] === "system" ? "system" : null;
          if (!role) return;

          if (!sess["title"] && role === "user") {
            const t = firstText(m["content"]);
            if (t && !t.startsWith("<")) sess["title"] = redact(t).replace(/\s+/g, " ").slice(0, 200);
          }

          const rawUsage = m["usage"] as Record<string, unknown> | undefined;
          const u = usageOf(rawUsage);
          const model = (m["model"] as string) ?? null;
          const speed = (rawUsage?.["speed"] as string) ?? (rawUsage?.["service_tier"] as string) ?? null;
          const geo = (rawUsage?.["inference_geo"] as string) ?? null;
          const c = costOf(model, u, { speed: (rawUsage?.["speed"] as string) ?? null, inferenceGeo: geo });
          putMsg.run(uuid, sessionId, ts, role, model, u.input, u.output, u.cacheWrite5m, u.cacheWrite1h,
            u.cacheRead, u.webSearches, u.webFetches, speed, geo, o["isSidechain"] ? 1 : 0, c.total, c.priced ? 1 : 0);
          msgs++;

          const content = m["content"];
          if (Array.isArray(content)) {
            delTools.run(uuid);
            for (const b of content) {
              const blk = b as { type?: string; name?: string; input?: Record<string, unknown> } | null;
              if (!blk || blk.type !== "tool_use" || !blk.name) continue;
              const inp = blk.input ?? {};
              putTool.run(sessionId, uuid, ts, blk.name,
                (o["attributionMcpServer"] as string) ?? null,
                (o["attributionMcpTool"] as string) ?? null,
                typeof inp["skill"] === "string" ? inp["skill"] : null,
                typeof inp["subagent_type"] === "string" ? inp["subagent_type"] : null);
            }
          }
        });
        newBytes += end - startOffset;
        putSess.run(sessionId, "claude", decodeProject(project), sess["cwd"], sess["branch"], sess["version"],
          sess["entry"], sess["title"], sess["first"], sess["last"]);
        putFile.run(path, "claude", st.size, st.mtimeMs, end, new Date().toISOString());
      });
      tx();
      touched++;
    }
    return { files: touched, newBytes, messages: msgs };
  },
};
