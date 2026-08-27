# Motor Agéntico

Dashboard local, privado y **estrictamente read-only** de observabilidad sobre Claude Code
y el resto del ecosistema de agentes de IA de la máquina.

## Ejecutar

```bash
cd C:\laragon\www\agent-engine
bun run serve     # dashboard -> http://127.0.0.1:4823
```

`serve` indexa solo si la base está vacía. El botón **Reindexar** del dashboard hace una
pasada incremental sin reiniciar nada.

El resto de comandos:

```bash
bun run detect    # qué herramientas se detectan, sin tocar la base
bun run index     # indexación incremental
bun run audit     # auditoría read-only + recomendaciones
bun test          # 30 tests
```

Único requisito: **Bun** (ya instalado, v1.3.14). Cero dependencias: no hay `npm install`.

Tiempos medidos en esta máquina: primera indexación **19 min** (1,5 GB de transcripts);
reindexado sin cambios **0,4 s**; con Cursor abierto **~60 s**, porque su `state.vscdb` pesa
1 GB y hay que copiarlo entero para leerlo sin tocar el original.

Typecheck opcional (única dependencia, y solo de tipos):
`bun add -d bun-types typescript && bunx tsc --noEmit`

## Regla read-only

`~/.claude`, `~/.codex`, `~/.cursor` y `~/.opencode` se tratan como de solo lectura.

- Todo acceso a disco ajeno pasa por `src/core/paths.ts`, que abre con `O_RDONLY`.
- `assertReadOnly(path, "write")` lanza si la ruta cae bajo una raíz externa. Hay test.
- Denylist dura por ruta: `.credentials.json`, `.env*`, `*.key`, claves SSH — no se leen siquiera.
- Todo lo que el Motor escribe vive en `agent-engine/data/`.

## Privacidad

- Local first: el servidor escucha solo en `127.0.0.1`.
- Sin telemetría propia, sin analytics, sin dependencias externas en runtime (cero `node_modules`).
- No se sube ni un transcript a ningún servicio.
- No se almacena texto de conversación: solo el título de sesión y el primer prompt truncado a
  200 caracteres, ya redactado. Los cuerpos de los mensajes nunca entran a la base.
- Redacción de secretos (`src/core/redact.ts`) en ingesta y otra vez al servir memoria y skills.

## Costes

`config/pricing.json` es la única fuente de tarifas — nunca hay precios en el código.
Cada vendor lleva su origen y su fecha en `sources`; ambos verificados el 2026-08-27:

| Vendor | Fuente | Modelos |
|---|---|---|
| anthropic | <https://platform.claude.com/docs/en/about-claude/pricing> | Fable/Mythos 5, Opus 5→4, Sonnet 5→4, Haiku 4.5/3.5 |
| openai | <https://developers.openai.com/api/docs/pricing> | gpt-5.6 (sol/terra/luna), 5.5, 5.4 (+mini/nano/pro), 5.3-codex, 5.2, 5.1, 5, mini, nano |

Un modelo sin tarifa se marca `UNVERIFIED`, su coste cuenta como 0 y aparece como aviso en
Overview y en las recomendaciones. Nunca se inventa un precio.

**Los dos vendors cobran la caché distinto y el motor lo respeta:**

- Anthropic cobra la *escritura* de caché con recargo — 1,25x a 5 min, 2x a 1 h — y la lectura
  a 0,1x.
- OpenAI **no cobra extra la escritura**: se factura a precio de input normal. Solo la lectura
  es más barata (0,1x). Por eso sus modelos llevan `cacheWrite5m = cacheWrite1h = input`.

También se aplican fast mode (Opus 5/4.8 y gpt-5.3-codex) y el multiplicador 1,1x de
`inference_geo: "us"` de Anthropic.

> **Los costes son estimaciones a tarifa API.** Si la sesión corrió bajo una suscripción
> (Pro/Max), el coste marginal real fue distinto. El número mide consumo, no factura.

## Arquitectura

