"use strict";
/**
 * Diccionario unico del front. El backend NO manda prosa: manda claves y numeros
 * (notas de proveedor, recomendaciones), y aqui se convierten en texto.
 * Interpolacion con {{param}}.
 */
const DICT = {
  es: {
    "brand.tagline": "local · solo lectura",
    "live.processes": "{{n}} proceso de Claude Code",
    "live.processes_plural": "{{n}} procesos de Claude Code",
    "live.none": "sin procesos vivos",
    "btn.theme.system": "Tema: sistema",
    "btn.theme.light": "Tema: claro",
    "btn.theme.dark": "Tema: oscuro",
    "btn.export": "Exportar",
    "btn.exporting": "Exportando…",
    "btn.pdf": "PDF",
    "btn.pdf.title": "Imprime la vista actual con su filtro; elige «Guardar como PDF»",
    "btn.reindex": "Reindexar",
    "btn.reindexing": "Indexando…",
    "btn.lang": "Idioma: español",
    "btn.lang.title": "Cambiar idioma / Switch language",
    "btn.export.title": "Escribe JSON + CSV en data/exports/",

    "nav.overview": "Overview", "nav.costs": "Costes", "nav.sessions": "Sesiones",
    "nav.activity": "Actividad", "nav.cursor": "Cursor", "nav.memory": "Memoria",
    "nav.skills": "Skills", "nav.graph": "Grafo", "nav.advice": "Mejoras",

    "filter.from": "Desde", "filter.to": "Hasta",
    "filter.allProviders": "todos los proveedores", "filter.allProjects": "todos los proyectos",
    "filter.clear": "Limpiar",
    "date.placeholder": "dd/mm/aaaa",
    "date.pick": "Abrir calendario",
    "date.invalid": "Fecha no válida. Formato: dd/mm/aaaa",
    "preset.all": "Todo", "preset.today": "Hoy", "preset.7d": "7 días",
    "preset.30d": "30 días", "preset.month": "Este mes",

    "table.noData": "Sin datos.", "table.noDataFiltered": "Sin datos para este filtro.",
    "table.showing": "Mostrando {{shown}} de {{total}}.", "table.seeAll": "Ver todas",
    "chart.needPoints": "Faltan puntos para dibujar la serie.",
    "loading": "Cargando…", "error": "Error: {{msg}}",

    "ov.anchor": "Consumo acumulado, estimado a tarifa API",
    "ov.anchorFiltered": "Consumo en el rango filtrado, estimado a tarifa API",
    "ov.caption": "{{sessions}} sesiones · {{messages}} mensajes · {{tokens}} tokens. Si la sesión corrió bajo suscripción, el coste marginal real fue distinto: esto mide consumo, no factura.",
    "ov.today": "Hoy", "ov.week": "7 días", "ov.month": "30 días",
    "ov.avgSession": "Media / sesión", "ov.models": "Modelos", "ov.projects": "Proyectos",
    "ov.sessionsCount": "{{n}} sesiones",
    "ov.unpriced": "{{n}} mensajes de modelos sin tarifa conocida: su coste cuenta como 0.",
    "ov.costByModel": "Coste por modelo", "ov.costByProject": "Coste por proyecto",
    "ov.byTool": "Por herramienta", "ov.whereTokens": "Dónde se van los tokens",
    "ov.providers": "Proveedores",
    "ov.cursorNote": "Cursor no aparece aquí: no registra tokens por petición. Su pestaña lo mide con lo que sí guarda.",
    "ov.ratesNote": "Tarifas: {{sources}}",
    "ov.rateVerified": "{{vendor}} verificadas el {{date}}",
    "ov.rateUnverified": "{{vendor}} SIN VERIFICAR",
    "ov.unpricedModels": " · modelos sin tarifa: {{list}}",
    "ov.estimate": "Los costes son estimaciones a tarifa API. Si la sesión corrió bajo suscripción, el coste marginal real fue distinto.",

    "col.provider": "Proveedor", "col.sessions": "Sesiones", "col.tokens": "Tokens",
    "col.cost": "Coste", "col.noRate": "sin tarifa", "col.tool": "Herramienta",
    "col.status": "Estado", "col.path": "Ruta", "col.note": "Nota",
    "col.date": "Fecha", "col.project": "Proyecto", "col.title": "Título",
    "col.model": "Modelo", "col.duration": "Duración", "col.tools": "Tools",
    "col.messages": "Mensajes", "col.rate": "Tarifa", "col.week": "Semana", "col.month": "Mes",
    "col.session": "Sesión", "col.lastEvent": "Último evento", "col.server": "Servidor",
    "col.name": "Nombre", "col.type": "Tipo", "col.description": "Descripción",
    "col.links": "Enlaces", "col.size": "Tamaño", "col.modified": "Modificado",
    "col.scope": "Ámbito", "col.location": "Ubicación", "col.uses": "Usos",
    "col.branch": "Rama", "col.commits": "Commits", "col.linesAdded": "Líneas +",
    "col.fromAI": "De la IA", "col.human": "Humano", "col.pctAI": "% IA",
    "col.updated": "Actualizada", "col.mode": "Modo", "col.linesPM": "Líneas +/−",
    "col.context": "Contexto", "col.message": "Mensaje",
    "status.detected": "detectado", "status.notDetected": "no detectado",
    "rate.verified": "verificada", "rate.unverified": "SIN VERIFICAR",

    "cost.peak": "Día más caro del rango",
    "cost.peakCaption": "{{day}} · {{tokens}} tokens en {{sessions}} sesiones. Serie completa abajo.",
    "cost.daily": "Coste diario", "cost.daily90": "Coste diario (últimos 90 días)",
    "cost.tokensDaily": "Tokens por día", "cost.weekly": "Por semana", "cost.monthly": "Por mes",
    "cost.byModel": "Por modelo", "cost.byProject": "Por proyecto",

    "ses.search": "Buscar por título o id", "ses.sortBy": "Ordenar por",
    "sort.date": "fecha", "sort.cost": "coste", "sort.tokens": "tokens", "sort.tools": "tool calls",
    "ses.count": "{{n}} sesiones",
    "ses.mostExpensive": "Sesión más cara", "ses.mostRecent": "Sesión más reciente",
    "ses.anchorCaption": "{{title}} · {{project}} · {{tokens}} tokens · {{tools}} tool calls",
    "ses.back": "← Volver a sesiones", "ses.notFound": "Sesión no encontrada.",
    "ses.subagentMsgs": "{{n}} de subagentes",
    "ses.cacheWR": "Cache w / r", "ses.toolCalls": "Tool calls",
    "ses.tools": "Herramientas", "ses.models": "Modelos", "ses.skills": "Skills",
    "ses.subagents": "Subagentes", "ses.hourly": "Coste hora a hora",
    "ses.none.f": "Ninguna.", "ses.none.m": "Ninguno.",

    "act.anchor": "Procesos de Claude Code vivos",
    "act.noneRunning": "Ninguno corriendo en este momento.",
    "act.pidNote": "Ningún campo del transcript une un PID con su sesión, así que el Motor no lo adivina. Lo comprobable es qué sesiones escribieron en los últimos 10 minutos:",
    "act.noneRecent": "Ninguna sesión escribió en los últimos 10 minutos.",
    "act.recent": "Sesiones recientes", "act.topTools": "Herramientas más usadas",
    "act.byHour": "Actividad por hora — pico a las {{hour}}:00",
    "act.hourTitle": "{{hour}}:00 — {{n}} mensajes",
    "act.byWeekday": "Por día de la semana",
    "act.skills": "Skills invocadas", "act.subagents": "Subagentes", "act.mcp": "MCP",
    "act.noSkills": "Ninguna registrada.", "act.noSubagents": "Ninguno registrado.",
    "act.noMcp": "Sin atribución MCP.",
    "weekday.0": "dom", "weekday.1": "lun", "weekday.2": "mar", "weekday.3": "mié",
    "weekday.4": "jue", "weekday.5": "vie", "weekday.6": "sáb",

    "cur.notIndexed": "Cursor detectado pero sin sesiones indexadas todavía. Pulsa Reindexar.",
    "cur.anchor": "Del código commiteado, lo escribió la IA",
    "cur.caption": "{{ai}} de {{total}} líneas añadidas en {{commits}} commits puntuados por Cursor, entre {{from}} y {{to}}. Cursor no registra tokens por petición ni coste: aquí no hay dinero que mostrar.",
    "cur.subagents": "{{n}} de subagente", "cur.peakContext": "Pico de contexto",
    "cur.peakNote": "en una sola sesión", "cur.byModel": "Sesiones por modelo",
    "cur.tools": "Herramientas", "cur.byBranch": "Autoría por rama",
    "cur.sessions": "Sesiones", "cur.commits": "Commits puntuados",
    "cur.noTitle": "(sin título)", "cur.subagent": "subagente",
    "cur.copyNote": "Cursor guarda estas bases en modo WAL y las escribe mientras está abierto. El Motor las copia a data/cursor-cache/ y lee la copia: nunca abre las originales.",

    "mem.anchor": "Archivos de memoria persistente",
    "mem.caption": "{{bytes}} · {{links}} enlaces entre memorias · {{redacted}} con secretos redactados. Estrictamente de lectura: todo pasa por redacción antes de mostrarse.",
    "mem.byType": "Por tipo", "mem.mostLinked": "Más enlazadas",
    "mem.linksCount": "{{n}} enlaces", "mem.all": "Todas las memorias", "mem.view": "ver",

    "sk.anchor": "Skills instaladas",
    "sk.caption": "{{used}} con uso registrado{{inFilter}}, {{unused}} nunca invocadas vía la herramienta Skill. El inventario es del disco y no se filtra; los usos sí.",
    "sk.inFilter": " en el filtro",
    "sk.reallyUsed": "Las que realmente usas", "sk.inventory": "Inventario completo",

    "gr.note": "Proyectos en el centro; alrededor las herramientas, skills y subagentes que usan. Grosor de la línea = frecuencia.",
    "gr.empty": "Aún no hay relaciones suficientes.",

    "adv.anchor": "Recomendaciones abiertas",
    "adv.caption": "Propuestas, no cambios. Se guardan en data/recommendations.json; el Motor nunca modifica Claude Code.",
    "adv.empty": "Sin recomendaciones. Indexa más sesiones.",
    "adv.evidence": "evidencia",
    "sev.high": "Prioritario", "sev.warn": "Revisar", "sev.info": "Observación",

    "rec.expensive-sessions.title": "{{n}} sesiones cuestan más de 5x el promedio",
    "rec.expensive-sessions.detail": "Promedio por sesión: ${{avg}}. Revisa si el contexto crece sin compactar o si un subagente está reprocesando lo mismo.",
    "rec.cache-churn.title": "Ratio de reuso de caché bajo",
    "rec.cache-churn.detail": "Escribes {{written}}M tokens de caché y solo lees {{read}}M. Una escritura de 5 min recupera su coste tras UNA lectura; por debajo de 1,25 lecturas por escritura estás pagando de más.",
    "rec.huge-context.title": "{{n}} sesiones superan 400k tokens de contexto en un solo turno",
    "rec.huge-context.detail": "Contextos así encarecen cada turno posterior. Candidatas a partir en sesiones más cortas o a resumir antes de continuar.",
    "rec.unused-tools.title": "{{n}} herramientas usadas 2 veces o menos",
    "rec.unused-tools.detail": "Cada definición de herramienta ocupa tokens de sistema en TODOS los turnos. Desconectar MCPs que no usas baja el coste base.",
    "rec.no-skills-used.title": "No hay invocaciones de skills registradas",
    "rec.no-skills-used.detail": "Tienes skills instaladas pero ninguna aparece invocada vía la herramienta Skill en los transcripts indexados.",
    "rec.repeated-prompts.title": "{{n}} instrucciones repetidas en 3+ sesiones",
    "rec.repeated-prompts.detail": "Un prompt que repites es una skill que todavía no escribiste.",
    "rec.automation-candidates.title": "Proyectos con mucha ejecución de comandos por sesión",
    "rec.automation-candidates.detail": "Volumen alto de Bash/PowerShell por sesión suele indicar un flujo repetitivo que un script o skill puede cubrir.",
    "rec.unverified-pricing.title": "{{n}} modelos sin tarifa en config/pricing.json",
    "rec.unverified-pricing.detail": "Su coste se cuenta como 0. Añade las tarifas o quedarán subestimadas. Fuentes verificadas: {{sources}}.",

    "prov.claude.transcripts": "{{n}} transcripts",
    "prov.codex.absent": "no instalado: no existe ~/.codex ni ~/.config/codex",
    "prov.codex.rollouts": "{{n}} rollouts",
    "prov.codex.empty": "instalado, sin sesiones registradas",
    "prov.cursor.sources": "sesiones + tool calls · autoría IA por commit · sin tokens ni coste",
    "prov.cursor.empty": "instalado, sin datos",
    "prov.opencode.absent": "no instalado",
    "prov.opencode.sessions": "{{n}} sesiones · trae su propio coste calculado",
    "prov.opencode.empty": "instalado, sin sesiones: el almacén está vacío",

    "foot.indexed": "{{n}} archivos indexados ({{size}}) · última indexación {{at}} · {{root}}",
    "foot.exported": "Exportado{{filtered}} a {{dir}} · {{files}}",
    "foot.exportFiltered": " (con el filtro activo)",
    "foot.exportError": "Error al exportar: {{msg}}",
    "foot.reindexed": "Reindexado en {{s}}s · {{detail}}",
    "print.view": "Vista", "print.range": "Rango", "print.provider": "Proveedor",
    "print.project": "Proyecto", "print.session": "Sesión", "print.generated": "Generado",
    "print.allHistory": "todo el histórico", "print.start": "inicio", "print.today": "hoy",
    "print.sessionDetail": "Detalle de sesión",
  },

  en: {
    "brand.tagline": "local · read-only",
    "live.processes": "{{n}} Claude Code process",
    "live.processes_plural": "{{n}} Claude Code processes",
    "live.none": "no live processes",
    "btn.theme.system": "Theme: system",
    "btn.theme.light": "Theme: light",
    "btn.theme.dark": "Theme: dark",
    "btn.export": "Export",
    "btn.exporting": "Exporting…",
    "btn.pdf": "PDF",
    "btn.pdf.title": "Prints the current view with its filter; choose “Save as PDF”",
    "btn.reindex": "Reindex",
    "btn.reindexing": "Indexing…",
    "btn.lang": "Language: English",
    "btn.lang.title": "Cambiar idioma / Switch language",
    "btn.export.title": "Writes JSON + CSV to data/exports/",

    "nav.overview": "Overview", "nav.costs": "Costs", "nav.sessions": "Sessions",
    "nav.activity": "Activity", "nav.cursor": "Cursor", "nav.memory": "Memory",
    "nav.skills": "Skills", "nav.graph": "Graph", "nav.advice": "Advice",

    "filter.from": "From", "filter.to": "To",
    "filter.allProviders": "all providers", "filter.allProjects": "all projects",
    "filter.clear": "Clear",
    "date.placeholder": "dd/mm/yyyy",
    "date.pick": "Open calendar",
    "date.invalid": "Not a valid date. Format: dd/mm/yyyy",
    "preset.all": "All", "preset.today": "Today", "preset.7d": "7 days",
    "preset.30d": "30 days", "preset.month": "This month",

    "table.noData": "No data.", "table.noDataFiltered": "No data for this filter.",
    "table.showing": "Showing {{shown}} of {{total}}.", "table.seeAll": "Show all",
    "chart.needPoints": "Not enough points to draw the series.",
    "loading": "Loading…", "error": "Error: {{msg}}",

    "ov.anchor": "Total consumption, estimated at API rates",
    "ov.anchorFiltered": "Consumption in the filtered range, estimated at API rates",
    "ov.caption": "{{sessions}} sessions · {{messages}} messages · {{tokens}} tokens. If the session ran on a subscription, the real marginal cost was different: this measures consumption, not your bill.",
    "ov.today": "Today", "ov.week": "7 days", "ov.month": "30 days",
    "ov.avgSession": "Average / session", "ov.models": "Models", "ov.projects": "Projects",
    "ov.sessionsCount": "{{n}} sessions",
    "ov.unpriced": "{{n}} messages from models with no known rate: their cost counts as 0.",
    "ov.costByModel": "Cost by model", "ov.costByProject": "Cost by project",
    "ov.byTool": "By tool", "ov.whereTokens": "Where the tokens go",
    "ov.providers": "Providers",
    "ov.cursorNote": "Cursor is not listed here: it records no per-request tokens. Its own tab measures what it does store.",
    "ov.ratesNote": "Rates: {{sources}}",
    "ov.rateVerified": "{{vendor}} verified on {{date}}",
    "ov.rateUnverified": "{{vendor}} UNVERIFIED",
    "ov.unpricedModels": " · models with no rate: {{list}}",
    "ov.estimate": "Costs are estimates at API rates. If the session ran on a subscription, the real marginal cost was different.",

    "col.provider": "Provider", "col.sessions": "Sessions", "col.tokens": "Tokens",
    "col.cost": "Cost", "col.noRate": "no rate", "col.tool": "Tool",
    "col.status": "Status", "col.path": "Path", "col.note": "Note",
    "col.date": "Date", "col.project": "Project", "col.title": "Title",
    "col.model": "Model", "col.duration": "Duration", "col.tools": "Tools",
    "col.messages": "Messages", "col.rate": "Rate", "col.week": "Week", "col.month": "Month",
    "col.session": "Session", "col.lastEvent": "Last event", "col.server": "Server",
    "col.name": "Name", "col.type": "Type", "col.description": "Description",
    "col.links": "Links", "col.size": "Size", "col.modified": "Modified",
    "col.scope": "Scope", "col.location": "Location", "col.uses": "Uses",
    "col.branch": "Branch", "col.commits": "Commits", "col.linesAdded": "Lines +",
    "col.fromAI": "By AI", "col.human": "Human", "col.pctAI": "% AI",
    "col.updated": "Updated", "col.mode": "Mode", "col.linesPM": "Lines +/−",
    "col.context": "Context", "col.message": "Message",
    "status.detected": "detected", "status.notDetected": "not detected",
    "rate.verified": "verified", "rate.unverified": "UNVERIFIED",

    "cost.peak": "Priciest day in range",
    "cost.peakCaption": "{{day}} · {{tokens}} tokens across {{sessions}} sessions. Full series below.",
    "cost.daily": "Daily cost", "cost.daily90": "Daily cost (last 90 days)",
    "cost.tokensDaily": "Tokens per day", "cost.weekly": "By week", "cost.monthly": "By month",
    "cost.byModel": "By model", "cost.byProject": "By project",

    "ses.search": "Search by title or id", "ses.sortBy": "Sort by",
    "sort.date": "date", "sort.cost": "cost", "sort.tokens": "tokens", "sort.tools": "tool calls",
    "ses.count": "{{n}} sessions",
    "ses.mostExpensive": "Priciest session", "ses.mostRecent": "Most recent session",
    "ses.anchorCaption": "{{title}} · {{project}} · {{tokens}} tokens · {{tools}} tool calls",
    "ses.back": "← Back to sessions", "ses.notFound": "Session not found.",
    "ses.subagentMsgs": "{{n}} from subagents",
    "ses.cacheWR": "Cache w / r", "ses.toolCalls": "Tool calls",
    "ses.tools": "Tools", "ses.models": "Models", "ses.skills": "Skills",
    "ses.subagents": "Subagents", "ses.hourly": "Cost hour by hour",
    "ses.none.f": "None.", "ses.none.m": "None.",

    "act.anchor": "Live Claude Code processes",
    "act.noneRunning": "None running right now.",
    "act.pidNote": "No transcript field ties a PID to its session, so the Engine does not guess. What is verifiable is which sessions wrote in the last 10 minutes:",
    "act.noneRecent": "No session wrote in the last 10 minutes.",
    "act.recent": "Recent sessions", "act.topTools": "Most used tools",
    "act.byHour": "Activity by hour — peak at {{hour}}:00",
    "act.hourTitle": "{{hour}}:00 — {{n}} messages",
    "act.byWeekday": "By day of week",
    "act.skills": "Skills invoked", "act.subagents": "Subagents", "act.mcp": "MCP",
    "act.noSkills": "None recorded.", "act.noSubagents": "None recorded.",
    "act.noMcp": "No MCP attribution.",
    "weekday.0": "Sun", "weekday.1": "Mon", "weekday.2": "Tue", "weekday.3": "Wed",
    "weekday.4": "Thu", "weekday.5": "Fri", "weekday.6": "Sat",

    "cur.notIndexed": "Cursor detected but no sessions indexed yet. Hit Reindex.",
    "cur.anchor": "Of the committed code, written by AI",
    "cur.caption": "{{ai}} of {{total}} lines added across {{commits}} commits scored by Cursor, between {{from}} and {{to}}. Cursor records no per-request tokens or cost: there is no money to show here.",
    "cur.subagents": "{{n}} from subagents", "cur.peakContext": "Peak context",
    "cur.peakNote": "in a single session", "cur.byModel": "Sessions by model",
    "cur.tools": "Tools", "cur.byBranch": "Authorship by branch",
    "cur.sessions": "Sessions", "cur.commits": "Scored commits",
    "cur.noTitle": "(untitled)", "cur.subagent": "subagent",
    "cur.copyNote": "Cursor keeps these databases in WAL mode and writes to them while it is open. The Engine copies them to data/cursor-cache/ and reads the copy: it never opens the originals.",

    "mem.anchor": "Persistent memory files",
    "mem.caption": "{{bytes}} · {{links}} links between memories · {{redacted}} with secrets redacted. Strictly read-only: everything goes through redaction before being shown.",
    "mem.byType": "By type", "mem.mostLinked": "Most linked",
    "mem.linksCount": "{{n}} links", "mem.all": "All memories", "mem.view": "view",

    "sk.anchor": "Installed skills",
    "sk.caption": "{{used}} with recorded use{{inFilter}}, {{unused}} never invoked through the Skill tool. The inventory comes from disk and is not filtered; the uses are.",
    "sk.inFilter": " in the filter",
    "sk.reallyUsed": "The ones you actually use", "sk.inventory": "Full inventory",

    "gr.note": "Projects in the centre; around them the tools, skills and subagents they use. Line thickness = frequency.",
    "gr.empty": "Not enough relationships yet.",

    "adv.anchor": "Open recommendations",
    "adv.caption": "Proposals, not changes. They are saved to data/recommendations.json; the Engine never modifies Claude Code.",
    "adv.empty": "No recommendations. Index more sessions.",
    "adv.evidence": "evidence",
    "sev.high": "Priority", "sev.warn": "Review", "sev.info": "Observation",

    "rec.expensive-sessions.title": "{{n}} sessions cost more than 5x the average",
    "rec.expensive-sessions.detail": "Average per session: ${{avg}}. Check whether context grows without compacting, or whether a subagent is reprocessing the same thing.",
    "rec.cache-churn.title": "Low cache reuse ratio",
    "rec.cache-churn.detail": "You write {{written}}M cache tokens and only read {{read}}M. A 5-minute write pays for itself after ONE read; below 1.25 reads per write you are overpaying.",
    "rec.huge-context.title": "{{n}} sessions exceed 400k context tokens in a single turn",
    "rec.huge-context.detail": "Contexts that large make every later turn pricier. Candidates for splitting into shorter sessions or summarising before continuing.",
    "rec.unused-tools.title": "{{n}} tools used twice or less",
    "rec.unused-tools.detail": "Every tool definition costs system tokens on EVERY turn. Disconnecting MCPs you do not use lowers the base cost.",
    "rec.no-skills-used.title": "No skill invocations recorded",
    "rec.no-skills-used.detail": "You have skills installed but none appears invoked through the Skill tool in the indexed transcripts.",
    "rec.repeated-prompts.title": "{{n}} instructions repeated across 3+ sessions",
    "rec.repeated-prompts.detail": "A prompt you repeat is a skill you have not written yet.",
    "rec.automation-candidates.title": "Projects with heavy command execution per session",
    "rec.automation-candidates.detail": "A high volume of Bash/PowerShell per session usually means a repetitive flow a script or skill could cover.",
    "rec.unverified-pricing.title": "{{n}} models with no rate in config/pricing.json",
    "rec.unverified-pricing.detail": "Their cost counts as 0. Add the rates or they will stay underestimated. Verified sources: {{sources}}.",

    "prov.claude.transcripts": "{{n}} transcripts",
    "prov.codex.absent": "not installed: neither ~/.codex nor ~/.config/codex exists",
    "prov.codex.rollouts": "{{n}} rollouts",
    "prov.codex.empty": "installed, no sessions recorded",
    "prov.cursor.sources": "sessions + tool calls · AI authorship per commit · no tokens or cost",
    "prov.cursor.empty": "installed, no data",
    "prov.opencode.absent": "not installed",
    "prov.opencode.sessions": "{{n}} sessions · brings its own computed cost",
    "prov.opencode.empty": "installed, no sessions: the store is empty",

    "foot.indexed": "{{n}} files indexed ({{size}}) · last indexed {{at}} · {{root}}",
    "foot.exported": "Exported{{filtered}} to {{dir}} · {{files}}",
    "foot.exportFiltered": " (with the active filter)",
    "foot.exportError": "Export failed: {{msg}}",
    "foot.reindexed": "Reindexed in {{s}}s · {{detail}}",
    "print.view": "View", "print.range": "Range", "print.provider": "Provider",
    "print.project": "Project", "print.session": "Session", "print.generated": "Generated",
    "print.allHistory": "all history", "print.start": "start", "print.today": "today",
    "print.sessionDetail": "Session detail",
  },
};

