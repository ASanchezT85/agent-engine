import type { Database } from "bun:sqlite";
import { providers } from "./providers/registry";

export function indexAll(db: Database) {
  const started = Date.now();
  const perProvider = providers.map((p) => {
    const det = p.detect();
    if (!det.installed) return { provider: p.id, skipped: true, reason: "no detectado" };
    const r = p.index(db);
    return { provider: p.id, ...r };
  });
  return { ms: Date.now() - started, providers: perProvider };
}
