import { join } from "node:path";
import { existsSync, statSync } from "node:fs";
import { openDb } from "../core/db";
import { ENGINE_ROOT } from "../core/paths";
import { pricingStatus, UNVERIFIED } from "../core/pricing";
import * as A from "../core/analytics";
import { skills, memories, liveSessions } from "../core/inventory";
import { recommend, saveRecommendations } from "../core/recommend";
import { writeExport, bundle, toCsv, sessionRows, type Lang } from "../core/export";
import { detectAll } from "../providers/registry";
import { cursorStats } from "../providers/cursor";
import { indexAll } from "../index";

const WEB = join(ENGINE_ROOT, "web");
const db = openDb();

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });

function filtersFrom(u: URL): A.Filters {
  const f: A.Filters = {};
  for (const k of ["from", "to", "project", "model", "provider"] as const) {
    const v = u.searchParams.get(k);
    if (v) f[k] = v;
  }
  return f;
}

const routes: Record<string, (u: URL) => unknown> = {
  "/api/health": () => ({
    ok: true,
    engineRoot: ENGINE_ROOT,
    pricing: { ...pricingStatus(), unverifiedModels: [...UNVERIFIED] },
    indexedFiles: db.query("SELECT count(*) AS n, sum(size) AS bytes FROM files").get(),
    lastIndexed: db.query("SELECT max(indexed_at) AS at FROM files").get(),
  }),
  "/api/providers": () => detectAll(),
  "/api/facets": () => A.facets(db),
  "/api/overview": (u) => A.overview(db, filtersFrom(u)),
  "/api/costs/daily": (u) => A.daily(db, filtersFrom(u)),
  "/api/costs/weekly": (u) => A.bucketed(db, "week", filtersFrom(u)),
  "/api/costs/monthly": (u) => A.bucketed(db, "month", filtersFrom(u)),
  "/api/sessions": (u) => A.sessions(db, {
    ...filtersFrom(u),
    limit: Number(u.searchParams.get("limit") ?? 100),
    offset: Number(u.searchParams.get("offset") ?? 0),
    sort: u.searchParams.get("sort") ?? "date",
    q: u.searchParams.get("q") ?? undefined,
  }),
  "/api/activity": (u) => ({ ...A.activity(db, filtersFrom(u)), live: liveSessions(db) }),
  "/api/skills": (u) => skills(db, filtersFrom(u)),
  "/api/memory": () => memories(),
  "/api/graph": () => A.graph(db),
  "/api/cursor": () => cursorStats(db),
  "/api/recommendations": () => {
    const r = recommend(db);
    saveRecommendations(r);
    return r;
  },
};

export function serve(port: number) {
  const server = Bun.serve({
    port,
    hostname: "127.0.0.1", // local first: no se expone a la red
    async fetch(req) {
      const u = new URL(req.url);

      if (u.pathname === "/api/reindex" && req.method === "POST") {
        return json(indexAll(db));
      }
      // escribe los ficheros junto al Motor: no depende de que el navegador permita descargas
      if (u.pathname === "/api/export" && req.method === "POST") {
        const f = filtersFrom(u);
        const lang: Lang = u.searchParams.get("lang") === "en" ? "en" : "es";
        try { return json({ files: writeExport(db, f, lang), filter: f }); }
        catch (e) { return json({ error: String(e) }, 500); }
      }
      // y la descarga directa, para cuando se abre en un navegador de verdad
      if (u.pathname === "/api/export") {
        const fmt = u.searchParams.get("format") ?? "json";
        const stamp = new Date().toISOString().slice(0, 10);
        const gf = filtersFrom(u);
        const glang: Lang = u.searchParams.get("lang") === "en" ? "en" : "es";
        const tag = Object.values(gf).some(Boolean) ? "-filtrado" : "";
        const [body, type, name] = fmt === "csv"
          ? [toCsv(sessionRows(db, gf)), "text/csv; charset=utf-8", `sesiones-${stamp}${tag}.csv`]
          : [JSON.stringify(bundle(db, gf, glang), null, 2), "application/json; charset=utf-8", `motor-agentico-${stamp}${tag}.json`];
        return new Response(body, { headers: {
          "content-type": type,
          "content-disposition": `attachment; filename="${name}"`,
          "cache-control": "no-store",
        } });
      }
      const m = u.pathname.match(/^\/api\/sessions\/([\w-]+)$/);
      if (m && m[1]) {
        const d = A.sessionDetail(db, m[1]);
        return d ? json(d) : json({ error: "not found" }, 404);
      }
      const h = routes[u.pathname];
      if (h) {
        try { return json(h(u)); }
        catch (e) { return json({ error: String(e) }, 500); }
      }

      const file = u.pathname === "/" ? "index.html" : u.pathname.slice(1);
      const path = join(WEB, file);
      if (!path.startsWith(WEB) || !existsSync(path) || !statSync(path).isFile()) {
        return new Response("not found", { status: 404 });
      }
      // dashboard local: nunca cachear estaticos, el fichero cambia al editar
      return new Response(Bun.file(path), { headers: { "cache-control": "no-store" } });
    },
  });
  return server;
}