const LANGS = ["es", "en"];

/**
 * Idioma del navegador. Se recorre `navigator.languages` EN ORDEN, no solo la primera:
 * un navegador con ["fr-FR","es-ES","en"] prefiere español a inglés, y eso hay que honrarlo.
 * Se compara por la subetiqueta primaria, asi que es-419, es-MX y es-ES son todos "es".
 * Si no aparece ninguno de los dos, gana el ingles: es la opcion mas legible para alguien
 * cuyo navegador esta en aleman o japones.
 */
function browserLang(langs) {
  for (const raw of langs ?? []) {
    const primaria = String(raw).toLowerCase().split("-")[0];
    if (LANGS.includes(primaria)) return primaria;
  }
  return "en";
}

/** Precedencia: lo que pide la URL > lo que se eligio antes > lo que dice el navegador. */
function pickLang(url, saved, langs) {
  if (LANGS.includes(url)) return url;
  if (LANGS.includes(saved)) return saved;
  return browserLang(langs);
}

function initialLang() {
  let url = null, saved = null;
  try { url = new URLSearchParams(location.search).get("lang"); } catch { /* sin location */ }
  try { saved = localStorage.getItem("lang"); } catch { /* modo privado */ }
  const langs = navigator.languages?.length ? navigator.languages
    : navigator.language ? [navigator.language] : [];
  return pickLang(url, saved, langs);
}

let LANG = initialLang();
const lang = () => LANG;
function setLang(l) {
  LANG = LANGS.includes(l) ? l : "es";
  document.documentElement.lang = LANG;
  try { localStorage.setItem("lang", LANG); } catch { /* modo privado */ }
}
const nextLang = () => LANGS[(LANGS.indexOf(LANG) + 1) % LANGS.length];

/** t("clave", {param}) — si falta la clave devuelve la clave, que se ve y se arregla. */
function t(key, params) {
  const s = DICT[LANG][key] ?? DICT.es[key] ?? key;
  return params
    ? s.replace(/\{\{(\w+)\}\}/g, (_, k) => (params[k] === undefined ? "" : String(params[k])))
    : s;
}

/** Plural simple: solo distingue 1 de el resto, que es lo que necesitan es y en. */
const tn = (key, n, params) => t(n === 1 ? key : key + "_plural", { ...params, n });

// se persiste lo que gano (la URL incluida): si no, quitar ?lang= volveria al idioma viejo
setLang(LANG);
