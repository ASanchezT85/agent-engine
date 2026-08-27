"use strict";
const $ = (s) => document.querySelector(s);
const app = $("#app");
const api = (p) => fetch(p).then((r) => r.json());

/** Los numeros y fechas se formatean con el locale activo, no con uno fijo. */
const loc = () => (lang() === "en" ? "en-US" : "es-ES");
const n0 = (n) => (Number(n) || 0).toLocaleString(loc());
const usd = (n) => "$" + (Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const usd4 = (n) => "$" + (Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 4, maximumFractionDigits: 4 });
const tok = (n) => { n = Number(n) || 0; return n >= 1e9 ? (n / 1e9).toFixed(2) + "B" : n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1e3 ? (n / 1e3).toFixed(1) + "k" : String(n); };
const bytes = (n) => { n = Number(n) || 0; return n >= 1048576 ? (n / 1048576).toFixed(1) + " MB" : (n / 1024).toFixed(0) + " KB"; };
const dur = (s) => { s = Math.max(0, Number(s) || 0); const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60); return h ? h + "h " + m + "m" : m + "m"; };
const dt = (s) => (s ? String(s).slice(0, 16).replace("T", " ") : "—");
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const shortProject = (p) => String(p ?? "—").split(/[\\/]/).filter(Boolean).slice(-2).join("/");

/* --- estado --- */
const state = {
  view: "overview", sort: "date", q: "", sessionId: null, showAll: false,
  filters: { from: "", to: "", provider: "", project: "" },
};

function qs(extra = {}) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...state.filters, ...extra })) if (v) p.set(k, v);
  const s = p.toString();
  return s ? "?" + s : "";
}
const filtered = () => Object.values(state.filters).some(Boolean);

/* --- fechas escritas a mano ---
   El <input type="date"> nativo no deja elegir el formato: lo impone el locale del
   navegador (aqui salia mm/dd/aaaa). Se usa un campo de texto en dd/mm/aaaa y se
   conserva el calendario del sistema en un boton, via showPicker(). */
const pad2 = (v) => String(v).padStart(2, "0");
const isoToDmy = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "");

/** Devuelve YYYY-MM-DD, o null si no es una fecha real (31/02 no lo es). */
function dmyToIso(texto) {
  const s = String(texto ?? "").trim();
  if (!s) return "";
  const m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/) // dd/mm/aaaa
    ?? s.match(/^(\d{4})-(\d{2})-(\d{2})$/)?.slice(0).map((x, i, a) => (i === 1 ? a[3] : i === 3 ? a[1] : x));
  if (!m) return null;
  const iso = `${m[3]}-${pad2(m[2])}-${pad2(m[1])}`;
  const d = new Date(iso + "T00:00:00.000Z");
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso ? iso : null;
}

/* --- presets de fecha, en UTC para casar con los timestamps guardados --- */
const dayStart = (d) => d.toISOString().slice(0, 10) + "T00:00:00.000Z";
const dayEnd = (d) => d.toISOString().slice(0, 10) + "T23:59:59.999Z";
const daysAgo = (n) => new Date(Date.now() - n * 864e5);

const PRESETS = [
  { id: "all", range: () => ({ from: "", to: "" }) },
  { id: "today", range: () => ({ from: dayStart(new Date()), to: dayEnd(new Date()) }) },
  { id: "7d", range: () => ({ from: dayStart(daysAgo(6)), to: dayEnd(new Date()) }) },
  { id: "30d", range: () => ({ from: dayStart(daysAgo(29)), to: dayEnd(new Date()) }) },
  { id: "month", range: () => {
    const n = new Date();
    return { from: new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), 1)).toISOString(), to: dayEnd(n) };
  } },
];

const activePreset = () => PRESETS.find((p) => {
  const r = p.range();
  return r.from === state.filters.from && r.to === state.filters.to;
})?.id ?? null;

/**
 * Las facetas se piden una vez y SIN filtrar: si se filtraran, elegir un proveedor
 * sin datos vaciaria su propio desplegable y no habria como volver atras.
 */
let facetsPromise = null;
const facets = () => (facetsPromise ??= api("/api/facets"));

/* --- piezas de UI --- */
const anchor = (label, figure, caption) =>
  `<div class="anchor"><div class="label">${esc(label)}</div><div class="figure">${figure}</div>${caption ? `<div class="caption">${caption}</div>` : ""}</div>`;

const metric = (k, v, s) =>
  `<div class="metric"><div class="k">${esc(k)}</div><div class="v">${v}</div>${s ? `<div class="s">${s}</div>` : ""}</div>`;

/** Campo de fecha en dd/mm/aaaa + boton que abre el calendario nativo del sistema. */
function dateField(id, label, isoValue) {
  return `<label for="${id}">${esc(label)}</label>
    <span class="datefield">
      <input type="text" id="${id}" inputmode="numeric" size="10" autocomplete="off"
             placeholder="${esc(t("date.placeholder"))}" value="${esc(isoToDmy(isoValue.slice(0, 10)))}">
      <input type="date" id="${id}-pick" tabindex="-1" aria-hidden="true" value="${esc(isoValue.slice(0, 10))}">
      <button type="button" class="cal" data-pick="${id}" title="${esc(t("date.pick"))}" aria-label="${esc(t("date.pick"))}">▾</button>
    </span>`;
}