```
config/pricing.json        tarifas, desacopladas del código
src/core/paths.ts          guard read-only, denylist, lectura por offset
src/core/redact.ts         detección y redacción de secretos
src/core/pricing.ts        normalización de modelos + motor de coste
src/core/db.ts             esquema SQLite
src/core/analytics.ts      consultas de overview, costes, sesiones, actividad, grafo
src/core/inventory.ts      skills, memoria y sesiones vivas (escaneo en caliente)
src/core/recommend.ts      sistema de mejoras (propone, nunca aplica)
src/providers/claude.ts    parser + indexador incremental de transcripts JSONL
src/providers/cursor.ts    adapter de Cursor (state.vscdb + ai-code-tracking.db)
src/providers/codex.ts     adapter de OpenAI Codex CLI (rollouts JSONL)
src/providers/opencode.ts  adapter de OpenCode (storage/session|message|part)
src/providers/registry.ts  registro de los cuatro adapters
src/core/jsonl.ts          lectura por offset de JSONL, compartida entre adapters
src/core/export.ts         exportacion a JSON y CSV
src/server/server.ts       API HTTP + estáticos
web/                       dashboard (HTML/CSS/JS, gráficos SVG a mano)
```

## Indexación incremental

`files(path, size, mtime, offset)` guarda el byte exacto hasta donde se leyó cada transcript.
En cada pasada:

1. Si `size` y `mtime` no cambiaron → se salta el archivo entero.
2. Si creció → se lee **solo** desde `offset`.
3. Si encogió → se reindexa desde 0 (archivo reescrito).
4. Una última línea sin `\n` (sesión escribiendo ahora mismo) no se consume: el offset se
   queda antes y esa línea se lee completa en la pasada siguiente.

Ningún archivo se carga entero en memoria: se lee en trozos de 4 MB. El transcript mayor
de esta máquina pesa 402 MB.

## Adapter de Cursor

Cursor guarda sus bases en modo WAL y las escribe mientras la app está abierta. Abrirlas en
sitio, aunque sea en `readonly`, haría que SQLite quisiera crear un `-shm` junto al original:
eso sería escribir en carpeta ajena. Por eso el adapter **copia** `state.vscdb` (con su `-wal`
y `-shm`) y `ai-code-tracking.db` a `data/cursor-cache/` y lee la copia. Hay test que lo
verifica: tras leer, el directorio de origen queda byte a byte igual.

La copia solo ocurre cuando cambian tamaño o mtime del original. `state.vscdb` pesa ~1 GB, así
que una reindexación con Cursor activo cuesta unos segundos de copia.

Lo que se extrae, todo con `json_extract` dentro de SQLite (22.500 tool calls en 3 s, sin
parsear 317 MB de JSON en memoria):

| Fuente | Qué da |
|---|---|
| `composerData:*` | título, modelo (`grok-4.5`, `composer-2.5-fast`, `gpt-5.5-medium`…), modo, líneas +/−, pico de contexto, nº de mensajes |
| `composerHeaders` | fechas, workspace, si es subagente, si está archivada |
| `bubbleId:*` | tool calls por nombre y sesión (`read_file_v2`, `ripgrep_raw_search`, `edit_file_v2`…) |
| `scored_commits` | líneas de IA vs humano por commit y rama, con % de autoría |

No se ingesta `ai_code_hashes`: son 23 filas sin modelo, con nombres de archivo como `.env`.
Señal nula y riesgo de exponer rutas sensibles.

## Adapter de Codex

Codex CLI escribe un *rollout* JSONL por sesión en `~/.codex/sessions/YYYY/MM/DD/rollout-<ISO>-<uuid>.jsonl`
(y `~/.codex/archived_sessions`). Cada línea es `{timestamp, ordinal?, type, payload}`:

| `type` | Qué se saca |
|---|---|
| `session_meta` | id de hilo, `cwd`, `originator`, `cli_version`, y si es subagente (`parent_thread_id` / `agent_role`) |
| `turn_context` | `model` y `reasoning_effort` (también dentro de `collaboration_mode.settings`) |
| `event_msg` con `payload.type == "token_count"` | `info.total_token_usage`: `input_tokens`, `cached_input_tokens`, `cache_write_input_tokens`, `output_tokens`, `reasoning_output_tokens` |
| `response_item` | tool calls (`function_call`, `local_shell_call`, `custom_tool_call`) y el primer mensaje del usuario como título |

