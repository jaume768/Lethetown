# Lethetown — convenciones del proyecto

Juego de navegador con agentes LLM y memoria de tipo humano (Park et al. 2023 + olvido, vaguedad, refuerzo). Monorepo pnpm, TypeScript estricto.

## Estructura y límites

- `packages/shared`: esquemas **zod**, la única fuente de verdad de los mensajes cliente↔servidor. Si cambias un mensaje, cámbialo aquí primero.
- `packages/agent-core`: **lógica pura**. No hace I/O de red ni accede a la base de datos, y no importa nada de `apps/*`. Todo llega por inyección (`LLMProvider`, `MemoryStore`, `Embedder`). Excepción: los SDKs de Anthropic y OpenAI viven aquí como implementaciones de `LLMProvider`, y solo se usan si el servidor los instancia.
- `apps/server`: simulación, reloj, base de datos, embeddings y **todas** las llamadas al LLM. Las API keys solo se leen aquí, desde `.env`.
- `apps/web`: Phaser para el mapa y React solo para los paneles. Nunca llama a un LLM y solo habla con el servidor (`/api`, `/ws`).

## Reglas

- **Tiempo**: todo el tiempo de simulación va en **minutos de juego** (`number`) desde el día 0 a las 00:00. Nada de `Date` en la lógica de agentes.
- **Prompt caching**: `Agent.system` (de `identityPrompt`) no puede contener nada variable (hora, estado, ánimo). Lo variable va en el prompt de usuario.
- **Formato de respuesta del LLM**: un único objeto JSON, que se parsea con `parseWith(schema, text)` y un esquema zod de `agent/parse.ts`. Si el parseo falla, el agente sigue con un comportamiento por defecto (seguir el plan) y nunca rompe el tick.
- **MockProvider**: si cambias un prompt en `agent/prompts.ts`, actualiza `agent/mock-responder.ts`, que lee esos mismos prompts. El modo mock tiene que seguir funcionando sin red.
- **Ahorro de LLM**: las rutinas triviales (dormir, desplazarse, seguir el plan sin novedades) no llaman al LLM. Las tareas se etiquetan `fast` o `reflection` y el `ModelRouter` elige el modelo.
- **Costes**: todo pasa por `LLMClient.run`, que registra en `CostTracker`. Los precios están en `config/pricing.json` (USD por millón de tokens). `usage.inputTokens` es siempre la entrada **no cacheada**.
- **Modelos**: los IDs por defecto están en `.env.example` y `config.ts`. No inventes IDs ni la forma de las llamadas: compruébalos en la documentación oficial antes de cambiarlos.
- **Base de datos**: Drizzle (`apps/server/src/db/schema.ts`). Tras cambiar el esquema, ejecuta `pnpm db:generate` y haz commit de la migración. La dimensión de los embeddings es 384 (`EMBEDDING_DIM`). Si cambias de modelo de embeddings, la dimensión tiene que coincidir.
- **Fase 2**: las interfaces de `memory/future.ts` son contratos. Implementa detrás de ellas, sin cambiar las firmas sin motivo.

## Comandos

- `pnpm dev`: servidor y web. Funciona sin Postgres (almacén en RAM) y sin API keys (`LLM_PROVIDER=mock`).
- `pnpm test`, `pnpm lint`, `pnpm typecheck` y `pnpm format:check` deben pasar antes de cada commit (es lo que ejecuta la CI).
- `pnpm --filter @lethetown/server sim:text <horas>`: simulación determinista en texto, útil para depurar sin navegador.
- Postgres de docker-compose: puerto **5433** del host.

## Estilo

- Comentarios y textos de UI en español. Identificadores en inglés.
- Prettier (ancho 100, comillas dobles) y ESLint con `consistent-type-imports`.
- Tests con Vitest junto a la lógica: `packages/agent-core/src/__tests__/` y `*.test.ts` en el servidor.
- Commits pequeños, en español y con prefijo convencional (`feat(agent-core): …`, `fix(server): …`).
