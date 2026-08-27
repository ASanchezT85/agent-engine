import { openDb } from "./core/db";
import { indexAll } from "./index";
import { detectAll } from "./providers/registry";
import { serve } from "./server/server";
import { recommend, saveRecommendations } from "./core/recommend";
import { UNVERIFIED, pricingStatus } from "./core/pricing";
import { FOREIGN_ROOTS, isForeign } from "./core/paths";
import { statSync } from "node:fs";

const cmd = process.argv[2] ?? "help";
const mb = (n: number) => (n / 1048576).toFixed(1) + " MB";

if (cmd === "detect") {
  console.table(detectAll());
} else if (cmd === "index") {
  const db = openDb();
  const r = indexAll(db);
  for (const p of r.providers) console.log(" ", JSON.stringify(p));
  console.log(`indexado en ${(r.ms / 1000).toFixed(1)}s`);
  if (UNVERIFIED.size) console.warn("UNVERIFIED (sin tarifa, coste contado como 0):", [...UNVERIFIED].join(", "));
} else if (cmd === "audit") {
  // Auditoria read-only: verifica que ninguna raiz externa fue tocada por el Motor.
  for (const s of pricingStatus().sources) {
    console.log(`  tarifas ${s.vendor}: ${s.verified ? "VERIFICADAS " + s.verifiedAt : "UNVERIFIED"} - ${s.url}`);
  }
  for (const r of FOREIGN_ROOTS) {
    try {
      const st = statSync(r);
      console.log(`  read-only guard OK  ${r}  (mtime ${new Date(st.mtimeMs).toISOString()})`);
    } catch { console.log(`  ausente             ${r}`); }
  }
  console.log("isForeign(~/.claude) =", isForeign(FOREIGN_ROOTS[0]!));
  const db = openDb();
  const recs = recommend(db);
  console.log(`\n${recs.length} recomendaciones -> ${saveRecommendations(recs)}`);
  // el texto de la recomendacion lo pone el dashboard: aqui solo id, severidad y numeros
  for (const r of recs) {
    const p = Object.entries(r.params).map(([k, v]) => `${k}=${v}`).join(" ");
    console.log(`  [${r.severity}] ${r.id}${p ? "  " + p : ""}`);
  }
} else if (cmd === "serve") {
  const port = Number(process.env["PORT"] ?? 4823);

  // Arrancar dos veces es lo normal; que la segunda escupa un volcado de pila, no.
  const yaEsElMotor = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(1500) })
    .then((r) => r.json())
    .then((h: { ok?: boolean; engineRoot?: string }) => (h?.ok ? h.engineRoot ?? "" : null))
    .catch(() => null);

  if (yaEsElMotor !== null) {
    console.log(`El Motor ya esta corriendo en http://127.0.0.1:${port}`);
    console.log(`  lo sirve: ${yaEsElMotor}`);
    console.log(`  abrelo en el navegador, o usa otro puerto:  PORT=4824 bun run serve`);
    process.exit(0);
  }

  const db = openDb();
  const before = db.query<{ n: number }, []>("SELECT count(*) AS n FROM messages").get();
  if (!before?.n) {
    console.log("base vacia, indexando por primera vez...");
    const r = indexAll(db);
    console.log(`  ${r.providers.map((p) => JSON.stringify(p)).join("\n  ")}`);
  }

  let s;
  try {
    s = serve(port);
  } catch (e) {
    // el puerto esta ocupado por OTRA cosa: se dice quien y como salir del paso
    console.error(`No se pudo abrir el puerto ${port}: lo tiene ocupado otro programa.`);
    console.error(`  ver cual:   netstat -ano | findstr :${port}`);
    console.error(`  o cambiar:  PORT=4824 bun run serve`);
    console.error(String(e).split("\n")[0]);
    process.exit(1);
  }

  const stats = db.query<{ n: number; bytes: number }, []>("SELECT count(*) AS n, sum(size) AS bytes FROM files").get();
  console.log(`Motor Agentico -> http://127.0.0.1:${s.port}`);
  console.log(`  ${stats?.n ?? 0} archivos indexados (${mb(stats?.bytes ?? 0)})`);
} else {
  console.log(`Motor Agentico - dashboard local de observabilidad de agentes IA

  bun run detect    lista proveedores detectados
  bun run index     indexacion incremental
  bun run serve     dashboard en http://127.0.0.1:4823
  bun run audit     auditoria read-only + recomendaciones`);
}
