# Lethetown — convenciones del proyecto

Juego de navegador con agentes LLM y memoria de tipo humano (Park et al. 2023 + olvido, vaguedad, refuerzo). Monorepo pnpm, TypeScript estricto.

## Estructura y límites

- `packages/shared`: esquemas **zod**, la única fuente de verdad de los mensajes cliente↔servidor. Si cambias un mensaje, cámbialo aquí primero.
- `packages/agent-core`: **lógica pura**. No hace I/O de red ni accede a la base de datos, y no importa nada de `apps/*`. Todo llega por inyección (`LLMProvider`, `MemoryStore`, `Embedder`). Excepción: los SDKs de Anthropic y OpenAI viven aquí como implementaciones de `LLMProvider`, y solo se usan si el servidor los instancia.
- `apps/server`: simulación, reloj, base de datos, embeddings y **todas** las llamadas al LLM. Las API keys solo se leen aquí, desde `.env`.
- `apps/web`: Phaser 4 para el mapa y React solo para los paneles. Nunca llama a un LLM y solo habla con el servidor (`/api`, `/ws`). La lógica no visual (elegir frame, emote, luz ambiente, recolorear, interpolar posición) vive en `packages/shared` con tests; `apps/web/src/game` solo pinta.

## Reglas

- **Tiempo**: todo el tiempo de simulación va en **minutos de juego** (`number`) desde el día 0 a las 00:00. Nada de `Date` en la lógica de agentes.
- **Prompt caching**: `Agent.system` (de `identityPrompt`) no puede contener nada variable (hora, estado, ánimo). Lo variable va en el prompt de usuario.
- **Formato de respuesta del LLM**: un único objeto JSON, que se parsea con `parseWith(schema, text)` y un esquema zod de `agent/parse.ts`. Si el parseo falla, el agente sigue con un comportamiento por defecto (seguir el plan) y nunca rompe el tick.
- **MockProvider**: si cambias un prompt (`agent/prompts.ts`, `memory/human.ts`, `agent/chronicle.ts`, `agent/interview.ts`), actualiza `agent/mock-responder.ts`, que lee esos mismos prompts (un handler por `task`). El modo mock tiene que seguir funcionando sin red.
- **Ahorro de LLM**: las rutinas triviales (dormir, desplazarse, seguir el plan sin novedades) no llaman al LLM. Las tareas se etiquetan `fast` o `reflection` y el `ModelRouter` elige el modelo.
- **Costes**: todo pasa por `LLMClient.run`, que registra en `CostTracker`. Los precios están en `config/pricing.json` (USD por millón de tokens). `usage.inputTokens` es siempre la entrada **no cacheada**.
- **Modelos**: los IDs por defecto están en `.env.example` y `config.ts`. No inventes IDs ni la forma de las llamadas: compruébalos en la documentación oficial antes de cambiarlos.
- **Base de datos**: Drizzle (`apps/server/src/db/schema.ts`). Tras cambiar el esquema, ejecuta `pnpm db:generate` y haz commit de la migración. La dimensión de los embeddings es 384 (`EMBEDDING_DIM`). Si cambias de modelo de embeddings, la dimensión tiene que coincidir.
- **Memoria humana**: interfaces e implementaciones en `memory/human.ts` (consolidación, esencia, reconsolidación, confusión de fuente, fichas sociales, resumen de episodios) y `memory/maintenance.ts` (olvido marcado, esencia, fuente y presupuesto). Todo parámetro nuevo va en `memory/config.ts`, con valor por defecto y un comentario que explique sus unidades. Cada decisión de olvido o transformación se registra con `memory.audit(...)` y un motivo legible ("olvidó X porque…").
- **Azar**: siempre a través del `Rng` inyectado (`seededRng`), nunca `Math.random()` en agent-core ni en la simulación. Así los tests y `SIM_SEED` son reproducibles. Excepción: efectos puramente visuales del cliente.
- **Eventos**: `Simulation.emit()` persiste el evento (línea de tiempo) y lo envía por WS. Las conversaciones usan su id como `eventId` de los recuerdos (vista Rashomon); las frases tienen id `<conversación>:<turno>`.
- **Mapa**: `seeds/town.tmj` es la fuente de verdad del mundo y se genera con `pnpm map:generate` a partir de los sellos del pack. Si cambias el trazado, edita `tools/generate-map.ts`; si cambias un sello, edita el manifest. Los spots tienen que estar sobre baldosas transitables (el parser lo comprueba) y ser alcanzables (lo comprueba un test).
- **Assets**: nada de `apps/web/public/assets/vendor/` va al repo (licencia LimeZu). Comprueba siempre con `git check-ignore`. Los packs nuevos deben definir todos los `REQUIRED_STAMPS`. El cliente elige el pack por la propiedad `assetPack` del `.tmj`. Emotes, bocadillo y halos son pixel art propio en `apps/web/src/game/pixelArt.ts`.

## Comandos

- `pnpm dev`: servidor y web. Funciona sin Postgres (almacén en RAM) y sin API keys (`LLM_PROVIDER=mock`).
- `pnpm test`, `pnpm lint`, `pnpm typecheck` y `pnpm format:check` deben pasar antes de cada commit (es lo que ejecuta la CI).
- `pnpm --filter @lethetown/server sim:text <horas>`: simulación determinista en texto, útil para depurar sin navegador (con `SIM_SEED=7 EMBEDDINGS=hash DATABASE_URL=` es reproducible).
- `pnpm interview [--advance h]`: entrevistas de regresión de la memoria (resultado en `interviews/`, ignorado en git).
- `pnpm map:generate [--pack x]` y `pnpm assets:placeholder`.
- Postgres de docker-compose: puerto **5433** del host.

## Estilo

- Comentarios y textos de UI en español. Identificadores en inglés.
- Prettier (ancho 100, comillas dobles) y ESLint con `consistent-type-imports`.
- Tests con Vitest junto a la lógica: `packages/agent-core/src/__tests__/` y `*.test.ts` en el servidor.
- Commits pequeños, en español y con prefijo convencional (`feat(agent-core): …`, `fix(server): …`).
