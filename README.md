# Motor Agéntico

**Dashboard local y de solo lectura del gasto, los tokens y la actividad de tus agentes de IA.**

Lee lo que Claude Code, Cursor, Codex y OpenCode ya escriben en tu disco, y te dice cuánto
consumes, en qué modelos, en qué proyectos y con qué herramientas. Todo se calcula en tu
máquina: no hay servidor, ni cuenta, ni telemetría, ni una sola petición saliente.

> **English:** local, read-only observability dashboard for AI coding agents. It parses the
> transcripts these tools already write to disk and reports spend, tokens, sessions, tools,
> skills and memory. Everything runs locally — no account, no telemetry, no outbound requests.
> The UI ships in Spanish and English; this README is in Spanish.

---

## Qué responde

- ¿Cuánto estoy gastando en IA, hoy, esta semana, este mes?
- ¿Qué modelos uso de verdad y cuánto cuesta cada uno?
- ¿Qué sesiones se comen el presupuesto?
- ¿En qué se van los tokens: input, output o caché?
- ¿Qué herramientas, skills y subagentes se están usando?
- ¿Qué hay guardado en mi sistema de memoria?
- ¿Qué patrones de trabajo puedo mejorar?

## Requisitos

- **[Bun](https://bun.sh) ≥ 1.3** — es el único requisito.
- Alguna de las herramientas soportadas con datos en disco.

**Sin dependencias.** No hay `npm install`, no hay `node_modules`, no hay build. El servidor,
la base SQLite y el dashboard usan lo que Bun trae de fábrica.

## Instalación

```bash
git clone https://github.com/ASanchezT85/agent-engine.git
cd agent-engine
bun run serve
```

Abre **http://127.0.0.1:4823**. La primera vez indexa solo; después arranca en frío.

Para usar otro puerto:

```bash
PORT=4824 bun run serve
```

## Comandos

| Comando | Qué hace |
|---|---|
| `bun run serve` | Levanta el dashboard. Indexa solo si la base está vacía |
| `bun run detect` | Lista qué herramientas encuentra, sin tocar la base |
| `bun run index` | Indexación incremental |
| `bun run audit` | Verifica el guard de solo lectura y regenera las recomendaciones |
| `bun test` | 30 tests |

El botón **Reindexar** del dashboard hace una pasada incremental sin reiniciar nada.

---

## Herramientas soportadas

| Herramienta | De dónde lee | Qué obtiene |
|---|---|---|
| **Claude Code** | `~/.claude/projects/**/*.jsonl` | tokens, coste, modelos, tool calls, skills, subagentes, MCP, memoria |
| **Cursor** | `AppData/Roaming/Cursor/User/globalStorage/state.vscdb` y `~/.cursor/ai-tracking/ai-code-tracking.db` | sesiones, modelos, tool calls, líneas escritas, % de autoría de IA por commit |
| **OpenAI Codex CLI** | `~/.codex/sessions/**/rollout-*.jsonl` | tokens, coste, modelo, esfuerzo de razonamiento, tool calls |
| **OpenCode** | `~/.local/share/opencode/storage/**` (respeta `XDG_DATA_HOME`) | tokens, **su propio coste calculado**, modelo, agente, tool calls |

Una herramienta que no esté instalada aparece como *no detectada*, no se inventa nada.

**Estado de madurez, con franqueza:** Claude Code y Cursor están probados contra datos reales.
Codex y OpenCode están escritos contra el formato verificado leyendo el código fuente de cada
proyecto (`openai/codex`, `anomalyco/opencode`) y probados con *fixtures*, pero **no contra una
instalación real**, porque quien lo escribió no los usa. Si su formato hubiera cambiado, verás
sesiones sin tokens; nunca datos inventados.

**Sistemas operativos:** desarrollado y probado en Windows 11. Las rutas de Claude Code, Codex
y OpenCode son multiplataforma; **la de Cursor asume Windows** (`AppData/Roaming`). En macOS o
Linux el resto funciona y Cursor aparecerá como no detectado hasta que alguien añada su ruta en
`src/providers/cursor.ts`.

---

## La regla que gobierna todo: solo lectura

Las carpetas de tus herramientas (`~/.claude`, `~/.codex`, `~/.cursor`, `~/.opencode`) se
tratan como **estrictamente de solo lectura**. No es una promesa, es una restricción del código:

- Todo acceso a disco ajeno pasa por `src/core/paths.ts`, que abre con `O_RDONLY`.
- `assertReadOnly(ruta, "write")` lanza una excepción si la ruta cae bajo una raíz externa.
  Hay test que lo comprueba.
- **Denylist dura por ruta**: `.credentials.json`, `.env*`, `*.key` y claves SSH ni siquiera
  se leen.
- Todo lo que el Motor escribe vive en `data/`, dentro del propio proyecto.

Cursor guarda sus bases en modo WAL y las escribe mientras la app está abierta. Abrirlas en
sitio, aunque sea en `readonly`, haría que SQLite quisiera crear un `-shm` junto al original —
eso ya sería escribir en carpeta ajena. Por eso el adapter **copia** los `.db` (con su `-wal` y
`-shm`) a `data/cursor-cache/` y lee la copia. Hay test que crea una base WAL de juguete y
verifica que el directorio de origen queda byte a byte igual tras leer.

## Privacidad

- El servidor escucha **solo en `127.0.0.1`**.
- Cero telemetría, cero analytics, cero dependencias en runtime.
- **No se sube ni un transcript a ningún sitio.**
- **No se almacena el texto de las conversaciones.** Solo el título de la sesión y el primer
  prompt, truncado a 200 caracteres y ya redactado. Los cuerpos de los mensajes nunca entran
  a la base.
- Redacción de secretos (`src/core/redact.ts`) en la ingesta y otra vez al servir memoria y
  skills: claves de Anthropic/OpenAI/GitHub/Slack/AWS/Google, JWT, claves privadas, cabeceras
  `Authorization`/`Cookie` y asignaciones tipo `PASSWORD=`.
- `data/` está en `.gitignore`: la base, la caché de Cursor y las exportaciones **no se suben**.

Si vas a publicar una captura del dashboard, ten en cuenta que muestra títulos de sesión y
rutas de proyecto reales.

---

## Costes

`config/pricing.json` es la **única** fuente de tarifas; nunca hay precios en el código. Cada
vendor lleva su origen y su fecha de verificación:

| Vendor | Fuente | Modelos |
|---|---|---|
| anthropic | <https://platform.claude.com/docs/en/about-claude/pricing> | Fable/Mythos 5, Opus 5→4, Sonnet 5→4, Haiku 4.5/3.5 |
| openai | <https://developers.openai.com/api/docs/pricing> | gpt-5.6 (sol/terra/luna), 5.5, 5.4 (+mini/nano/pro), 5.3-codex, 5.2, 5.1, 5, mini, nano |

Un modelo sin tarifa se marca `UNVERIFIED`, su coste cuenta como 0 y aparece como aviso en el
dashboard y en las recomendaciones. **Nunca se inventa un precio.**

Para añadir o corregir una tarifa, edita `config/pricing.json` y actualiza `verifiedAt`. No
hace falta tocar código.

**Los dos vendors cobran la caché distinto, y el motor lo respeta:**

- **Anthropic** cobra la *escritura* de caché con recargo (1,25x a 5 min, 2x a 1 h) y la
  lectura a 0,1x.
- **OpenAI** no cobra extra la escritura: va a precio de input normal; solo la lectura es más
  barata. Por eso sus modelos llevan `cacheWrite5m = cacheWrite1h = input`.

También se aplican el *fast mode* (Opus 5/4.8 y gpt-5.3-codex) y el multiplicador 1,1x de
`inference_geo: "us"` de Anthropic.

> ### Los costes son estimaciones a tarifa API
> Si tus sesiones corrieron bajo una suscripción (Claude Pro/Max, ChatGPT Plus…), el coste
> marginal real fue distinto — probablemente cero. **El número mide consumo, no tu factura.**

---

## Funciones del dashboard

- **Overview** — gasto de hoy / 7 / 30 días, coste por modelo y proyecto, desglose de tokens.
- **Costes** — series diaria, semanal y mensual.
- **Sesiones** — tabla ordenable y buscable; cada sesión se abre en detalle.
- **Actividad** — procesos vivos, sesiones recientes, herramientas, skills, subagentes, MCP,
  actividad por hora y por día de la semana.
- **Cursor** — % de código escrito por IA, autoría por rama, sesiones y modelos.
- **Memoria** — inventario de la memoria persistente, con redacción.
- **Skills** — qué skills tienes y cuáles usas de verdad.
- **Grafo** — proyectos ↔ herramientas / skills / subagentes.
- **Mejoras** — recomendaciones automáticas (ver abajo).

**Filtros** por rango de fechas (con presets), proveedor y proyecto. Viven en la URL, así que
una vista concreta se comparte, se recarga y funciona con atrás/adelante del navegador.

**Exportar** escribe JSON + CSV en `data/exports/`, respetando el filtro activo. El JSON declara
qué secciones se filtraron y cuáles no, con el motivo.

**PDF** imprime la vista actual con su filtro, usando el motor de impresión del navegador.

**Tema** claro / oscuro / sistema, e **idioma** español / inglés con detección automática.

## Sistema de mejoras

Analiza lo indexado y **propone**, nunca aplica. Las recomendaciones se guardan en
`data/recommendations.json`; el Motor jamás modifica la configuración de tus herramientas.

Detecta: sesiones desproporcionadamente caras, reuso pobre de caché, contextos gigantes,
herramientas casi sin usar, prompts repetidos candidatos a skill, proyectos con mucha ejecución
manual de comandos, y modelos sin tarifa.

---

## Arquitectura

```
config/pricing.json        tarifas, desacopladas del código
src/core/paths.ts          guard de solo lectura, denylist, lectura por offset
src/core/redact.ts         detección y redacción de secretos
src/core/pricing.ts        normalización de modelos + motor de coste
src/core/jsonl.ts          lectura incremental de JSONL, compartida entre adapters
src/core/db.ts             esquema SQLite
src/core/analytics.ts      consultas de overview, costes, sesiones, actividad, grafo
src/core/inventory.ts      skills, memoria y procesos vivos (escaneo en caliente)
src/core/recommend.ts      sistema de mejoras
src/core/export.ts         exportación a JSON y CSV
src/providers/*.ts         un adapter por herramienta + registro
src/server/server.ts       API HTTP + estáticos
web/                       dashboard (HTML/CSS/JS, gráficos SVG a mano, sin frameworks)
test/engine.test.ts        30 tests
```

**El backend no manda prosa.** Las notas de proveedor y las recomendaciones viajan como clave
de traducción + números (`{ id: "cache-churn", params: { written: 833.8, read: 44310 } }`); el
texto lo pone el front. Así no hay dos copias del mismo párrafo ni un backend decidiendo
presentación.

### Indexación incremental

`files(path, size, mtime, offset)` guarda el byte exacto hasta donde se leyó cada transcript:

1. Si `size` y `mtime` no cambiaron → se salta el archivo entero.
2. Si creció → se lee **solo** desde `offset`.
3. Si encogió → se reindexa desde 0 (archivo reescrito).
4. Una última línea sin `\n` (una sesión escribiendo ahora mismo) no se consume: el offset se
   queda antes y esa línea se lee entera en la pasada siguiente.

Ningún archivo se carga completo en memoria: se lee en trozos de 4 MB. En la máquina de
desarrollo, con 1,5 GB de transcripts y un archivo suelto de 402 MB, la primera indexación
tardó ~19 minutos y las siguientes 0,4 s.

### Añadir una herramienta

Implementa la interfaz `Provider` de `src/core/types.ts`:

```ts
export const miProvider: Provider = {
  id: "mitool",
  label: "Mi Herramienta",
  detect() { /* { installed, root, note: "clave.i18n", noteParams } */ },
  index(db) { /* devuelve { files, newBytes, messages } */ },
};
```

Regístralo en `src/providers/registry.ts` y añade sus textos a `web/i18n.js`. Reglas de la
casa: **nunca escribas** en la carpeta de la herramienta, usa `assertReadOnly`, pasa los textos
libres por `redact()` y respeta el gate de frescura por `size`+`mtime`.

---

## Trampas de medición que este proyecto ya pisó

Documentadas porque cualquiera que mida lo mismo se las va a encontrar:

- **El consumo acumulado no se suma.** El `total_token_usage` de Codex es acumulado por sesión,
  no por turno; sumar los eventos multiplica el gasto por el número de turnos. (Es el bug de
  inflación 91x que reportaron en `ccusage`.) Se toma el máximo.
- **El input reportado ya incluye el cacheado.** Hay que restarlo o los tokens de caché se
  cuentan dos veces.
- **El filtro corta mensajes, no sesiones.** Si corta sesiones, una que roza el rango aporta su
  coste entero y la suma deja de cuadrar con el total. Hay test que fija el invariante.
- **La escritura de caché no cuesta lo mismo en todos los vendors.** Ver la sección de costes.
- **Los desplegables de filtro se llenan sin filtrar.** Si se filtraran, elegir un proyecto de
  una sola sesión vaciaría su propio desplegable y no habría cómo volver atrás.

## Limitaciones conocidas

- **Coste ≠ factura.** Ver arriba.
- **Cursor no registra tokens por petición** (todos vienen en 0), así que no entra en las cifras
  de dinero. Su pestaña mide lo que sí guarda: autoría, sesiones, modelos, herramientas.
- El pico de contexto de una sesión de Cursor es la última medición, no un acumulado.
- **No se empareja un PID con su sesión**: ningún campo los une. Se muestran los procesos vivos
  y, aparte, qué sesiones escribieron en los últimos 10 minutos.
- «Usos» de una skill cuenta invocaciones vía la herramienta `Skill`; una skill cargada por hook
  o `SessionStart` no deja rastro.
- Los tokens se atribuyen al día del mensaje, no al de facturación.
- **Bug de Chrome al imprimir**: en una tabla que cruza páginas, los glifos no-ASCII de la
  cabecera repetida (la Ó de «DURACIÓN») se dibujan en la coordenada de la cabecera original y
  aparecen sueltos al pie como una marca de ~1 mm. Hay un interruptor comentado en
  `web/style.css` para desactivar la repetición de cabecera si molesta más que perder los
  rótulos.

## Estado

Funciona y está en uso. No tiene CI, ni versionado semántico, ni promesa de compatibilidad.
Los issues y PRs son bienvenidos, sobre todo:

- rutas de Cursor en macOS/Linux;
- confirmación de los adapters de Codex y OpenCode contra instalaciones reales;
- tarifas nuevas o corregidas en `config/pricing.json`.
