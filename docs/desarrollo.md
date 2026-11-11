# Desarrollo

Arrancar el proyecto, modos y roles, seguridad, partidas de estudio, comandos, API y
proveedores. Las convenciones del código, en [CLAUDE.md](../CLAUDE.md); cómo contribuir, en
[CONTRIBUTING.md](../CONTRIBUTING.md).

## Cómo arrancar

Requisitos: Node 20+, pnpm 9 y, si quieres persistencia, Docker.

```bash
pnpm install        # sin red también: onnxruntime no descarga nada (ver «Embeddings sin red»)
pnpm dev            # crea .env si falta; api + sim-worker (http://127.0.0.1:3001) + web (http://localhost:5173)
```

Funciona en **modo mock** con almacén en RAM (el api corre los mundos y el worker sale avisando).
Para que el mapa se vea en pixel art necesitas un pack de assets (ver [assets](assets.md)); sin él, el cliente
pinta formas simples.

Con persistencia en Postgres + pgvector (solo escucha en `127.0.0.1`; credenciales en `.env`):

```bash
docker compose up -d   # Postgres en el puerto 5433 del host (POSTGRES_PORT para cambiarlo)
pnpm db:migrate
pnpm user:create admin admin   # pide la contraseña sin eco
pnpm dev
```

`pnpm seed` borra memorias, costes, auditoría, fichas, eventos, crónicas e instantáneas de todos
los mundos (los mundos se conservan) y vuelve a sembrar. En RAM no hay `user:create`: define
`DEV_ADMIN_PASSWORD` en `.env` y entra como `admin`.

Producción en un VPS (Caddy con HTTPS, api, workers y Postgres): **[despliegue](despliegue.md)**.

## Modos y roles

| Modo           | Quién                    | Qué ve y qué puede hacer                                                                                                                                                  |
| -------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Espectador** | Cualquiera, sin cuenta   | Mapa, feed de **dramas** con «Ir a verlo», inspector y jardín de recuerdos, Rashomon, línea de tiempo y crónicas. Sin costes ni depuración. Crear clip y enlaces.         |
| **Director**   | Rol `director` o `admin` | Además: velocidad, pausa, voz interior, objetos, clima, escribir la crónica y métricas. El `admin` ve también costes, el kill switch y el aviso de assets no comerciales. |
| **Overlay**    | `/overlay?world=…` (OBS) | Fondo transparente con el mapa, el reloj y los últimos dramas.                                                                                                            |

- **Mapa**: rueda o pellizco para zoom (×1–×4), arrastrar para desplazar, flechas y `+`/`−` con el
  mapa enfocado, clic o el selector «Elegir agente» para inspeccionar. Los tejados se desvanecen
  si hay alguien dentro.
- **Dramas**: rumores, escuchas a escondidas, discusiones y amistades (cambios de afinidad),
  reconsolidaciones y olvidos importantes, puntuados por interés.
- **Compartir**: «Crear clip» graba la vista en vertical 9:16 (10–30 s) con la marca de agua;
  la vista Rashomon se exporta como PNG; `?event=…`, `?drama=…` y `?agent=…` son enlaces permanentes.
- En móvil el mapa ocupa la pantalla y los paneles van en una hoja inferior con pestañas.
- Primera visita: onboarding de 3 pasos (botón «Ayuda» para verlo otra vez). Textos en es/en.

## Seguridad y gasto

- Sesiones con cookie `httpOnly` + `SameSite=Lax` (+ `Secure` en producción), contraseñas con
  argon2id, `pnpm user:create`. Las peticiones que mutan exigen rol y un `Origin` permitido.
- Rate limit global y más estricto en intervención (`RATE_LIMIT_INTERVENTION_PER_MINUTE`) y
  crónicas; WebSocket con comprobación de Origin, `maxPayload`, heartbeat y límite por IP.
- El texto de los jugadores se sanea, se limita (`USER_TEXT_MAX`), se modera con el modelo `fast`
  y entra en los prompts entre `⟦ ⟧` como dato no confiable. Los rechazos quedan en
  `moderation_log`.
- **Gasto**: el servidor lo suma (por mundo, día y mes) para verlo, pero no lo limita: eso se
  controla con el saldo de la API key. Kill switch para admin.
