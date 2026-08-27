import type { Database } from "bun:sqlite";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, basename } from "node:path";
import { CLAUDE_ROOT, decodeProject } from "../providers/claude";
import { isDenied } from "./paths";
import { redact, looksSecret } from "./redact";
import { whereTools, type Filters } from "./analytics";

function frontmatter(text: string): Record<string, string> {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m || !m[1]) return {};
  const out: Record<string, string> = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (kv && kv[1] && kv[2] !== undefined) out[kv[1]] = kv[2].trim().replace(/^["']|["']$/g, "");
  }
  return out;
}

function walk(dir: string, match: (f: string) => boolean, depth = 6): string[] {
  const out: string[] = [];
  if (depth < 0 || !existsSync(dir)) return out;
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === ".git") continue;
      out.push(...walk(p, match, depth - 1));
    } else if (match(e.name) && !isDenied(p)) out.push(p);
  }
  return out;
}

/**
 * El inventario de skills es el disco y no se filtra; lo que si se acota por filtro
 * es `uses`, que sale de las sesiones indexadas.
 */
export function skills(db: Database, f: Filters = {}) {
  const usage = new Map<string, number>();
  const w = whereTools(f);
  for (const r of db.query<{ skill: string; n: number }, unknown[]>(
    `SELECT t.skill AS skill, count(*) AS n FROM tool_calls t
     WHERE t.skill IS NOT NULL AND ${w.sql} GROUP BY t.skill`).all(...w.args)) {
    usage.set(r.skill.toLowerCase(), r.n);
  }

  const roots = [
    { root: join(CLAUDE_ROOT, "skills"), scope: "user" },
    { root: join(CLAUDE_ROOT, "plugins"), scope: "plugin" },
  ];
  const out = [];
  for (const { root, scope } of roots) {
    for (const file of walk(root, (f) => f === "SKILL.md", 5)) {
      let raw = "";
      try { raw = readFileSync(file, "utf8").slice(0, 8000); } catch { continue; }
      const fm = frontmatter(raw);
      const st = statSync(file);
      const name = fm["name"] ?? basename(join(file, ".."));
      const key = name.toLowerCase();
      out.push({
        name,
        scope,
        location: relative(CLAUDE_ROOT, file).replace(/\\/g, "/"),
        description: redact(fm["description"] ?? "").slice(0, 400),
        modified: new Date(st.mtimeMs).toISOString(),
        size: st.size,
        uses: usage.get(key) ?? usage.get(key.split(":").pop() ?? key) ?? 0,
      });
    }
  }
  out.sort((a, b) => b.uses - a.uses || a.name.localeCompare(b.name));
  return out;
}

export function memories() {
  const projects = join(CLAUDE_ROOT, "projects");
  const out = [];
  if (!existsSync(projects)) return { files: out, stats: { count: 0, bytes: 0, links: 0, redacted: 0 } };
  let bytes = 0, links = 0, redacted = 0;

  for (const d of readdirSync(projects, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    const memDir = join(projects, d.name, "memory");
    if (!existsSync(memDir)) continue;
    for (const file of walk(memDir, (f) => f.endsWith(".md"), 2)) {
      let raw = "";
      try { raw = readFileSync(file, "utf8"); } catch { continue; }
      const st = statSync(file);
      const fm = frontmatter(raw);
      const body = raw.replace(/^---[\s\S]*?---\r?\n/, "");
      const link = [...body.matchAll(/\[\[([^\]]+)\]\]/g)].map((m) => m[1]!);
      const dirty = looksSecret(raw);
      bytes += st.size; links += link.length; if (dirty) redacted++;
      out.push({
        name: fm["name"] ?? basename(file, ".md"),
        file: basename(file),
        project: decodeProject(d.name),
        type: fm["type"] ?? (raw.match(/type:\s*(\w+)/)?.[1] ?? "unknown"),
        description: redact(fm["description"] ?? "").slice(0, 300),
        preview: redact(body.trim().slice(0, 400)),
        links: link,
        redacted: dirty,
        size: st.size,
        modified: new Date(st.mtimeMs).toISOString(),
      });
    }
  }
  out.sort((a, b) => b.modified.localeCompare(a.modified));
  return { files: out, stats: { count: out.length, bytes, links, redacted } };
}

/**
 * Procesos de Claude Code vivos = PID registrado en ~/.claude/sessions que aun existe.
 * NO se intenta emparejar PID con transcript: no hay ningun campo que los una y adivinar
 * por cercania temporal daba el mismo id a todos los procesos.
 */
export function liveSessions(db: Database) {
  const dir = join(CLAUDE_ROOT, "sessions");
  const processes: Array<{ pid: number; seenAt: string }> = [];
  if (existsSync(dir)) {
    for (const f of readdirSync(dir)) {
      const m = f.match(/^(\d+)\.json$/);
      if (!m || !m[1]) continue;
      const pid = Number(m[1]);
      try { process.kill(pid, 0); } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "EPERM") continue;
      }
      processes.push({ pid, seenAt: new Date(statSync(join(dir, f)).mtimeMs).toISOString() });
    }
  }
  const since = new Date(Date.now() - 10 * 60_000).toISOString();
  const recentlyActive = db.query(
    "SELECT id, project, title, last_ts FROM sessions WHERE last_ts >= ? ORDER BY last_ts DESC LIMIT 10").all(since);
  return { processes, recentlyActive };
}
