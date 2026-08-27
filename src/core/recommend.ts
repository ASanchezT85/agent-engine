import type { Database } from "bun:sqlite";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR } from "./paths";
import { UNVERIFIED, pricingStatus } from "./pricing";

/**
 * Una recomendacion NO lleva texto: lleva su id, su severidad y los numeros que la
 * sostienen. El texto lo pone el front en el idioma elegido; asi el backend no decide
 * presentacion y no hay dos copias de la prosa.
 */
export interface Recommendation {
  id: string;
  severity: "info" | "warn" | "high";
  params: Record<string, string | number>;
  evidence: unknown;
}

const TOK = "(input + output + cache_w5 + cache_w1 + cache_read)";

export function recommend(db: Database): Recommendation[] {
  const out: Recommendation[] = [];
  const one = <T>(sql: string, ...a: unknown[]) => db.query(sql).get(...a) as T;

  // 1. sesiones desproporcionadamente caras
  const stats = one<{ avg: number; n: number }>(
    "SELECT avg(c) AS avg, count(*) AS n FROM (SELECT sum(cost_usd) AS c FROM messages GROUP BY session_id)");
  if (stats?.n > 5) {
    const pricey = db.query(`SELECT s.id, s.project, s.title, sum(m.cost_usd) AS cost, sum(${TOK}) AS tokens
      FROM messages m JOIN sessions s ON s.id=m.session_id GROUP BY s.id
      HAVING cost > ? ORDER BY cost DESC LIMIT 10`).all(stats.avg * 5);
    if (pricey.length) out.push({
      id: "expensive-sessions", severity: "high",
      params: { n: pricey.length, avg: Number(stats.avg.toFixed(3)) },
      evidence: pricey,
    });
  }

  // 2. gasto dominado por cache writes (contexto que se reescribe en lugar de reusarse)
  const cache = one<{ w: number; r: number }>("SELECT sum(cache_w5+cache_w1) AS w, sum(cache_read) AS r FROM messages");
  if (cache?.w && cache.r / Math.max(cache.w, 1) < 1.5) out.push({
    id: "cache-churn", severity: "warn",
    params: { written: Number((cache.w / 1e6).toFixed(1)), read: Number((cache.r / 1e6).toFixed(1)) },
    evidence: cache,
  });

  // 3. prompts/sesiones gigantes
  const huge = db.query(`SELECT s.id, s.project, s.title, max(m.cache_read + m.input) AS peak_input
    FROM messages m JOIN sessions s ON s.id=m.session_id GROUP BY s.id
    HAVING peak_input > 400000 ORDER BY peak_input DESC LIMIT 10`).all();
  if (huge.length) out.push({
    id: "huge-context", severity: "warn", params: { n: huge.length }, evidence: huge,
  });

  // 4. herramientas casi sin usar (superficie que puedes podar)
  const tools = db.query<{ name: string; n: number }, []>(
    "SELECT name, count(*) AS n FROM tool_calls GROUP BY name ORDER BY n").all();
  const rare = tools.filter((t) => t.n <= 2);
  if (rare.length > 3) out.push({
    id: "unused-tools", severity: "info", params: { n: rare.length }, evidence: rare.slice(0, 25),
  });

  // 5. skills declaradas pero nunca invocadas
  const usedSkills = db.query<{ n: number }, []>("SELECT count(DISTINCT skill) AS n FROM tool_calls WHERE skill IS NOT NULL").get();
  if ((usedSkills?.n ?? 0) === 0) out.push({
    id: "no-skills-used", severity: "info", params: {}, evidence: {},
  });

  // 6. tareas repetidas -> candidatas a skill
  const repeated = db.query(`SELECT lower(trim(title)) AS t, count(*) AS n FROM sessions
    WHERE title IS NOT NULL AND length(title) > 20 GROUP BY t HAVING n >= 3 ORDER BY n DESC LIMIT 10`).all();
  if (repeated.length) out.push({
    id: "repeated-prompts", severity: "info", params: { n: repeated.length }, evidence: repeated,
  });

  // 7. proyectos con mucha ejecucion manual de comandos
  const manual = db.query(`SELECT s.project, count(t.id) * 1.0 / count(DISTINCT s.id) AS bash_per_session
    FROM tool_calls t JOIN sessions s ON s.id=t.session_id WHERE t.name IN ('Bash','PowerShell')
    GROUP BY s.project HAVING bash_per_session > 40 ORDER BY bash_per_session DESC`).all();
  if (manual.length) out.push({
    id: "automation-candidates", severity: "info", params: { n: manual.length }, evidence: manual,
  });

  // 8. modelos sin tarifa conocida
  if (UNVERIFIED.size) out.push({
    id: "unverified-pricing", severity: "warn",
    params: { n: UNVERIFIED.size, sources: pricingStatus().sources.map((s) => `${s.vendor} (${s.verifiedAt})`).join(", ") },
    evidence: [...UNVERIFIED],
  });

  return out;
}

export function saveRecommendations(recs: Recommendation[]): string {
  mkdirSync(DATA_DIR, { recursive: true });
  const file = join(DATA_DIR, "recommendations.json");
  writeFileSync(file, JSON.stringify({ generatedAt: new Date().toISOString(), recommendations: recs }, null, 2));
  return file;
}