**La trampa:** `total_token_usage` es **acumulado de la sesión**, no del turno. Sumar todos los
eventos `token_count` multiplica el consumo por el número de turnos — es exactamente el bug de
inflación que reportaron en `ccusage` (issue #950). El adapter se queda con el máximo por sesión
y hay un test que lo fija.

También se resta `cached_input_tokens` del `input_tokens` reportado, porque el segundo ya
incluye al primero: si no, los tokens de caché se cuentan dos veces.

## Adapter de OpenCode

OpenCode guarda un JSON por entidad bajo `Global.Path.data/storage` (en Windows,
`~/.local/share/opencode/storage`; respeta `XDG_DATA_HOME`):

```
storage/session/<projectID>/<sessionID>.json
storage/message/<sessionID>/<messageID>.json
storage/part/<messageID>/<partID>.json
```

El fichero de sesión **ya trae los totales agregados**, así que no hay que recorrer los
mensajes para saber lo que costó: `tokens {input, output, reasoning, cache {read, write}}`,
`cost`, `model {id, providerID}`, `title`, `agent`, `directory`, `version`, `parentID`
(subagente) y `summary {additions, deletions, files}`.

**OpenCode calcula su propio coste**, y es el único de los cuatro que lo hace. El adapter usa
ese número tal cual y solo recurre a `config/pricing.json` si falta. Los modelos vienen como
`anthropic/claude-sonnet-5`, así que `normalizeModel` aprendió a quitar el prefijo de proveedor.

Las tool calls salen de las partes (`part/<messageID>/*.json` con `type: "tool"`), y también
se lee la forma antigua (`metadata.tool` dentro del mensaje) por si el almacén viene de una
versión anterior.

## Idioma

Español e inglés, con un botón en la cabecera. Precedencia: **URL > lo que elegiste antes >
el navegador**.

La detección recorre `navigator.languages` **en orden**, no solo la primera, y compara por la
subetiqueta primaria:

| `navigator.languages` | Idioma |
|---|---|
| `["es-ES"]`, `["es-419"]`, `["pt-BR","es-AR"]` | español |
| `["en-GB"]`, `["de-DE","en-US","es"]` | inglés |
| `["fr-FR","es-ES","en"]` | español — se respeta que prefiera español al inglés |
| `["ja-JP","ko"]`, lista vacía | inglés |

Un navegador que no habla ninguno de los dos recibe **inglés**, no español: es lo más legible
para alguien que tiene el navegador en alemán o japonés. La elección se persiste en cuanto se
resuelve, así que quitar `?lang=` de la URL no devuelve al idioma anterior.

**El backend no manda prosa.** Las notas de proveedor y las recomendaciones viajan como
**clave + números** (`{ id: "cache-churn", params: { written: 833.8, read: 44310 } }`) y el
texto lo pone el front. Así no hay dos copias del mismo párrafo ni un backend decidiendo
presentación. El único texto traducido en el servidor es el de los motivos de «no filtrado»
que se escriben dentro del JSON exportado, y ese endpoint recibe `?lang=`.

Todo el diccionario vive en `web/i18n.js`. Cuatro tests lo vigilan:

- los dos idiomas tienen exactamente las mismas claves;
- toda clave que usa `app.js` existe en ambos;
- cada nota de proveedor y cada recomendación tiene título y detalle en ambos;
- los parámetros `{{x}}` coinciden entre idiomas (un `{{n}}` que falte en la traducción
  dejaría un hueco en la frase).

Los números y las fechas se formatean con el locale activo (`es-ES` / `en-US`); el dinero
siempre en formato USD, que es la moneda de las tarifas.

## Filtros

Overview, Costes, Sesiones y Actividad llevan una barra con **presets · desde / hasta ·
proveedor · proyecto**. El filtro vive en el cliente y viaja como query string a la API, así que
se mantiene al cambiar de pestaña.

Presets: `Todo · Hoy · 7 días · 30 días · Este mes`. Se calculan en UTC, igual que los
timestamps guardados, y el chip activo se deduce del rango: si escribes a mano las fechas de
"este mes", se ilumina solo.

**El filtro vive en la URL**, así que una vista concreta se comparte, se recarga y se navega
con atrás/adelante:

```
/?view=costs&from=2026-08-01&to=2026-08-10&provider=claude&sort=cost
/?session=98f09eca-17e2-42d5-93a1-fe44c517756a
```

Las fechas van en corto (`YYYY-MM-DD`) y el rango completo se reconstruye al leer. Los
parámetros se validan: una fecha inventada (`from=basura`, `to=2026-99-99`) o un orden
desconocido se ignoran y la URL se normaliza sola, en vez de dejar un `$0.00` sin explicación.
Una URL de sesión abierta en frío no trae pestaña de origen, así que se marca Sesiones — que es
adonde lleva el botón Volver.

- Las fechas se escriben en **dd/mm/aaaa**. El `<input type="date">` nativo no deja elegir el
  formato —lo impone el locale del navegador, que aquí mostraba `mm/dd/aaaa`—, así que el campo
  es de texto y el calendario del sistema sigue disponible en el botón de al lado
  (`showPicker()` sobre un `date` oculto). Una fecha imposible como `31/02/2026` marca el campo
  en rojo y **no** filtra, en vez de colar una fecha silenciosamente corrida.
- `hasta` cubre el día entero (`T23:59:59.999Z`). Si cortara a medianoche se perdería todo lo
  de ese día, que es justo lo que uno espera ver al escribirlo.
- Las tool calls no llevan proveedor propio, así que en Actividad se acotan por las sesiones
  que pasan el filtro, no por la herramienta.
- Las tarjetas Hoy / 7 días / 30 días siguen siendo periodos absolutos —eso es lo que
  significan— pero respetan el filtro de proveedor.
- Los desplegables se llenan desde `/api/facets`, que **no aplica el filtro**. Si se filtraran,
  elegir un proyecto de una sola sesión vaciaría su propio desplegable y no habría cómo volver.
- **La barra solo aparece donde el filtro se aplica de verdad.** Memoria, Skills, Cursor, Grafo
  y Mejoras no la muestran, en vez de enseñar unos controles que no harían nada.
- **El filtro corta mensajes, no sesiones.** Si cortara sesiones, una que roza el rango
  aportaría su coste entero y la suma no cuadraría con el total de Overview. Hay test que lo fija.
- Las tool calls se acotan por sesión **y** por tiempo, por el mismo motivo.

## Exportar

El botón **Exportar** de la cabecera escribe tres archivos en `data/exports/`:

| Archivo | Qué lleva |
|---|---|
| `motor-agentico-<ts>.json` | el volcado completo: overview, series diaria/semanal/mensual, 1000 sesiones, actividad, skills, memoria, Cursor, recomendaciones y las tarifas con su fecha de verificación |
| `sesiones-<ts>.csv` | una fila por sesión, 19 columnas: proveedor, proyecto, título, duración, tokens desglosados, coste y tool calls |
| `coste-diario-<ts>.csv` | la serie diaria, lista para una hoja de cálculo |

**La exportación respeta el filtro activo.** Los archivos llevan sufijo `-filtrado` y el JSON
abre con un bloque `filter` que dice qué se aplicó y, sección por sección, qué **no** se pudo
acotar y por qué:

```json
"filter": {
  "applied": { "from": "...", "to": "...", "provider": "claude" },
  "appliedTo": ["overview","daily","weekly","monthly","sessions","activity","skills.uses"],
  "notApplied": {
    "memory": "los archivos de memoria son del disco: no cuelgan de una sesion ni de una fecha",
    "cursor": "Cursor tiene su propio almacen y no comparte el eje de proveedor/proyecto",
    "recommendations": "se calculan sobre todo el historico; acotarlas cambiaria lo que significan"
  }
}
```

Un volcado a medio filtrar sin decirlo se malinterpreta; diciéndolo, es útil.

Escribe a disco en vez de disparar una descarga del navegador: así funciona igual aunque el
navegador bloquee descargas, y los archivos quedan junto al Motor. Para descargar de verdad
desde un navegador normal están `GET /api/export` y `GET /api/export?format=csv`, con su
`Content-Disposition`.

El CSV entrecomilla y dobla comillas como manda el formato: un título con una coma no corre
las columnas del resto de la fila, y hay test que lo fija. La exportación de memoria **no
incluye el cuerpo de los archivos**, solo sus metadatos, y todo pasa por la misma redacción
de secretos que el dashboard.

## PDF

El botón **PDF** imprime la vista que estás mirando, con su filtro. Lo genera el navegador:
sin librerías de PDF, sin Chrome headless, sin servicio externo. En el diálogo, «Guardar como PDF».

Antes de imprimir se inserta un encabezado que solo existe en el papel y que deja constancia de
qué es ese PDF: vista, rango de fechas, proveedor, proyecto, sesión si es un detalle, y fecha de
generación. Se quita solo al terminar (`afterprint`, con respaldo por tiempo si el navegador no
lo manda).

La hoja `@media print` esconde cabecera, pestañas, filtros, botones y los `<details>` plegados,
fuerza colores claros aunque estés en tema oscuro, y evita que se partan filas, tarjetas,
gráficos y listas de barras entre páginas. El aviso de «Mostrando 60 de 269» **sí** se imprime:
un PDF con la tabla recortada tiene que decirlo.

Revisado sobre PDFs reales generados con Chrome headless (`--print-to-pdf`) y rasterizados
página a página. Lo que se corrigió al mirarlos:

| Defecto | Causa | Arreglo |
|---|---|---|
| La tabla de Sesiones perdía Tokens, Tools y Coste | `white-space: nowrap` en las cabeceras impedía que encogiera al ancho imprimible (688px) | `table-layout: fixed` + cabeceras con salto |
| «Input» quedaba huérfano en la página siguiente, lejos de su título | la lista de barras se partía por la mitad | `break-inside: avoid` en `.rows` |
| Banda gris al pie de las métricas | los separadores eran hueco con el fondo del contenedor asomando; con la última fila incompleta se veía la banda entera | separadores por borde en cada celda |
| Última etiqueta del eje X cortada | `text-anchor: middle` la sacaba fuera del `viewBox` | primera y última ancladas al borde |

Confirmado en el PDF: el `<thead>` se repite en cada página y ninguna fila se parte.

### Un artefacto de Chrome que no se pudo quitar

En una tabla que cruza páginas, Chrome repite el `<thead>` (bien) pero dibuja los glifos
**no-ASCII de esa cabecera repetida** en la coordenada de la cabecera *original*. El resultado:
la página 1 muestra `DURACIÓN` con tilde, la página 2 muestra `DURACION` sin ella, y la tilde
aparece suelta al pie de la página 1 como una marca de ~1 mm.

Cómo se localizó: descomprimiendo los content streams del PDF con `node:zlib`. El último
operador de la página era `/F10 12.5 Tf … <79> Tj` — un solo glifo, y el `ToUnicode` de esa
fuente mapea `<79>` a `U+00D3`, es decir `Ó`.

Se probó sin éxito: fuente estática en vez de variable, fuente empotrable con licencia OFL,
separador de fila arriba en vez de abajo, y `border-collapse: separate`. Todas las cabeceras
resuelven a una sola fuente en layout (`CSS.getPlatformFontsForNode` lo confirma); el reparto
lo hace el exportador de PDF, no el motor de layout.

Lo único que lo elimina es no repetir la cabecera. Si la marca molesta más que perder los
rótulos en las páginas 2 y siguientes, hay una línea comentada en `web/style.css`:

```css
@media print { thead { display: table-row-group; } }
```

## Sistema de mejoras

`bun run audit` (o la pestaña Mejoras) genera recomendaciones y las guarda en
`data/recommendations.json`. **El Motor nunca aplica cambios ni toca la configuración de
Claude Code.** Detecta: sesiones desproporcionadamente caras, reuso pobre de cache,
contextos gigantes, herramientas casi sin uso, prompts repetidos candidatos a skill,
proyectos con mucha ejecución manual de comandos, y modelos sin tarifa.

## Limitaciones conocidas

- **Coste ≠ factura.** Ver la nota de arriba.
- **Cursor no expone tokens por petición ni coste** (todos los `tokenCount` de sus mensajes
  vienen en 0). Su pestaña muestra lo que sí registra: sesiones, modelo, modo, tool calls,
  líneas escritas y el % de código con autoría de IA por commit. No entra en las cifras de
  dinero, que son solo de Claude Code.
- El pico de contexto de una sesión de Cursor es la última medición de esa sesión, no un
  acumulado: no es comparable con los tokens consumidos de Claude Code.
- **El adapter de Codex no se ha probado contra datos reales**: Codex CLI no está instalado en
  esta máquina. El formato se verificó leyendo el código fuente de `openai/codex`, y el parser
  se prueba con un fixture que reproduce ese esquema. El día que instales Codex, `bun run index`
  lo recoge solo; si el formato hubiera cambiado, se verá como sesiones sin tokens, no como datos
  inventados.
- **El adapter de OpenCode tampoco se ha probado con datos reales**: está instalado (v1.18.10)
  pero nunca se ha usado, su almacén está vacío. El formato se verificó contra el código de
  `anomalyco/opencode` y el adapter se prueba de punta a punta con un almacén sintético.
- Se cuentan los procesos de Claude Code vivos (PID en `~/.claude/sessions`), pero **no se
  empareja un PID con su transcript**: no hay ningún campo que los una. En su lugar el
  dashboard lista qué sesiones escribieron en los últimos 10 minutos, que sí es comprobable.
- «Usos» de una skill cuenta invocaciones vía la herramienta `Skill`. Una skill cargada por
  otra vía (hook, `SessionStart`) no aparece.
- Los tokens de un mensaje se atribuyen al día del mensaje, no al de facturación.

## Mejoras futuras

- Adapter real para Cursor (actividad de edición, sin coste).
- Watcher de sistema de archivos para indexar en vivo en lugar de por botón.
- Coste efectivo bajo suscripción, si algún día hay una fuente local de cupo consumido.
- Búsqueda de texto completo sobre transcripts, con redacción, opcional y desactivada por defecto.