function filterBar(f) {
  const active = activePreset();
  const presets = PRESETS.map((p) =>
    `<button class="chip${p.id === active ? " on" : ""}" data-preset="${p.id}">${esc(t("preset." + p.id))}</button>`).join("");

  const select = (id, value, empty, rows, key, label) =>
    `<select id="${id}" aria-label="${esc(empty)}">` +
    [`<option value="">${esc(empty)}</option>`].concat(rows.map((r) =>
      `<option value="${esc(r[key])}" ${r[key] === value ? "selected" : ""}>${esc(label(r[key]))} (${r.sessions})</option>`)).join("") +
    `</select>`;

  return `<div class="filters">
    <span class="chips">${presets}</span>
    ${dateField("f-from", t("filter.from"), state.filters.from)}
    ${dateField("f-to", t("filter.to"), state.filters.to)}
    ${select("f-provider", state.filters.provider, t("filter.allProviders"), f.providers, "provider", (v) => v)}
    ${select("f-project", state.filters.project, t("filter.allProjects"), f.projects, "project", shortProject)}
    ${filtered() ? `<button class="action" id="f-clear">${esc(t("filter.clear"))}</button>` : ""}
  </div>`;
}

function table(cols, rows, opts = {}) {
  if (!rows.length) return `<p class="note">${esc(t(filtered() ? "table.noDataFiltered" : "table.noData"))}</p>`;
  const shown = opts.limit ? rows.slice(0, opts.limit) : rows;
  const head = cols.map((c) => `<th${c.num ? ' class="num"' : ""}>${esc(c.h)}</th>`).join("");
  const body = shown.map((r) => `<tr${opts.rowAttr ? opts.rowAttr(r) : ""}>` +
    cols.map((c) => `<td${c.num ? ' class="num"' : c.trunc ? ' class="trunc"' : ""}>${c.f(r)}</td>`).join("") + "</tr>").join("");
  const more = shown.length < rows.length
    ? `<p class="note">${esc(t("table.showing", { shown: shown.length, total: rows.length }))}
       <button class="action" data-showall="1">${esc(t("table.seeAll"))}</button></p>` : "";
  // el contenedor scrollea, nunca el body: tabla ancha en movil no rompe la pagina
  return `<div class="scroll"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>${more}`;
}