- LLM con timeout propio, reintentos con backoff y jitter en 429/5xx y circuit breaker; Batch API
  (activa por defecto, `LLM_BATCH=on`; solo Anthropic) para la consolidación nocturna y las
  crónicas: la mitad de precio en casi la mitad del gasto. **Solo se usa mientras ningún mundo va
  más rápido que `LLM_BATCH_MAX_SPEED` (x10)**: para aprovecharla, las noches tienen que ir a x10
  o menos (a más velocidad, esas llamadas van por la vía normal, a precio completo). Si un lote
  tarda más de `LLM_BATCH_MAX_WAIT_MINUTES`, se repite por la vía normal.

## Partidas de estudio largas

[`.env.study.example`](../.env.study.example) es una capa sobre `.env` (sin secretos) para grabar
partidas de 7 días con el LLM real: x10, Batch activa, sin pausar cuando nadie mira y una
semilla por base de datos. Lleva los comandos para dos semillas (7 y 13): crear la base, migrar,
`pnpm dev`, `record --hours 168`, `world:export` y `pnpm study:analyze` para compararlas.
Para medir la fase 3.6, un mundo de control con `SIM_COGNITION=off` (`COGNITION_CONTROL=on` en
`scripts/estudio-semana.sh`): `study:analyze` compara los dos (encuentros, saludos, charlas en
el camino, asociaciones, red y coste).

Todas las variables, con su explicación, están en [`.env.example`](../.env.example).

## Repetición y modo cine

Una partida grabada se ve en la web sin servidor, sin LLM y sin coste: `pnpm replay:pack
<grabación>` hace un `.replay.json.gz` (solo lo publicable: lista blanca) y `/replay` lo
reproduce (arrastrándolo o con `?src=/replays/<nombre>`, de `apps/web/public/replays/`). Play,
velocidades de x1 a x360, saltar a un día y hora y una lista de **momentos** (dramas, crónicas,
conversaciones largas, recuerdos que cambian, metas…) con atajos de teclado. El **modo cine**
(`?cine=1`) deja solo el mapa en un marco 9:16, 4:5 o 16:9 con zona segura, cámara que encuadra
a quien habla, subtítulos grandes, tarjetas (jardín de recuerdos, Rashomon, red, metas, maestro y
alumno) y la marca «Repetición de una partida real», y graba clips a 30 fps.
`pnpm replay:moments <grabación> [<otra>]` saca los candidatos a clip a `moments.md`, con los
arcos largos aparte (y, con dos semillas, cómo acabó en cada una lo mismo). También: la tarjeta
«así muere un recuerdo» (`&memory=<id>`), la pantalla partida con dos semillas
(`&src2=…&split=1`), el contador de días y las escenas de los guiones
([`docs/videos/escenas.json`](videos/README.md), `?scene=<id>`). Ver
[repetición](decisiones/repeticion.md).

## Comandos

