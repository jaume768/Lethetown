# Lethetown — convenciones del proyecto

Juego de navegador con agentes LLM, memoria de tipo humano y psicología. Monorepo pnpm,
TypeScript estricto. El porqué de cada decisión está en [docs/decisiones/](docs/decisiones/README.md).

## Estructura y límites

- `packages/shared`: esquemas **zod** (única fuente de verdad de los mensajes) y lógica no visual del
  cliente con tests (frames, emotes, luz, red de relaciones). Si cambias un mensaje, empieza aquí.
- `packages/agent-core`: **lógica pura**, sin red ni BD ni imports de `apps/*`; todo por inyección
  (`LLMProvider`, `MemoryStore`, `Embedder`). `Agent` es una fachada sobre `agent/agent-*.ts`.
- `apps/server`: simulación, reloj, BD, embeddings y **todas** las llamadas al LLM (las API keys solo
  aquí). Entradas: `api-main.ts`, `worker.ts`, `index.ts` (todo en uno). Arranque en `factories/`.
  La API habla con un `WorldGateway`; toda mutación es un `WorldCommand` (`runCommand`).
- `apps/web`: Phaser solo pinta; React para los paneles; nunca llama a un LLM.

## Reglas

- **Tiempo** en minutos de juego (`number`); nada de `Date` en la lógica de agentes.
- **Prompt fijo** (`identityPrompt`) sin nada variable (caching); lo variable, en el prompt de usuario.
- **Respuesta del LLM**: un único JSON con `parseWith(schema, text)`; si falla, comportamiento por
  defecto sin romper el tick. Todo pasa por `LLMClient.run` (coste y presupuesto).
- **Mock declarativo** (`agent/mock/`): si cambias un prompt, actualiza su respondedor; las reglas de
  `decide` se registran con `registerDecideRule`. El modo mock tiene que funcionar sin red.
- **Modelos**: no inventes IDs ni formas de llamada; compruébalos en la documentación oficial.
- **Protección de menores (prioritaria)**: todo texto del LLM que entra en el mundo pasa por
  `MinorGuard` (`memory.tryRemember`, `guard.allows`); nada romántico con un menor; las citas e
  invitaciones de adultos con menores, solo en lugares públicos. Ver [menores](docs/decisiones/menores.md).
- **Psicología y memoria**: lógica pura en agent-core; todo parámetro en `MemoryConfig` con valor
  por defecto y unidades; nada de lógica psicológica en prompts si se puede calcular. Cada olvido o
  transformación, con `memory.audit(...)` y motivo legible. Fichas sociales con `applySocialUpdate`.
- **Acciones**: el LLM elige del catálogo (`ACTION_SPECS`, en el prompt fijo); el motor valida y
  ejecuta (`sim/actions/`, `registerAction`) y, si no puede, el agente lo percibe con el motivo.
  Cada acción: esquema en shared, manejador, regla del mock, icono en la web y tests; con alguien
  o un lugar de por medio, `minorMeetingRule`; para ir a un sitio, `mayEnter` (casas privadas y
  horarios). Pasos en [acciones](docs/decisiones/acciones.md#cómo-añadir-una-acción).
- **Ritmo y habla**: quien recibe una frase piensa al minuto (`ctx.wake`, un solo tick pendiente
  por agente); lo que se oye en una charla en curso se valora por reglas (`rateHeard`); lo que se
  dice se recorta en código (`clipText`); tareas urgentes en `URGENT_TASKS` de la cola LLM. Ver
  [ritmo](docs/decisiones/ritmo.md).
- **Azar** solo por el `Rng` inyectado (`seededRng`); nunca `Math.random()` (salvo efectos visuales).
- **Datos**: Drizzle (`db/schema.ts`); tras cambiar el esquema, `pnpm db:generate` y commit de la
  migración. Todo dato persistente lleva `world_id` y funciona también en RAM. Embeddings de 384.
- **Instantáneas**: estado nuevo del runtime o del agente → `SimSnapshot` (o `AgentMind`) y subir
  `SIM_SNAPSHOT_VERSION`.
- **Test dorado** (`sim/golden.test.ts`, 3 días en mock): un refactor no lo cambia; un cambio de
  comportamiento lo regenera con `-u` y lo explica en el commit. Ojo con añadir `await`.
- **Seguridad**: rutas que mutan o gastan con `requireRole` (y `rateLimit` si gastan); texto de
  usuario por `vetUserText` y en los prompts con `untrusted()`. Nunca loguees cookies ni cuerpos.
- **Mapa**: `seeds/town.tmj` se genera con `pnpm map:generate` (`tools/generate-map.ts` y el
  manifest); los spots, transitables y alcanzables. Normas del mapa (`private`, `hours`) ahí.
- **Assets**: nada de `apps/web/public/assets/vendor/` al repo ni a Docker (`git check-ignore`);
  todo asset del manifest con `license` y `source`. Capturas de docs sin vendor.
- **Cliente**: textos en `i18n/es.ts` y `en.ts`; accesible (rol, `aria-*`, teclado,
  `prefers-reduced-motion`); `localStorage` con try/catch.

## Comandos

- `pnpm dev` (funciona sin Postgres ni API keys) · `pnpm test:e2e` · `TEST_DATABASE_URL=… pnpm test`.
- Antes de cada commit: `pnpm typecheck && pnpm lint && pnpm format:check && pnpm test` (lo que
  ejecuta la CI). `pnpm -s typecheck` puede esconder errores de tsc: mira el código de salida.
- `pnpm --filter @lethetown/server cost:report 48` (coste reproducible y espera de respuesta) ·
  `latency:probe [min] [x]` (prueba real corta) · `record <dir>` / `world:export <dir>` (grabar
  una partida) · `sim:text <horas>` ·
  `pnpm interview [--advance h]` · `pnpm personality:derive` · `pnpm map:generate` ·
  `pnpm assets:check` · `pnpm portraits:compose` · `pnpm user:create <usuario> [rol]`.
- Postgres de docker-compose en el puerto **5433**. Retención de datos: `config/retention.json`.

## Estilo

- Comentarios y textos de UI en español; identificadores en inglés.
- Prettier (ancho 100, comillas dobles); ESLint con `consistent-type-imports`.
- Tests con Vitest junto a la lógica.
- Commits pequeños, en español y con prefijo convencional (`feat(agent-core): …`).