/* --- graficos SVG a mano: sin dependencias, sin CDN --- */
function lineChart(data, xKey, yKey, fmt = usd) {
  if (data.length < 2) return `<p class="note">${esc(t("chart.needPoints"))}</p>`;
  const W = 900, H = 200, L = 58, R = 8, T = 12, Bm = 26;
  const max = Math.max(...data.map((d) => Number(d[yKey]) || 0), 1e-9);
  const x = (i) => L + (i * (W - L - R)) / (data.length - 1);
  const y = (v) => H - Bm - (v / max) * (H - Bm - T);
  const pts = data.map((d, i) => `${x(i).toFixed(1)},${y(Number(d[yKey]) || 0).toFixed(1)}`).join(" ");
  const area = `M${x(0)},${H - Bm} L${pts.split(" ").join(" L")} L${x(data.length - 1)},${H - Bm} Z`;
  const ticks = [0, 0.5, 1].map((f) =>
    `<line x1="${L}" x2="${W - R}" y1="${y(max * f)}" y2="${y(max * f)}" stroke="var(--rule)"/>` +
    `<text x="0" y="${y(max * f) + 3.5}">${fmt(max * f)}</text>`).join("");
  const step = Math.ceil(data.length / 8);
  // la primera y la ultima se anclan al borde: centradas se salen del viewBox y el SVG las recorta
  const labels = data.map((d, i) => {
    if (i % step !== 0 && i !== data.length - 1) return "";
    const last = i === data.length - 1;
    const anch = i === 0 ? "start" : last ? "end" : "middle";
    if (last && (data.length - 1) % step !== 0 && (data.length - 1) % step < step / 2) return "";
    return `<text x="${x(i)}" y="${H - 8}" text-anchor="${anch}">${esc(d[xKey])}</text>`;
  }).join("");
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" style="min-height:200px;display:block">
    ${ticks}<path d="${area}" fill="var(--accent)" opacity=".10"/>
    <polyline points="${pts}" fill="none" stroke="var(--accent)" stroke-width="1.5"/>${labels}</svg>`;
}

function barList(rows, labelKey, valueKey, fmt = usd) {
  if (!rows.length) return `<p class="note">${esc(t(filtered() ? "table.noDataFiltered" : "table.noData"))}</p>`;
  const max = Math.max(...rows.map((r) => Number(r[valueKey]) || 0), 1e-9);
  return `<div class="rows">` + rows.map((r) => `<div>
    <div class="row-label"><span class="trunc">${esc(r[labelKey] ?? "—")}</span><span class="num">${fmt(r[valueKey])}</span></div>
    <div class="bar"><i style="width:${((Number(r[valueKey]) || 0) / max * 100).toFixed(1)}%"></i></div></div>`).join("") + `</div>`;
}

/* --- vistas --- */
const views = {
  async overview() {
    const [o, prov, health, f] = await Promise.all([
      api("/api/overview" + qs()), api("/api/providers"), api("/api/health"), facets()]);
    const tt = o.totals || {};
    const warn = tt.unpriced
      ? `<p class="note redacted">${esc(t("ov.unpriced", { n: n0(tt.unpriced) }))}</p>` : "";
    const rates = health.pricing.sources.map((s) =>
      (s.verified ? esc(t("ov.rateVerified", { vendor: s.vendor, date: s.verifiedAt }))
                  : `<b class="redacted">${esc(t("ov.rateUnverified", { vendor: s.vendor }))}</b>`) +
      ` (<a href="${esc(s.url)}" target="_blank" rel="noreferrer">${esc(s.vendor)}</a>)`).join(" · ");
    return `
    ${filterBar(f)}
    ${anchor(t(filtered() ? "ov.anchorFiltered" : "ov.anchor"), usd(tt.cost),
      esc(t("ov.caption", { sessions: n0(tt.sessions), messages: n0(tt.messages), tokens: tok(tt.tokens) })))}
    <div class="metrics">
      ${metric(t("ov.today"), usd(o.today?.cost), tok(o.today?.tokens) + " tok")}
      ${metric(t("ov.week"), usd(o.week?.cost), tok(o.week?.tokens) + " tok")}
      ${metric(t("ov.month"), usd(o.month?.cost), tok(o.month?.tokens) + " tok")}
      ${metric(t("ov.avgSession"), usd(tt.sessions ? tt.cost / tt.sessions : 0), t("ov.sessionsCount", { n: n0(tt.sessions) }))}
      ${metric(t("ov.models"), String(o.models.length), esc(o.models[0]?.model ?? "—"))}
      ${metric(t("ov.projects"), String(o.projects.length), esc(shortProject(o.projects[0]?.project)))}
    </div>
    ${warn}
    <div class="grid2">
      <div><h2>${esc(t("ov.costByModel"))}</h2>${barList(o.models, "model", "cost")}</div>
      <div><h2>${esc(t("ov.costByProject"))}</h2>${barList(o.projects.map((p) => ({ ...p, project: shortProject(p.project) })), "project", "cost")}</div>
    </div>
    <h2>${esc(t("ov.byTool"))}</h2>
    ${table([
      { h: t("col.provider"), f: (r) => esc(r.provider) },
      { h: t("col.sessions"), num: 1, f: (r) => n0(r.sessions) },
      { h: t("col.tokens"), num: 1, f: (r) => tok(r.tokens) },
      { h: t("col.cost"), num: 1, f: (r) => r.all_priced ? usd(r.cost) : `<span class="redacted">${esc(t("col.noRate"))}</span>` },
    ], o.byProvider)}
    <p class="note">${esc(t("ov.cursorNote"))}</p>
    <h2>${esc(t("ov.whereTokens"))}</h2>
    ${barList([
      { k: "Cache read", v: tt.cache_read }, { k: "Cache write", v: tt.cache_write },
      { k: "Output", v: tt.output }, { k: "Input", v: tt.input },
    ].sort((a, b) => b.v - a.v), "k", "v", tok)}
    <h2>${esc(t("ov.providers"))}</h2>
    ${table([
      { h: t("col.tool"), f: (r) => esc(r.label) },
      { h: t("col.status"), f: (r) => r.installed
        ? `<span class="pill live">${esc(t("status.detected"))}</span>`
        : `<span class="pill">${esc(t("status.notDetected"))}</span>` },
      { h: t("col.path"), f: (r) => `<code>${esc(r.root ?? "—")}</code>` },
      { h: t("col.note"), f: (r) => `<span class="muted">${esc(r.note ? t("prov." + r.note, r.noteParams) : "")}</span>` },
    ], prov)}
    <p class="note">${t("ov.ratesNote", { sources: rates })}${health.pricing.unverifiedModels.length
      ? esc(t("ov.unpricedModels", { list: health.pricing.unverifiedModels.join(", ") })) : ""}</p>
    <p class="note">${esc(t("ov.estimate"))}</p>`;
  },

  async costs() {
    const [d, w, m, o, f] = await Promise.all([
      api("/api/costs/daily" + qs()), api("/api/costs/weekly" + qs()),
      api("/api/costs/monthly" + qs()), api("/api/overview" + qs()), facets()]);
    const peak = d.reduce((a, b) => (Number(b.cost) > Number(a.cost) ? b : a), d[0] ?? {});
    return `
    ${filterBar(f)}
    ${anchor(t("cost.peak"), usd(peak.cost),
      esc(t("cost.peakCaption", { day: peak.day ?? "—", tokens: tok(peak.tokens), sessions: peak.sessions ?? 0 })))}
    <h2>${esc(t(filtered() ? "cost.daily" : "cost.daily90"))}</h2>${lineChart(d.slice(-90), "day", "cost")}
    <h2>${esc(t("cost.tokensDaily"))}</h2>${lineChart(d.slice(-90), "day", "tokens", tok)}
    <div class="grid2">
      <div><h2>${esc(t("cost.weekly"))}</h2>${table([
        { h: t("col.week"), f: (r) => esc(r.bucket) }, { h: t("col.sessions"), num: 1, f: (r) => r.sessions },
        { h: t("col.tokens"), num: 1, f: (r) => tok(r.tokens) }, { h: t("col.cost"), num: 1, f: (r) => usd(r.cost) }], w.slice(-14).reverse())}</div>
      <div><h2>${esc(t("cost.monthly"))}</h2>${table([
        { h: t("col.month"), f: (r) => esc(r.bucket) }, { h: t("col.sessions"), num: 1, f: (r) => r.sessions },
        { h: t("col.tokens"), num: 1, f: (r) => tok(r.tokens) }, { h: t("col.cost"), num: 1, f: (r) => usd(r.cost) }], m.slice(-12).reverse())}</div>
    </div>
    <h2>${esc(t("cost.byModel"))}</h2>${table([
      { h: t("col.model"), f: (r) => esc(r.model) }, { h: t("col.messages"), num: 1, f: (r) => n0(r.messages) },
      { h: t("col.tokens"), num: 1, f: (r) => tok(r.tokens) }, { h: t("col.cost"), num: 1, f: (r) => usd(r.cost) },
      { h: t("col.rate"), f: (r) => r.priced ? esc(t("rate.verified")) : `<span class="redacted">${esc(t("rate.unverified"))}</span>` }], o.models)}
    <h2>${esc(t("cost.byProject"))}</h2>${table([
      { h: t("col.project"), f: (r) => esc(shortProject(r.project)) }, { h: t("col.sessions"), num: 1, f: (r) => r.sessions },
      { h: t("col.tokens"), num: 1, f: (r) => tok(r.tokens) }, { h: t("col.cost"), num: 1, f: (r) => usd(r.cost) }], o.projects)}`;
  },

  async sessions() {
    const sort = state.sort, q = state.q;
    const [rows, f] = await Promise.all([
      api("/api/sessions" + qs({ limit: 500, sort, q })), facets()]);
    const top = rows[0];
    return `
    ${filterBar(f)}
    <div class="filters">
      <input id="q" placeholder="${esc(t("ses.search"))}" value="${esc(q)}" size="30">
      <label for="sort">${esc(t("ses.sortBy"))}</label>
      <select id="sort">${["date", "cost", "tokens", "tools"]
        .map((v) => `<option value="${v}" ${v === sort ? "selected" : ""}>${esc(t("sort." + v))}</option>`).join("")}</select>
      <span class="muted">${esc(t("ses.count", { n: n0(rows.length) }))}</span>
    </div>
    ${top ? anchor(t(sort === "cost" ? "ses.mostExpensive" : "ses.mostRecent"), usd4(top.cost),
      esc(t("ses.anchorCaption", { title: top.title ?? top.id, project: shortProject(top.project),
        tokens: tok(top.tokens), tools: top.tools }))) : ""}
    ${table([
      { h: t("col.date"), f: (r) => dt(r.last_ts) },
      { h: t("col.project"), f: (r) => esc(shortProject(r.project)) },
      { h: t("col.title"), trunc: 1, f: (r) => esc(r.title ?? r.id) },
      { h: t("col.model"), f: (r) => esc(String(r.models ?? "").split(",").filter(Boolean).map((m) => m.replace("claude-", "")).join(", ")) },
      { h: t("col.duration"), num: 1, f: (r) => dur(r.duration_s) },
      { h: t("col.tokens"), num: 1, f: (r) => tok(r.tokens) },
      { h: t("col.tools"), num: 1, f: (r) => r.tools },
      { h: t("col.cost"), num: 1, f: (r) => usd4(r.cost) },
    ], rows, { limit: state.showAll ? 0 : 60, rowAttr: (r) => ` class="click" data-session="${esc(r.id)}"` })}`;
  },

  async session(id) {
    const d = await api("/api/sessions/" + id);
    if (d.error) return `<p class="note">${esc(t("ses.notFound"))}</p>`;
    const s = d.session, m = d.metrics;
    const toolCalls = d.tools.reduce((a, x) => a + x.n, 0);
    return `<p><button id="back" class="action">${esc(t("ses.back"))}</button></p>
    ${anchor(s.title ?? t("print.sessionDetail"), usd4(m.cost),
      `<code>${esc(s.id)}</code> · ${esc(shortProject(s.project))} · ${esc(s.git_branch ?? "—")} · ${esc(s.provider ?? "")} ${esc(s.version ?? "")}<br>
       ${dt(s.first_ts)} → ${dt(s.last_ts)}`)}
    <div class="metrics">
      ${metric(t("col.tokens"), tok(m.tokens))}
      ${metric("Input", tok(m.input))}
      ${metric("Output", tok(m.output))}
      ${metric(t("ses.cacheWR"), tok(m.cache_write) + " / " + tok(m.cache_read))}
      ${metric(t("col.messages"), n0(m.messages), t("ses.subagentMsgs", { n: n0(m.sidechain_messages) }))}
      ${metric(t("ses.toolCalls"), n0(toolCalls))}
    </div>
    <div class="grid2">
      <div><h2>${esc(t("ses.tools"))}</h2>${barList(d.tools.slice(0, 14), "name", "n", (n) => n)}</div>
      <div><h2>${esc(t("ses.models"))}</h2>${table([
        { h: t("col.model"), f: (r) => esc(r.model) }, { h: t("col.messages"), num: 1, f: (r) => r.messages },
        { h: t("col.tokens"), num: 1, f: (r) => tok(r.tokens) }, { h: t("col.cost"), num: 1, f: (r) => usd4(r.cost) }], d.byModel)}
        <h2>${esc(t("ses.skills"))}</h2>${d.skills.length ? d.skills.map((k) => `<span class="tag">${esc(k.skill)} ×${k.n}</span>`).join("") : `<p class="note">${esc(t("ses.none.f"))}</p>`}
        <h2>${esc(t("ses.subagents"))}</h2>${d.subagents.length ? d.subagents.map((k) => `<span class="tag">${esc(k.subagent)} ×${k.n}</span>`).join("") : `<p class="note">${esc(t("ses.none.m"))}</p>`}</div>
    </div>
    <h2>${esc(t("ses.hourly"))}</h2>${lineChart(d.timeline.map((x) => ({ ...x, hour: x.hour.slice(5) })), "hour", "cost")}`;
  },

  async activity() {
    const [a, f] = await Promise.all([api("/api/activity" + qs()), facets()]);
    const maxH = Math.max(...a.byHour.map((h) => h.n), 1);
    const busiest = a.byHour.reduce((x, y) => (y.n > x.n ? y : x), { hour: 0, n: 0 });
    return `
    ${filterBar(f)}
    ${anchor(t("act.anchor"), String(a.live.processes.length),
      a.live.processes.map((p) => `<span class="tag">pid ${p.pid}</span>`).join("") || esc(t("act.noneRunning")))}
    <p class="note">${esc(t("act.pidNote"))}</p>
    ${a.live.recentlyActive.length ? table([
      { h: t("col.session"), f: (r) => `<code>${esc(r.id.slice(0, 8))}</code>` },
      { h: t("col.project"), f: (r) => esc(shortProject(r.project)) },
      { h: t("col.title"), trunc: 1, f: (r) => esc(r.title ?? "—") },
      { h: t("col.lastEvent"), f: (r) => dt(r.last_ts) }], a.live.recentlyActive,
      { rowAttr: (r) => ` class="click" data-session="${esc(r.id)}"` })
      : `<p class="note">${esc(t("act.noneRecent"))}</p>`}
    <h2>${esc(t("act.recent"))}</h2>${table([
      { h: t("col.date"), f: (r) => dt(r.last_ts) }, { h: t("col.project"), f: (r) => esc(shortProject(r.project)) },
      { h: t("col.title"), trunc: 1, f: (r) => esc(r.title ?? r.id) },
      { h: t("col.tokens"), num: 1, f: (r) => tok(r.tokens) }, { h: t("col.cost"), num: 1, f: (r) => usd4(r.cost) }],
      a.recentSessions, { rowAttr: (r) => ` class="click" data-session="${esc(r.id)}"` })}
    <div class="grid2">
      <div><h2>${esc(t("act.topTools"))}</h2>${barList(a.tools.slice(0, 16), "name", "n", (n) => n)}</div>
      <div>
        <h2>${esc(t("act.byHour", { hour: busiest.hour }))}</h2>
        <div class="hours">${Array.from({ length: 24 }, (_, h) => {
          const v = a.byHour.find((x) => x.hour === h)?.n ?? 0;
          return `<i title="${esc(t("act.hourTitle", { hour: h, n: v }))}" style="height:${(v / maxH * 100).toFixed(0)}%"></i>`;
        }).join("")}</div>
        <div class="axis"><span>00h</span><span>12h</span><span>23h</span></div>
        <h2>${esc(t("act.byWeekday"))}</h2>${barList(a.byWeekday.map((d) => ({ d: t("weekday." + Number(d.weekday)), n: d.n })), "d", "n", (n) => n)}
      </div>
    </div>
    <div class="grid2">
      <div><h2>${esc(t("act.skills"))}</h2>${a.skills.length ? barList(a.skills, "skill", "n", (n) => n) : `<p class="note">${esc(t("act.noSkills"))}</p>`}</div>
      <div><h2>${esc(t("act.subagents"))}</h2>${a.subagents.length ? barList(a.subagents, "subagent", "n", (n) => n) : `<p class="note">${esc(t("act.noSubagents"))}</p>`}
        <h2>${esc(t("act.mcp"))}</h2>${a.mcp.length ? table([{ h: t("col.server"), f: (r) => esc(r.server) }, { h: t("col.tool"), f: (r) => esc(r.tool) },
          { h: "n", num: 1, f: (r) => r.n }], a.mcp, { limit: state.showAll ? 0 : 12 }) : `<p class="note">${esc(t("act.noMcp"))}</p>`}</div>
    </div>`;
  },

  async cursor() {
    const c = await api("/api/cursor");
    if (!c.available) return `<p class="note">${esc(t("cur.notIndexed"))}</p>`;
    const tt = c.totals, a = c.authorship;
    const pct = a.lines_added ? (a.ai_lines / a.lines_added * 100) : 0;
    return `
    ${anchor(t("cur.anchor"), pct.toFixed(1) + "%",
      esc(t("cur.caption", { ai: n0(a.ai_lines), total: n0(a.lines_added), commits: a.commits,
        from: dt(a.first_commit), to: dt(a.last_commit) })))}
    <div class="metrics">
      ${metric(t("col.sessions"), n0(tt.sessions), t("cur.subagents", { n: n0(tt.subagents) }))}
      ${metric(t("col.messages"), n0(tt.messages))}
      ${metric(t("col.linesPM"), n0(tt.lines_added) + " / " + n0(tt.lines_removed))}
      ${metric(t("ses.toolCalls"), n0(c.tools.reduce((x, y) => x + y.n, 0)))}
      ${metric(t("cur.peakContext"), tok(tt.peak_context), t("cur.peakNote"))}
      ${metric(t("ov.models"), String(c.models.length))}
    </div>
    <div class="grid2">
      <div><h2>${esc(t("cur.byModel"))}</h2>${barList(c.models, "model", "sessions", (n) => n)}</div>
      <div><h2>${esc(t("cur.tools"))}</h2>${barList(c.tools.slice(0, 12), "name", "n", (n) => n0(n))}</div>
    </div>
    <h2>${esc(t("cur.byBranch"))}</h2>${table([
      { h: t("col.branch"), f: (r) => esc(r.branch ?? "—") },
      { h: t("col.commits"), num: 1, f: (r) => r.commits },
      { h: t("col.linesAdded"), num: 1, f: (r) => n0(r.lines_added) },
      { h: t("col.fromAI"), num: 1, f: (r) => n0(r.ai_lines) },
      { h: "%", num: 1, f: (r) => r.lines_added ? (r.ai_lines / r.lines_added * 100).toFixed(1) + "%" : "—" },
    ], c.byBranch)}
    <h2>${esc(t("cur.sessions"))}</h2>${table([
      { h: t("col.updated"), f: (r) => dt(r.updated_at ?? r.created_at) },
      { h: t("col.title"), trunc: 1, f: (r) => esc(r.title || t("cur.noTitle")) + (r.is_subagent ? ` <span class="muted">${esc(t("cur.subagent"))}</span>` : "") },
      { h: t("col.model"), f: (r) => esc(r.model ?? "—") },
      { h: t("col.mode"), f: (r) => `<span class="muted">${esc(r.mode ?? "—")}</span>` },
      { h: t("col.messages"), num: 1, f: (r) => n0(r.messages) },
      { h: t("col.tools"), num: 1, f: (r) => n0(r.tools) },
      { h: t("col.linesPM"), num: 1, f: (r) => (r.lines_added || 0) + " / " + (r.lines_removed || 0) },
      { h: t("col.context"), num: 1, f: (r) => r.context_tokens ? tok(r.context_tokens) + " / " + tok(r.context_limit) : "—" },
    ], c.sessions, { limit: state.showAll ? 0 : 40 })}
    <h2>${esc(t("cur.commits"))}</h2>${table([
      { h: t("col.date"), f: (r) => dt(r.committed_at) },
      { h: t("col.branch"), f: (r) => esc(r.branch ?? "—") },
      { h: t("col.message"), trunc: 1, f: (r) => esc(r.message ?? "—") },
      { h: t("col.linesAdded"), num: 1, f: (r) => n0(r.lines_added) },
      { h: t("col.fromAI"), num: 1, f: (r) => n0(r.ai_lines) },
      { h: t("col.human"), num: 1, f: (r) => n0(r.human_lines) },
      { h: t("col.pctAI"), num: 1, f: (r) => esc(r.ai_pct ?? "—") },
    ], c.commits, { limit: state.showAll ? 0 : 25 })}
    <p class="note">${esc(t("cur.copyNote"))}</p>`;
  },

  async memory() {
    const m = await api("/api/memory");
    const types = Object.entries(m.files.reduce((acc, f) => (acc[f.type] = (acc[f.type] || 0) + 1, acc), {}))
      .map(([ty, n]) => ({ ty, n })).sort((a, b) => b.n - a.n);
    return `
    ${anchor(t("mem.anchor"), n0(m.stats.count),
      esc(t("mem.caption", { bytes: bytes(m.stats.bytes), links: n0(m.stats.links), redacted: n0(m.stats.redacted) })))}
    <div class="grid2">
      <div><h2>${esc(t("mem.byType"))}</h2>${barList(types, "ty", "n", (n) => n)}</div>
      <div><h2>${esc(t("mem.mostLinked"))}</h2>${barList(m.files.filter((f) => f.links.length).sort((a, b) => b.links.length - a.links.length)
        .slice(0, 8).map((f) => ({ n: f.name, l: f.links.length })), "n", "l", (n) => t("mem.linksCount", { n }))}</div>
    </div>
    <h2>${esc(t("mem.all"))}</h2>${table([
      { h: t("col.name"), f: (r) => esc(r.name) }, { h: t("col.type"), f: (r) => `<span class="muted">${esc(r.type)}</span>` },
      { h: t("col.description"), trunc: 1, f: (r) => esc(r.description) },
      { h: t("col.links"), num: 1, f: (r) => r.links.length || "" },
      { h: t("col.size"), num: 1, f: (r) => bytes(r.size) },
      { h: t("col.modified"), f: (r) => dt(r.modified) },
      { h: "", f: (r) => `<details><summary>${esc(t("mem.view"))}</summary><pre>${esc(r.preview)}</pre></details>` },
    ], m.files, { limit: state.showAll ? 0 : 40 })}`;
  },

  async skills() {
    const [s, f] = await Promise.all([api("/api/skills" + qs()), facets()]);
    const used = s.filter((x) => x.uses > 0);
    return `
    ${filterBar(f)}
    ${anchor(t("sk.anchor"), n0(s.length),
      esc(t("sk.caption", { used: used.length, unused: s.length - used.length, inFilter: filtered() ? t("sk.inFilter") : "" })))}
    ${used.length ? `<h2>${esc(t("sk.reallyUsed"))}</h2>${barList(used.slice(0, 12), "name", "uses", (n) => n + "×")}` : ""}
    <h2>${esc(t("sk.inventory"))}</h2>${table([
      { h: t("col.name"), f: (r) => esc(r.name) }, { h: t("col.scope"), f: (r) => `<span class="muted">${esc(r.scope)}</span>` },
      { h: t("col.description"), trunc: 1, f: (r) => esc(r.description) },
      { h: t("col.location"), trunc: 1, f: (r) => `<code>${esc(r.location)}</code>` },
      { h: t("col.uses"), num: 1, f: (r) => r.uses || "" },
      { h: t("col.modified"), f: (r) => dt(r.modified) },
    ], s, { limit: state.showAll ? 0 : 40 })}`;
  },

  async graph() {
    const g = await api("/api/graph");
    if (!g.nodes.length) return `<p class="note">${esc(t("gr.empty"))}</p>`;
    const W = 900, H = 560, cx = W / 2, cy = H / 2;
    const projects = g.nodes.filter((n) => n.kind === "project");
    const others = g.nodes.filter((n) => n.kind !== "project");
    const pos = {};
    projects.forEach((n, i) => { const a = (i / projects.length) * Math.PI * 2 - Math.PI / 2; pos[n.id] = [cx + Math.cos(a) * 105, cy + Math.sin(a) * 105]; });
    others.forEach((n, i) => { const a = (i / others.length) * Math.PI * 2 - Math.PI / 2; pos[n.id] = [cx + Math.cos(a) * 225, cy + Math.sin(a) * 225]; });
    const color = { project: "var(--accent)", tool: "var(--ink)", skill: "var(--ok)", subagent: "var(--warn)" };
    const maxW = Math.max(...g.links.map((l) => l.weight), 1);
    return `<p class="note">${esc(t("gr.note"))}</p>
    <svg viewBox="0 0 ${W} ${H}" width="100%" style="min-height:560px;display:block">
      ${g.links.map((l) => pos[l.source] && pos[l.target]
        ? `<line x1="${pos[l.source][0]}" y1="${pos[l.source][1]}" x2="${pos[l.target][0]}" y2="${pos[l.target][1]}"
             stroke="var(--accent)" stroke-opacity="${(0.12 + l.weight / maxW * 0.5).toFixed(2)}"
             stroke-width="${(0.5 + l.weight / maxW * 2).toFixed(2)}"/>` : "").join("")}
      ${g.nodes.map((n) => { const [x, y] = pos[n.id]; const r = n.kind === "project" ? 5 : 2.5;
        return `<circle cx="${x}" cy="${y}" r="${r}" fill="${color[n.kind]}"/>` +
               `<text x="${x + r + 5}" y="${y + 3.5}">${esc(shortProject(n.label))}</text>`; }).join("")}
    </svg>`;
  },

  async advice() {
    const r = await api("/api/recommendations");
    if (!r.length) return `<p class="note">${esc(t("adv.empty"))}</p>`;
    return `
    ${anchor(t("adv.anchor"), String(r.length), esc(t("adv.caption")))}
    ` + r.map((x) => `<div class="rec ${esc(x.severity)}">
      <span class="sev">${esc(t("sev." + x.severity))}</span>
      <b>${esc(t("rec." + x.id + ".title", x.params))}</b>${esc(t("rec." + x.id + ".detail", x.params))}
      <details><summary>${esc(t("adv.evidence"))}</summary><pre>${esc(JSON.stringify(x.evidence, null, 2))}</pre></details></div>`).join("");
  },
};

/* --- la URL es el estado: se puede compartir, recargar y usar atras/adelante --- */
function pushUrl() {
  const p = new URLSearchParams();
  if (state.view !== "overview") p.set("view", state.view);
  if (state.sessionId) p.set("session", state.sessionId);
  if (state.filters.from) p.set("from", state.filters.from.slice(0, 10));
  if (state.filters.to) p.set("to", state.filters.to.slice(0, 10));
  if (state.filters.provider) p.set("provider", state.filters.provider);
  if (state.filters.project) p.set("project", state.filters.project);
  if (state.sort !== "date") p.set("sort", state.sort);
  if (state.q) p.set("q", state.q);
  p.set("lang", lang());

  const next = location.pathname + (p.toString() ? "?" + p : "");
  if (next !== location.pathname + location.search) history.pushState(null, "", next);
}

function readUrl() {
  const p = new URLSearchParams(location.search);
  state.sessionId = p.get("session") || null;
  // una URL de sesion abierta en frio no trae pestaña de origen: la de vuelta es Sesiones
  const view = p.get("view") ?? (state.sessionId ? "sessions" : "overview");
  state.view = views[view] && view !== "session" ? view : "overview";
  // una fecha inventada en la URL daria $0.00 con el campo vacio y sin explicacion: se ignora
  const day = (k) => {
    const v = p.get(k) ?? "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
    const d = new Date(v + "T00:00:00.000Z");   // 2026-99-99 casa el patron pero no existe
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v ? v : null;
  };
  state.filters = {
    from: day("from") ? day("from") + "T00:00:00.000Z" : "",
    to: day("to") ? day("to") + "T23:59:59.999Z" : "",
    provider: p.get("provider") ?? "",
    project: p.get("project") ?? "",
  };
  const sort = p.get("sort") ?? "date";
  state.sort = ["date", "cost", "tokens", "tools"].includes(sort) ? sort : "date";
  state.q = p.get("q") ?? "";
  state.showAll = false;
  paintChrome();
}

/** Todo lo que vive fuera de <main> y tambien cambia de idioma. */
function paintChrome() {
  $("#tagline").textContent = t("brand.tagline");
  $("#lang").textContent = t("btn.lang");
  $("#lang").title = t("btn.lang.title");
  $("#export").textContent = t("btn.export");
  $("#export").title = t("btn.export.title");
  $("#pdf").textContent = t("btn.pdf");
  $("#pdf").title = t("btn.pdf.title");
  $("#reindex").textContent = t("btn.reindex");
  document.querySelectorAll("#tabs button").forEach((b) => {
    b.textContent = t("nav." + b.dataset.view);
    b.classList.toggle("on", b.dataset.view === state.view);
  });
  applyTheme(document.documentElement.dataset.theme ?? "", true);
}

/* --- router --- */
let renderToken = 0;
async function render() {
  const mine = ++renderToken;
  pushUrl();
  app.setAttribute("aria-busy", "true");
  let html;
  try {
    html = state.sessionId ? await views.session(state.sessionId) : await views[state.view]();
  } catch (e) {
    html = `<p class="redacted">${esc(t("error", { msg: e.message }))}</p>`;
  }
  if (mine !== renderToken) return;   // otro render arranco despues: este ya no manda
  app.innerHTML = html;
  app.removeAttribute("aria-busy");
  window.scrollTo(0, 0);
  wire();
}

function applyFilter(patch) {
  Object.assign(state.filters, patch);
  state.showAll = false;
  render();
}

function wire() {
  app.querySelectorAll("[data-session]").forEach((el) =>
    el.addEventListener("click", () => { state.sessionId = el.dataset.session; render(); }));
  const back = $("#back");
  if (back) back.addEventListener("click", () => { state.sessionId = null; state.view = "sessions"; render(); });
  const q = $("#q");
  if (q) q.addEventListener("change", () => { state.q = q.value; state.showAll = false; render(); });
  const sort = $("#sort");
  if (sort) sort.addEventListener("change", () => { state.sort = sort.value; state.showAll = false; render(); });
  app.querySelectorAll("[data-showall]").forEach((el) =>
    el.addEventListener("click", () => { state.showAll = true; render(); }));

  app.querySelectorAll("[data-preset]").forEach((el) =>
    el.addEventListener("click", () => applyFilter(PRESETS.find((p) => p.id === el.dataset.preset).range())));

  // la fecha "hasta" cubre el dia entero: si no, se pierde todo lo de ese dia
  const finDia = (id, iso) => (!iso ? "" : id === "f-to" ? iso + "T23:59:59.999Z" : iso + "T00:00:00.000Z");
  for (const id of ["f-from", "f-to"]) {
    const campo = $("#" + id), picker = $("#" + id + "-pick");
    if (!campo) continue;
    const aplicar = () => {
      const iso = dmyToIso(campo.value);
      if (iso === null) {                    // texto que no es una fecha: se avisa, no se filtra
        campo.classList.add("bad");
        campo.title = t("date.invalid");
        return;
      }
      campo.classList.remove("bad");
      campo.removeAttribute("title");
      applyFilter({ [id === "f-to" ? "to" : "from"]: finDia(id, iso) });
    };
    campo.addEventListener("change", aplicar);
    campo.addEventListener("input", () => campo.classList.remove("bad"));
    // el boton abre el calendario del sistema; al elegir, se escribe en dd/mm/aaaa
    picker?.addEventListener("change", () => {
      campo.value = isoToDmy(picker.value);
      aplicar();
    });
  }
  app.querySelectorAll("[data-pick]").forEach((b) =>
    b.addEventListener("click", () => {
      const p = $("#" + b.dataset.pick + "-pick");
      if (p?.showPicker) p.showPicker(); else p?.focus();
    }));

  const prov = $("#f-provider"), proj = $("#f-project"), clear = $("#f-clear");
  if (prov) prov.addEventListener("change", () => applyFilter({ provider: prov.value }));
  if (proj) proj.addEventListener("change", () => applyFilter({ project: proj.value }));
  if (clear) clear.addEventListener("click", () => applyFilter({ from: "", to: "", provider: "", project: "" }));
}

$("#tabs").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-view]");
  if (!b) return;
  document.querySelectorAll("#tabs button").forEach((x) => x.classList.toggle("on", x === b));
  state.view = b.dataset.view; state.sessionId = null; state.showAll = false;
  render();
});

/* --- idioma --- */
$("#lang").addEventListener("click", () => {
  setLang(nextLang());
  facetsPromise = null;
  paintChrome();
  refreshFooter();
  render();
});

/* --- tema: sistema -> claro -> oscuro. Sin atributo = manda el sistema. --- */
const THEMES = ["", "light", "dark"];
function applyTheme(id, soloTexto) {
  if (!soloTexto) {
    if (id) document.documentElement.dataset.theme = id;
    else delete document.documentElement.dataset.theme;
    try { id ? localStorage.setItem("theme", id) : localStorage.removeItem("theme"); } catch { /* modo privado */ }
  }
  $("#theme").textContent = t("btn.theme." + (id || "system"));
}
try { applyTheme(localStorage.getItem("theme") ?? ""); } catch { applyTheme(""); }

$("#theme").addEventListener("click", () => {
  const now = document.documentElement.dataset.theme ?? "";
  applyTheme(THEMES[(THEMES.indexOf(now) + 1) % THEMES.length]);
});

/* --- PDF: lo genera el navegador al imprimir. Sin librerias, sin Chrome headless. --- */
function printHeader() {
  const f = state.filters;
  const rango = f.from || f.to
    ? `${f.from ? f.from.slice(0, 10) : t("print.start")} → ${f.to ? f.to.slice(0, 10) : t("print.today")}`
    : t("print.allHistory");
  const filas = [
    [t("print.view"), state.sessionId ? t("print.sessionDetail") : t("nav." + state.view)],
    [t("print.range"), rango],
    f.provider ? [t("print.provider"), f.provider] : null,
    f.project ? [t("print.project"), f.project] : null,
    state.sessionId ? [t("print.session"), state.sessionId] : null,
    [t("print.generated"), new Date().toLocaleString(loc())],
  ].filter(Boolean);

  const el = document.createElement("div");
  el.className = "print-only print-head";
  el.innerHTML = `<h1>Motor Agéntico</h1><dl>` +
    filas.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("") + `</dl>`;
  return el;
}

// Colgado de beforeprint, no del boton: asi tambien lo lleva un Ctrl+P normal
// o una impresion sin cabecera desde la linea de comandos.
window.addEventListener("beforeprint", () => {
  if (!app.querySelector(".print-head")) app.prepend(printHeader());
});
window.addEventListener("afterprint", () => app.querySelector(".print-head")?.remove());

$("#pdf").addEventListener("click", () => window.print());

$("#export").addEventListener("click", async () => {
  const btn = $("#export"); btn.disabled = true; btn.textContent = t("btn.exporting");
  try {
    // se exporta lo mismo que se esta viendo
    const r = await fetch("/api/export" + qs({ lang: lang() }), { method: "POST" }).then((x) => x.json());
    $("#foot").textContent = r.error
      ? t("foot.exportError", { msg: r.error })
      : t("foot.exported", {
          filtered: filtered() ? t("foot.exportFiltered") : "",
          dir: r.files[0].dir,
          files: r.files.map((f) => `${f.name} (${bytes(f.bytes)})`).join(" · "),
        });
  } finally { btn.disabled = false; btn.textContent = t("btn.export"); }
});

$("#reindex").addEventListener("click", async () => {
  const btn = $("#reindex"); btn.disabled = true; btn.textContent = t("btn.reindexing");
  const r = await fetch("/api/reindex", { method: "POST" }).then((x) => x.json());
  btn.disabled = false; btn.textContent = t("btn.reindex");
  facetsPromise = null;   // pueden haber aparecido proyectos o proveedores nuevos
  $("#foot").textContent = t("foot.reindexed", {
    s: (r.ms / 1000).toFixed(1),
    detail: r.providers.map((p) => `${p.provider}: ${p.skipped ? p.reason : p.files + " / " + p.messages}`).join(" · "),
  });
  render();
});

// atras/adelante del navegador: se relee la URL, no se vuelve a empujar
window.addEventListener("popstate", () => { readUrl(); render(); });

let health = null, activity = null;
function refreshFooter() {
  if (!health) return;
  const n = activity?.live.processes.length ?? 0;
  $("#live").className = "pill" + (n ? " live" : "");
  $("#live").textContent = n ? tn("live.processes", n) : t("live.none");
  $("#foot").textContent = t("foot.indexed", {
    n: n0(health.indexedFiles.n), size: bytes(health.indexedFiles.bytes),
    at: dt(health.lastIndexed.at), root: health.engineRoot,
  });
}

(async () => {
  readUrl();
  render();
  [health, activity] = await Promise.all([api("/api/health"), api("/api/activity")]);
  refreshFooter();
})();