| Comando                                           | Qué hace                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm test` / `lint` / `typecheck` / `format`     | Vitest, ESLint, TypeScript y Prettier.                                                                                                                                                                                                                                                                                        |
| `pnpm map:generate [--pack nombre]`               | Regenera `seeds/town.tmj` con los sellos del pack indicado (por defecto, `activePack`).                                                                                                                                                                                                                                       |
| `pnpm assets:placeholder`                         | Genera el set placeholder propio en `apps/web/public/assets/placeholder/`.                                                                                                                                                                                                                                                    |
| `pnpm assets:check [--strict]`                    | Lista los assets en uso con su licencia y marca los no comerciales (`--strict` falla si hay alguno).                                                                                                                                                                                                                          |
| `pnpm portraits:compose`                          | Compone los retratos animados de los agentes con las capas del Portrait Generator ([assets](assets.md#retratos-portrait-generator-de-limezu)).                                                                                                                                                                                |
| `pnpm user:create <usuario> [rol]`                | Crea un usuario (viewer, director o admin) en Postgres.                                                                                                                                                                                                                                                                       |
| `pnpm test:e2e`                                   | Smoke tests de la interfaz con Playwright (escritorio y 375 px), con su propio servidor mock.                                                                                                                                                                                                                                 |
| `pnpm interview [--advance horas]`                | Entrevista a cada agente con una batería fija de preguntas y guarda las respuestas en `interviews/`. Sirve como test de regresión de la memoria.                                                                                                                                                                              |
| `pnpm --filter @lethetown/server sim:text 16`     | Simulación en modo texto, sin servidor: 16 horas de juego con eventos y costes.                                                                                                                                                                                                                                               |
| `pnpm --filter @lethetown/server cost:report 48`  | Llamadas y tokens por tarea en 48 h de mock reproducible (tabla Markdown) y espera media de las respuestas.                                                                                                                                                                                                                   |
| `pnpm --filter @lethetown/server latency:probe`   | Prueba corta en tiempo real con el proveedor de `.env`: espera entre mensajes (s reales) y espera en la cola del LLM por tarea.                                                                                                                                                                                               |
| `pnpm --filter @lethetown/server record <dir>`    | Con `pnpm dev` en marcha, graba una partida (mensajes del WebSocket y estado de los agentes); `world:export <dir>` vuelca la BD del mundo.                                                                                                                                                                                    |
| `pnpm replay:pack <dir> [--out f.replay.json.gz]` | Empaqueta una partida grabada (y su `world:export`) para verla en `/replay`, sin servidor ni coste.                                                                                                                                                                                                                           |
| `pnpm replay:moments <dir> [<otro dir>]`          | Momentos destacados (candidatos a clip) y arcos largos en `moments.md` y `moments.json`; con dos semillas, cómo acabó en cada una la misma intención o meta.                                                                                                                                                                  |
| `pnpm replay:scenes`                              | Comprueba las escenas de `docs/videos/escenas.json` contra sus paquetes (la frase y el minuto).                                                                                                                                                                                                                               |
| `pnpm study:analyze <dir> [<otro dir>]`           | Analiza una partida grabada (o compara dos): `analysis.json` y `analysis.md` con coste, espera, frases, intenciones, acciones, red y memoria.                                                                                                                                                                                 |
| `pnpm seeds:derive <tipo> [--write]`              | Propone datos de las semillas de `seeds/agents.json` (las del repo están revisadas a mano): `personality` (Big Five y perfil de memoria), `knowledge` (estudios, oficio, idiomas, viajes, intereses), `goals` (meta vital y proyectos medibles), `skills` (niveles de partida por oficio, intereses, idiomas y edad) o `all`. |
| `pnpm db:generate`                                | Genera una migración de Drizzle tras cambiar el esquema.                                                                                                                                                                                                                                                                      |

`SIM_SEED` en `.env` fija el azar de la memoria (rumores, reconsolidación…) para tener simulaciones reproducibles. El test dorado (`apps/server/src/sim/golden.test.ts`) compara 3 días de simulación en mock con una línea de tiempo guardada.

`SIM_DEMO=on` activa el **modo demostración**: cada `SIM_DEMO_EVERY_MINUTES` minutos de juego (de media) llueve o sale el sol, se avería un objeto de un lugar público (y luego se arregla) o un vecino tiene una ocurrencia de la voz interior. Con el proveedor mock sirve para ver reacciones, rumores y confidencias sin intervenir.

Con `TEST_DATABASE_URL` se ejecutan también los tests de integración con Postgres (la CI levanta uno).

## Embeddings sin red

En linux/x64, el `postinstall` de onnxruntime-node descargaría de NuGet los binarios CUDA; está
desactivado (`pnpm.neverBuiltDependencies`) porque los de CPU vienen en el paquete. Si aun así el
modelo no carga (p. ej. sin red la primera vez, para descargarlo), el servidor cae solo a
`EMBEDDINGS=hash`. Los embeddings locales se calculan en un `worker_thread`.

## API

Todas las rutas de un mundo cuelgan de `/api/worlds/:worldId/…`; `/api/…` es un alias del mundo
`default`. 👁 = público, 🎬 = director, 🔑 = admin.

| Método  | Ruta (dentro del mundo)                             | Descripción                                                        |
| ------- | --------------------------------------------------- | ------------------------------------------------------------------ |
| 👁 GET   | `/state` · `/map`                                   | Estado del mundo (con su estado de pausa) y mapa `.tmj`.           |
| 👁 GET   | `/agents/:id/memory?q=&limit=&offset=`              | Jardín de recuerdos paginado (sin embeddings), auditoría y fichas. |
| 👁 GET   | `/rashomon/:eventId`                                | Versiones de un evento según cada implicado, con historial.        |
| 👁 GET   | `/agents/:id/relationships?q=&type=&limit=&offset=` | Relaciones con la recíproca y su tendencia, y quién no conoce.     |
| 👁 GET   | `/agents/:id/relationships/:other/history`          | Evolución de una relación en los dos sentidos.                     |
| 👁 GET   | `/social/graph` · `/social/history?since=&limit=`   | Red del pueblo ahora y su historial (paginado).                    |
| 👁 GET   | `/events?day=` · `?from=&to=`                       | Línea de tiempo.                                                   |
| 👁 GET   | `/dramas?limit=` · `/chronicles`                    | Feed de dramas y crónicas.                                         |
| 👁 GET   | `/agents/:id/commitments?limit=`                    | Agenda: citas del agente y cómo acabaron.                          |
| 👁 GET   | `/agents/:id/inventory` · `/agents/:id/places`      | Inventario (con préstamos) y lugares que conoce.                   |
| 👁 GET   | `/notes`                                            | Notas vivas (tablón y privadas).                                   |
| 👁 GET   | `/agents/:id/goals` · `/departures`                 | Metas del agente (con su historial) y vecinos que se fueron.       |
| 🎬 POST | `/agents/:id/thought`                               | Voz interior `{ text }` (moderada).                                |
| 🎬 POST | `/world/spots/:id` · `/world/weather`               | Estado de un objeto `{ state }` (moderado) y clima.                |
| 🎬 POST | `/speed` · `/pause` · `/resume`                     | Velocidad (0, 1, 10, 60, 360) y pausa.                             |
| 🎬 POST | `/chronicles/:day`                                  | Genera ya la crónica de un día.                                    |
| 🔑 GET  | `/costs`                                            | Costes acumulados.                                                 |

| Método      | Ruta general                                            | Descripción                                                                                                                             |
| ----------- | ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| 👁 GET       | `/api/health` · `/api/worlds`                           | Health mínimo y lista de mundos.                                                                                                        |
| 👁 POST      | `/api/auth/login` · `/api/auth/logout` · GET `/me`      | Sesión por cookie.                                                                                                                      |
| 🔑 GET      | `/api/admin/health` · `/api/admin/budget`               | Health detallado (leases, cola LLM, breaker) y gasto.                                                                                   |
| 🔑 POST     | `/api/admin/kill` `{ on }`                              | Kill switch.                                                                                                                            |
| 🔑 GET/POST | `/api/admin/worlds` · `/:id/status` · `/:id/moderation` | Gestión de mundos (crear con `language`) y textos rechazados.                                                                           |
| 🔑 GET      | `/metrics`                                              | Prometheus (o `Authorization: Bearer METRICS_TOKEN`).                                                                                   |
| WS          | `/ws?world=`                                            | `snapshot` al conectar y luego `delta`, `event`, `drama`, `thinking`, `memory_effect`, `chronicle`, `world`, `status` y (admin) `cost`. |

## Cambiar de proveedor

En `.env`:

```bash
LLM_PROVIDER=anthropic        # o openai, o mock
ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_MODEL_FAST=claude-haiku-5-5
ANTHROPIC_MODEL_REFLECTION=claude-sonnet-5-5
OPENAI_MODEL_FAST=gpt-6-luna
OPENAI_MODEL_REFLECTION=gpt-6-sol
LLM_CONCURRENCY=8
```

- **Anthropic**: Messages API con `cache_control` en el prompt de sistema y `output_config.effort`. En Sonnet 5.5 se activa el fallback del lado servidor (`fallbacks: "default"`).
- **OpenAI**: Responses API con `reasoning.effort` y `prompt_cache_key` por agente.

Antes de dejarlo corriendo, empieza en pausa (`SIM_SPEED=0`) y mira el contador de coste. Con la memoria humana activa hay unas 2.000 llamadas por día de juego con los 20 agentes (la mayoría con el modelo `fast`): el servidor no limita el gasto, así que controla el saldo de la API key antes de usar un proveedor real.
