import { Database } from "bun:sqlite";
import { existsSync, statSync, copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { HOME, DATA_DIR, assertReadOnly } from "../core/paths";
import { redact } from "../core/redact";
import type { Provider } from "../core/types";

export const CURSOR_HOME = join(HOME, ".cursor");
const GLOBAL_STORAGE = join(HOME, "AppData", "Roaming", "Cursor", "User", "globalStorage");
const STATE_DB = join(GLOBAL_STORAGE, "state.vscdb");
const TRACK_DB = join(CURSOR_HOME, "ai-tracking", "ai-code-tracking.db");
const CACHE = join(DATA_DIR, "cursor-cache");

/**
 * Cursor guarda sus bases en modo WAL y las escribe mientras esta abierto.
 * Abrirlas en sitio, aunque sea `readonly`, hace que SQLite quiera crear el `-shm`:
 * eso seria escribir en carpeta ajena. Por eso se copian aqui y se lee la copia.
 */
export function copyForReading(src: string, dir = CACHE): string | null {
  if (!existsSync(src)) return null;
  assertReadOnly(src, "read");
  mkdirSync(dir, { recursive: true });
  const dst = join(dir, src.split(/[\\/]/).pop()!);
  copyFileSync(src, dst);
  // el WAL lleva lo escrito mas reciente: sin el, la copia se lee desfasada
  for (const ext of ["-wal", "-shm"]) if (existsSync(src + ext)) copyFileSync(src + ext, dst + ext);
  return dst;
}

/** Solo se llama cuando el origen ya cambio: el gate de frescura vive en index(). */
function openCopy(src: string): Database | null {
  const dst = copyForReading(src);
  if (!dst) return null;
  try { return new Database(dst, { readonly: true }); } catch { return null; }
}

interface Head { composerId: string; createdAt: number | null; lastUpdatedAt: number | null; isArchived: number; isSubagent: number; workspaceId: string | null }

export const cursorProvider: Provider = {
  id: "cursor",
  label: "Cursor",

  detect() {
    const hasState = existsSync(STATE_DB);
    const hasTrack = existsSync(TRACK_DB);
    if (!hasState && !hasTrack && !existsSync(CURSOR_HOME)) return { installed: false, root: null };
    return {
      installed: true,
      root: CURSOR_HOME,
      note: hasState || hasTrack ? "cursor.sources" : "cursor.empty",
      noteParams: { sessions: hasState ? 1 : 0, authorship: hasTrack ? 1 : 0 },
    };
  },

  index(db) {
    let sessions = 0, tools = 0, commits = 0, files = 0;

    const seen = db.query<{ size: number; mtime: number }, [string]>(
      "SELECT size, mtime FROM files WHERE path = ?");
    const mark = db.query(
      "INSERT INTO files(path,provider,size,mtime,offset,indexed_at) VALUES (?,?,?,?,0,?) " +
      "ON CONFLICT(path) DO UPDATE SET size=excluded.size, mtime=excluded.mtime, indexed_at=excluded.indexed_at");
    const unchanged = (src: string) => {
      if (!existsSync(src)) return true;
      const s = statSync(src), prev = seen.get(src);
      return !!prev && prev.size === s.size && prev.mtime === s.mtimeMs;
    };
    const stamp = (src: string) => {
      const s = statSync(src);
      mark.run(src, "cursor", s.size, s.mtimeMs, new Date().toISOString());
    };

    // ---- sesiones y tool calls (state.vscdb) ----
    if (!unchanged(STATE_DB)) {
      const src = openCopy(STATE_DB);
      if (src) {
        const heads = new Map<string, Head>();
        for (const h of src.query<Head, []>(
          "SELECT composerId, createdAt, lastUpdatedAt, isArchived, isSubagent, workspaceId FROM composerHeaders").all()) {
          heads.set(h.composerId, h);
        }

        const putSess = db.query(
          "INSERT OR REPLACE INTO cursor_sessions(id,title,model,mode,workspace,created_at,updated_at,is_subagent,is_archived," +
          "lines_added,lines_removed,context_tokens,context_limit,messages) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)");

        const rows = src.query<{ id: string; name: string | null; model: string | null; mode: string | null;
          lines_added: number | null; lines_removed: number | null; used: number | null; max: number | null;
          created: number | null; updated: number | null; messages: number | null }, []>(`
          SELECT substr(key, 14) AS id,
                 json_extract(value,'$.name')                                AS name,
                 json_extract(value,'$.modelConfig.modelName')                AS model,
                 json_extract(value,'$.unifiedMode')                          AS mode,
                 json_extract(value,'$.totalLinesAdded')                      AS lines_added,
                 json_extract(value,'$.totalLinesRemoved')                    AS lines_removed,
                 json_extract(value,'$.promptTokenBreakdown.totalUsedTokens') AS used,
                 json_extract(value,'$.promptTokenBreakdown.maxTokens')       AS max,
                 json_extract(value,'$.createdAt')                            AS created,
                 json_extract(value,'$.lastUpdatedAt')                        AS updated,
                 json_array_length(value,'$.fullConversationHeadersOnly')     AS messages
          FROM cursorDiskKV WHERE key LIKE 'composerData:%'`).all();

        const tx = db.transaction(() => {
          for (const r of rows) {
            const h = heads.get(r.id);
            const created = r.created ?? h?.createdAt ?? null;
            const updated = r.updated ?? h?.lastUpdatedAt ?? created;
            putSess.run(r.id,
              r.name ? redact(r.name).slice(0, 200) : null,
              r.model === "default" ? null : r.model,   // "default" no es un modelo, es "el que este puesto"
              r.mode, h?.workspaceId ?? null,
              created ? new Date(created).toISOString() : null,
              updated ? new Date(updated).toISOString() : null,
              h?.isSubagent ?? 0, h?.isArchived ?? 0,
              r.lines_added ?? 0, r.lines_removed ?? 0,
              r.used ?? null, r.max ?? null, r.messages ?? 0);
            sessions++;
          }

          db.run("DELETE FROM cursor_tools");
          const putTool = db.query("INSERT INTO cursor_tools(session_id,name,n) VALUES (?,?,?)");
          for (const t of src.query<{ sid: string; name: string; n: number }, []>(`
            SELECT substr(key, 10, 36) AS sid,
                   json_extract(value,'$.toolFormerData.name') AS name,
                   count(*) AS n
            FROM cursorDiskKV
            WHERE key LIKE 'bubbleId:%' AND json_extract(value,'$.toolFormerData.name') IS NOT NULL
            GROUP BY sid, name`).all()) {
            putTool.run(t.sid, t.name, t.n);
            tools += t.n;
          }
        });
        tx();
        src.close();
        stamp(STATE_DB);
        files++;
      }
    }

    // ---- autoria IA por commit (ai-code-tracking.db) ----
    if (!unchanged(TRACK_DB)) {
      const src = openCopy(TRACK_DB);
      if (src) {
        const put = db.query(
          "INSERT OR REPLACE INTO cursor_commits(hash,branch,committed_at,scored_at,lines_added,lines_deleted," +
          "ai_lines,tab_lines,human_lines,ai_pct,message) VALUES (?,?,?,?,?,?,?,?,?,?,?)");
        const tx = db.transaction(() => {
          for (const c of src.query<Record<string, unknown>, []>("SELECT * FROM scored_commits").all()) {
            const when = c["commitDate"] ? new Date(String(c["commitDate"])) : null;
            put.run(c["commitHash"], c["branchName"],
              when && !Number.isNaN(when.getTime()) ? when.toISOString() : null,
              c["scoredAt"] ? new Date(Number(c["scoredAt"])).toISOString() : null,
              c["linesAdded"] ?? 0, c["linesDeleted"] ?? 0,
              c["composerLinesAdded"] ?? 0, c["tabLinesAdded"] ?? 0, c["humanLinesAdded"] ?? 0,
              c["v2AiPercentage"] ?? c["v1AiPercentage"] ?? null,
              c["commitMessage"] ? redact(String(c["commitMessage"])).slice(0, 200) : null);
            commits++;
          }
        });
        tx();
        src.close();
        stamp(TRACK_DB);
        files++;
      }
    }

    return { files, newBytes: 0, messages: sessions + commits };
  },
};

export function cursorStats(db: import("bun:sqlite").Database) {
  const totals = db.query(`SELECT count(*) AS sessions, sum(messages) AS messages,
      sum(lines_added) AS lines_added, sum(lines_removed) AS lines_removed,
      sum(is_subagent) AS subagents, max(context_tokens) AS peak_context
    FROM cursor_sessions`).get();
  return {
    totals,
    available: (totals as { sessions: number } | null)?.sessions ?? 0,
    models: db.query(`SELECT coalesce(model,'(el que estuviera puesto)') AS model, count(*) AS sessions,
        sum(lines_added) AS lines_added, max(context_tokens) AS peak_context
      FROM cursor_sessions GROUP BY model ORDER BY sessions DESC`).all(),
    sessions: db.query(`SELECT s.id, s.title, s.model, s.mode, s.created_at, s.updated_at, s.messages,
        s.lines_added, s.lines_removed, s.context_tokens, s.context_limit, s.is_subagent,
        (SELECT coalesce(sum(t.n),0) FROM cursor_tools t WHERE t.session_id = s.id) AS tools
      FROM cursor_sessions s ORDER BY coalesce(s.updated_at, s.created_at) DESC`).all(),
    tools: db.query("SELECT name, sum(n) AS n FROM cursor_tools GROUP BY name ORDER BY n DESC").all(),
    commits: db.query(`SELECT hash, branch, committed_at, lines_added, ai_lines, tab_lines, human_lines, ai_pct, message
      FROM cursor_commits ORDER BY committed_at DESC`).all(),
    authorship: db.query(`SELECT count(*) AS commits, sum(lines_added) AS lines_added,
        sum(ai_lines) AS ai_lines, sum(tab_lines) AS tab_lines, sum(human_lines) AS human_lines,
        min(committed_at) AS first_commit, max(committed_at) AS last_commit
      FROM cursor_commits`).get(),
    byBranch: db.query(`SELECT branch, count(*) AS commits, sum(lines_added) AS lines_added, sum(ai_lines) AS ai_lines
      FROM cursor_commits GROUP BY branch ORDER BY lines_added DESC LIMIT 15`).all(),
  };
}
