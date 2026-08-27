import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR } from "./paths";

/** ENGINE_DB permite apuntar a otra base: util para demos, capturas y pruebas. */
export function openDb(file = process.env["ENGINE_DB"] || join(DATA_DIR, "engine.db")): Database {
  mkdirSync(DATA_DIR, { recursive: true });
  const db = new Database(file, { create: true });
  db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;");
  migrate(db);
  return db;
}

function migrate(db: Database) {
  db.exec(`
  CREATE TABLE IF NOT EXISTS files (
    path TEXT PRIMARY KEY, provider TEXT NOT NULL,
    size INTEGER NOT NULL, mtime INTEGER NOT NULL,
    offset INTEGER NOT NULL, indexed_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY, provider TEXT NOT NULL, project TEXT,
    cwd TEXT, git_branch TEXT, version TEXT, entrypoint TEXT,
    title TEXT, first_ts TEXT, last_ts TEXT
  );
  CREATE TABLE IF NOT EXISTS messages (
    uuid TEXT PRIMARY KEY, session_id TEXT NOT NULL, ts TEXT, role TEXT,
    model TEXT, input INTEGER, output INTEGER,
    cache_w5 INTEGER, cache_w1 INTEGER, cache_read INTEGER,
    web_searches INTEGER, web_fetches INTEGER,
    speed TEXT, inference_geo TEXT, is_sidechain INTEGER,
    cost_usd REAL, priced INTEGER
  );
  CREATE TABLE IF NOT EXISTS tool_calls (
    id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL,
    message_uuid TEXT, ts TEXT, name TEXT,
    mcp_server TEXT, mcp_tool TEXT, skill TEXT, subagent TEXT
  );
  CREATE TABLE IF NOT EXISTS cursor_sessions (
    id TEXT PRIMARY KEY, title TEXT, model TEXT, mode TEXT, workspace TEXT,
    created_at TEXT, updated_at TEXT, is_subagent INTEGER, is_archived INTEGER,
    lines_added INTEGER, lines_removed INTEGER,
    context_tokens INTEGER, context_limit INTEGER, messages INTEGER
  );
  CREATE TABLE IF NOT EXISTS cursor_tools (
    session_id TEXT NOT NULL, name TEXT NOT NULL, n INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS cursor_commits (
    hash TEXT PRIMARY KEY, branch TEXT, committed_at TEXT, scored_at TEXT,
    lines_added INTEGER, lines_deleted INTEGER,
    ai_lines INTEGER, tab_lines INTEGER, human_lines INTEGER,
    ai_pct TEXT, message TEXT
  );
  CREATE INDEX IF NOT EXISTS ix_cursor_tools ON cursor_tools(session_id);
  CREATE INDEX IF NOT EXISTS ix_msg_session ON messages(session_id);
  CREATE INDEX IF NOT EXISTS ix_msg_ts ON messages(ts);
  CREATE INDEX IF NOT EXISTS ix_msg_model ON messages(model);
  CREATE INDEX IF NOT EXISTS ix_tool_session ON tool_calls(session_id);
  CREATE INDEX IF NOT EXISTS ix_tool_name ON tool_calls(name);
  CREATE INDEX IF NOT EXISTS ix_sess_project ON sessions(project);
  `);

  // columna anadida despues: los mensajes ya indexados son de Claude Code
  const cols = db.query<{ name: string }, []>("PRAGMA table_info(messages)").all().map((c) => c.name);
  if (!cols.includes("provider")) {
    db.exec("ALTER TABLE messages ADD COLUMN provider TEXT NOT NULL DEFAULT 'claude'");
    db.exec("CREATE INDEX IF NOT EXISTS ix_msg_provider ON messages(provider)");
  }
}
