import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ENGINE_ROOT } from "./paths";
import type { Usage } from "./types";

interface Rate { input: number; cacheWrite5m: number; cacheWrite1h: number; cacheRead: number; output: number;
                 vendor?: string; fast?: { input: number; output: number } }
interface Source { url: string; verified: boolean; verifiedAt: string; note?: string }
interface PricingFile {
  models: Record<string, Rate>;
  multipliers: { inference_geo_us: number; batch: number };
  serverTools: Record<string, { usd_per_request: number; verified: boolean }>;
  free: string[];
  sources: Record<string, Source>;
}

/** Verificado solo si TODAS las fuentes lo estan. */
export function pricingStatus() {
  const src = pricing().sources;
  const list = Object.entries(src).map(([vendor, s]) => ({ vendor, ...s }));
  return {
    verified: list.every((s) => s.verified),
    verifiedAt: list.map((s) => s.verifiedAt).sort().at(0) ?? null,
    sources: list,
  };
}

const FILE = join(ENGINE_ROOT, "config", "pricing.json");
let cache: PricingFile | null = null;
export function pricing(): PricingFile {
  if (!cache) cache = JSON.parse(readFileSync(FILE, "utf8")) as PricingFile;
  return cache;
}

/** claude-opus-4-5-20250101 -> claude-opus-4-5 ; claude-3-5-haiku-x -> claude-haiku-3-5 */
export function normalizeModel(raw: string | null | undefined): string {
  if (!raw) return "unknown";
  let m = raw.toLowerCase().trim();
  m = m.replace(/-\d{8}$/, "").replace(/^(?:us|eu|apac)\.anthropic\./, "").replace(/-v\d+:\d+$/, "");
  m = m.replace(/^[a-z0-9-]+\//, "");   // OpenCode nombra los modelos "<provider>/<id>"
  const legacy = m.match(/^claude-(\d)-(\d)-(opus|sonnet|haiku)$/);
  if (legacy) m = `claude-${legacy[3]}-${legacy[1]}-${legacy[2]}`;
  return m;
}

export const UNVERIFIED = new Set<string>();

export function rateFor(model: string): Rate | null {
  const p = pricing();
  const key = normalizeModel(model);
  if (p.free.includes(key) || key === "unknown") return null;
  const r = p.models[key];
  if (!r) { UNVERIFIED.add(key); return null; }
  return r;
}

export interface CostBreakdown { input: number; output: number; cacheWrite: number; cacheRead: number; serverTools: number; total: number; priced: boolean }

export function costOf(model: string | null, u: Usage, opts: { speed?: string | null; inferenceGeo?: string | null } = {}): CostBreakdown {
  const zero: CostBreakdown = { input: 0, output: 0, cacheWrite: 0, cacheRead: 0, serverTools: 0, total: 0, priced: false };
  const p = pricing();
  const st = p.serverTools;
  const tools = u.webSearches * (st["web_search_requests"]?.usd_per_request ?? 0) + u.webFetches * (st["web_fetch_requests"]?.usd_per_request ?? 0);
  const r = model ? rateFor(model) : null;
  // modelo gratuito conocido (p.ej. <synthetic>): coste 0 pero SI tarifado, no es un hueco
  const free = model ? p.free.includes(normalizeModel(model)) : false;
  if (!r) return { ...zero, serverTools: tools, total: tools, priced: free };

  const fast = opts.speed === "fast" && r.fast;
  const inRate = fast ? r.fast!.input : r.input;
  const outRate = fast ? r.fast!.output : r.output;
  // los multiplicadores de cache son 1.25x / 2x / 0.1x sobre el input base efectivo
  const w5 = fast ? inRate * 1.25 : r.cacheWrite5m;
  const w1 = fast ? inRate * 2 : r.cacheWrite1h;
  const rd = fast ? inRate * 0.1 : r.cacheRead;
  const geo = opts.inferenceGeo === "us" ? p.multipliers.inference_geo_us : 1;
  const M = 1_000_000;

  const input = (u.input * inRate * geo) / M;
  const output = (u.output * outRate * geo) / M;
  const cacheWrite = ((u.cacheWrite5m * w5 + u.cacheWrite1h * w1) * geo) / M;
  const cacheRead = (u.cacheRead * rd * geo) / M;
  const total = input + output + cacheWrite + cacheRead + tools;
  return { input, output, cacheWrite, cacheRead, serverTools: tools, total, priced: true };
}
