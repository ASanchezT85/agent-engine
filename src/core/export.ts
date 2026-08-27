import type { Database } from "bun:sqlite";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, basename, dirname } from "node:path";
import { DATA_DIR } from "./paths";
import { pricingStatus } from "./pricing";
import * as A from "./analytics";
import { skills, memories } from "./inventory";
import { recommend } from "./recommend";
import { detectAll } from "../providers/registry";
import { cursorStats } from "../providers/cursor";

export type Row = Record<string, unknown>;

/**
 * CSV de verdad: comillas dobladas y campo entrecomillado si lleva coma, comilla o salto.
 * Sin esto, un titulo de sesion con una coma corre las columnas del resto de la fila.
 */
export function toCsv(rows: Row[]): string {
  if (!rows.length) return "";
  const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const cell = (v: unknown) => {
    if (v === null || v === undefined) return "";
    const s = typeof v === "object" ? JSON.stringify(v) : String(v);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return [cols.join(","), ...rows.map((r) => cols.map((c) => cell(r[c])).join(","))].join("\r\n") + "\r\n";
}

/**
 * Secciones que el filtro NO puede acotar, con el motivo. Se escriben en el propio export
 * para que nadie lea un volcado a medio filtrar creyendo que esta completo.
 */
const NOT_FILTERED: Record<string, { es: string; en: string }> = {
  memory: {
    es: "los archivos de memoria son del disco: no cuelgan de una sesion ni de una fecha",
    en: "memory files come from disk: they hang off no session and no date",
  },
  cursor: {
    es: "Cursor tiene su propio almacen y no comparte el eje de proveedor/proyecto del resto",
    en: "Cursor has its own store and does not share the provider/project axis of the rest",
  },
  recommendations: {
    es: "se calculan sobre todo el historico; acotarlas cambiaria lo que significan",
    en: "they are computed over the whole history; narrowing them would change what they mean",
  },
  providers: { es: "es el estado de deteccion de la maquina, no datos", en: "this is the machine's detection state, not data" },
  pricing: { es: "son las tarifas y su verificacion, no datos", en: "these are the rates and their verification, not data" },
};

export type Lang = "es" | "en";

export function bundle(db: Database, f: A.Filters = {}, lang: Lang = "es") {
  const applied = Object.fromEntries(Object.entries(f).filter(([, v]) => v));
  return {
    generatedAt: new Date().toISOString(),
    engine: { name: "Motor Agentico", version: "0.1.0" },
    filter: {
      applied,
      isFiltered: Object.keys(applied).length > 0,
      appliedTo: ["overview", "daily", "weekly", "monthly", "sessions", "activity", "skills.uses"],
      notApplied: Object.fromEntries(Object.entries(NOT_FILTERED).map(([k, v]) => [k, v[lang] ?? v.es])),
    },
    pricing: pricingStatus(),
    providers: detectAll(),
    overview: A.overview(db, f),
    daily: A.daily(db, f),
    weekly: A.bucketed(db, "week", f),
    monthly: A.bucketed(db, "month", f),
    sessions: A.sessions(db, { ...f, limit: 1000, sort: "cost" }),
    activity: A.activity(db, f),
    skills: skills(db, f),
    memory: memories().files.map(({ preview, ...rest }) => rest),   // el cuerpo no se exporta
    cursor: cursorStats(db),
    recommendations: recommend(db),
  };
}

export function sessionRows(db: Database, f: A.Filters = {}): Row[] {
  // mismo criterio que el listado: el filtro corta mensajes, no sesiones enteras
  const parts: string[] = ["m.session_id IS NOT NULL"];
  const args: unknown[] = [];
  if (f.from) { parts.push("m.ts >= ?"); args.push(f.from); }
  if (f.to) { parts.push("m.ts <= ?"); args.push(f.to); }
  if (f.project) { parts.push("s.project = ?"); args.push(f.project); }
  if (f.provider) { parts.push("m.provider = ?"); args.push(f.provider); }
  if (f.model) { parts.push("m.model = ?"); args.push(f.model); }
  const t = A.whereTools(f);

  return db.query(`
    SELECT s.provider, s.id, s.project, s.title, s.git_branch AS branch, s.version,
           coalesce(min(m.ts), s.first_ts) AS first_ts,
           coalesce(max(m.ts), s.last_ts) AS last_ts,
           round((julianday(max(m.ts)) - julianday(min(m.ts))) * 86400) AS duration_s,
           count(*) AS messages,
           sum(m.input) AS input, sum(m.output) AS output,
           sum(m.cache_w5 + m.cache_w1) AS cache_write, sum(m.cache_read) AS cache_read,
           sum(m.input + m.output + m.cache_w5 + m.cache_w1 + m.cache_read) AS tokens,
           round(sum(m.cost_usd), 6) AS cost_usd,
           min(m.priced) AS priced,
           group_concat(DISTINCT m.model) AS models,
           (SELECT count(*) FROM tool_calls t WHERE ${t.sql} AND t.session_id = s.id) AS tool_calls
    FROM sessions s JOIN messages m ON m.session_id = s.id
    WHERE ${parts.join(" AND ")}
    GROUP BY s.id ORDER BY cost_usd DESC`).all(...t.args, ...args) as Row[];
}

export interface Written { path: string; name: string; dir: string; bytes: number }

/** Escribe siempre dentro del Motor. Nunca toca las carpetas de las herramientas. */
export function writeExport(db: Database, f: A.Filters = {}, lang: Lang = "es",
  stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)): Written[] {
  const dir = join(DATA_DIR, "exports");
  mkdirSync(dir, { recursive: true });

  // el nombre avisa de que el volcado esta acotado: dos exports no deben confundirse
  const tag = Object.values(f).some(Boolean) ? "-filtrado" : "";

  const files: Array<[string, string]> = [
    [`motor-agentico-${stamp}${tag}.json`, JSON.stringify(bundle(db, f, lang), null, 2)],
    [`sesiones-${stamp}${tag}.csv`, toCsv(sessionRows(db, f))],
    [`coste-diario-${stamp}${tag}.csv`, toCsv(A.daily(db, f) as Row[])],
  ];

  return files.map(([name, content]) => {
    const path = join(dir, name);
    writeFileSync(path, content, "utf8");
    return { path, name: basename(path), dir: dirname(path), bytes: Buffer.byteLength(content, "utf8") };
  });
}
