# Producción: procesos, seguridad, presupuesto y datos

- **Dos procesos**: `api` (HTTP + WS, sin simulación) y `sim-worker` (corre los mundos). Sin
  Postgres, el api corre los mundos (todo en uno) y el worker sale.
- **La API habla con un `WorldGateway`** (local o remoto por bus); toda mutación es un
  `WorldCommand` que ejecuta `runCommand` donde vive la simulación.
- **Bus = LISTEN/NOTIFY** de Postgres (sin dependencias); mensajes de más de ~7 KB en
  `bus_messages`. **Leases en tabla** (`world_leases`, TTL renovado), atómicas con `ON CONFLICT`.
- **Multi-mundo**: todo dato persistente lleva `world_id`; los stores de Postgres filtran siempre
  por él; los ids de agente se repiten entre mundos.
- **Arranque por factorías** (`apps/server/src/factories/`: LLM, memoria, seguridad, mundos,
  servicios); `bootstrap.ts` solo orquesta.
- **Sesiones propias** con cookie httpOnly + SameSite=Lax (+ Secure), solo su SHA-256 en la BD;
  argon2id; roles viewer/director/admin. Las peticiones que mutan exigen `Origin` permitido.
- **Moderación dentro de la orden** (`vetUserText` del mundo, quien tiene el LLM y el presupuesto),
  fail-closed; el texto del usuario va entre `⟦ ⟧` como dato no confiable.
- **Presupuesto** por día y mes, por mundo y global: `BudgetGuard` pausa el mundo y
  `BudgetedProvider` rechaza llamadas; kill switch para admin.
- **LOD sin espectadores**; deltas por WS en vez del estado completo.
- **Retención** (`retention.ts`, `config/retention.json`): política por tabla (días de juego o
  reales; borrar o resumir). Recuerdos olvidados o archivados 14 días de juego; auditoría y
  versiones 30; historial social 30 resumido a un cambio por pareja y día; eventos 14 (salvo
  crónicas); `llm_calls` 62 días reales resumidos por día, mundo, modelo y tarea (sin perder el
  gasto); moderación 90; bus 1; instantáneas 7 (siempre queda la última). Corre cada hora real
  (intervalo `unref`), no en el reloj de juego, para no alterar la simulación. También en RAM.
- **tsx en producción** (los paquetes se consumen como TypeScript); Docker multi-stage con Caddy.
