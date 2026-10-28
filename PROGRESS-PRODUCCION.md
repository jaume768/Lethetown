# PROGRESS — feat/produccion

Preparar Lethetown para producción: seguridad, escalabilidad e interfaz. Si la sesión se corta,
retomar desde el primer elemento sin marcar. Tras cada paso: `pnpm typecheck && pnpm lint &&
pnpm test` y comprobar que `pnpm dev` arranca en modo mock.

## Checklist

### Paso 0 — Assets y licencias

- [x] Inventario de zips y `apps/web/public/assets/vendor/LICENSES.md` (ignorado)
- [x] `license` en el manifest + `pnpm assets:check` + aviso en modo Director
- [x] Personajes de Modern Exteriors documentados (no se cambian)
- [x] Modern User Interface en el manifest (con fallback)
- [x] Portrait Generator: `tools/compose-portraits.ts`, recetas en `seeds/agents.json`, retrato en inspector y bocadillos
- [x] Créditos en la UI
- [x] Confirmar `git check-ignore` / `git status`

### Paso 1 — Multi-mundo y persistencia

- [x] Tabla `worlds` + `world_id` en todas las tablas (migración con mundo por defecto)
- [x] Claves de agente únicas por mundo; API `/api/worlds/:worldId/...` (+ alias)
- [x] `world_snapshots`: instantáneas periódicas y al apagar; restaurar al arrancar; test de ida y vuelta

### Paso 2 — Seguridad

- [x] Usuarios, roles (viewer/director/admin), sesiones con cookie, argon2, `pnpm user:create`
- [x] Autorización en REST y WS + tests
- [x] Rate limiting
- [x] Presupuesto diario/mensual por mundo y global, pausa automática, kill switch + tests
- [x] Moderación y anti-inyección del texto del usuario
- [x] WebSocket: Origin, maxPayload, heartbeat, límite por IP
- [x] helmet, CORS, límites de body, errores sin detalles
- [x] docker-compose en 127.0.0.1 con credenciales de .env; `.env.example`
- [x] CodeQL, Dependabot, fallback de onnxruntime sin red

### Paso 3 — Escalabilidad y robustez

- [x] Procesos `api` y `sim-worker` con leases en Postgres
- [x] Pausa/LOD sin espectadores
- [x] Deltas por WS
- [x] pgvector filtrado (iterative scans) + inspector paginado sin embedding
- [x] Refuerzos en lote + transacciones
- [x] LLM: timeouts, reintentos, circuit breaker, Batch API
- [x] Embeddings en worker_threads
- [x] Observabilidad: pino, Sentry opcional, métricas Prometheus
- [x] Refactor de simulation.ts + test dorado de 3 días
- [x] Dockerfiles, docker-compose.prod.yml con Caddy, guía de despliegue

### Paso 4 — Interfaz

- [x] Responsive + gestos táctiles
- [x] Modos Espectador / Director / Overlay
- [x] Feed de dramas con "Ir a verlo"
- [x] Crear clip 9:16, exportar Rashomon, enlaces permanentes
- [x] Tipografía legible para textos largos
- [x] Etiquetas de nombre sin solapes
- [x] Rediseño con Modern UI
- [x] Onboarding de 3 pasos
- [x] Estados de conexión/carga; pantalla de pausa por presupuesto
- [x] Accesibilidad
- [x] i18n (es/en) e idioma de los prompts por mundo
- [x] Smoke tests con Playwright

### Final

- [x] README, CLAUDE.md, este archivo
- [ ] Push y PR

## Decisiones tomadas

- **Portrait Generator**: viene incluido con Modern User Interface y se rige por su licencia
  (uso comercial sí, crédito obligatorio). Solo se extraen las capas PNG, no el ejecutable.
- **Piel de UI recortada en el cliente**: la hoja de Modern UI se recorta en un canvas a data
  URLs y se publica como variables CSS (`--ui-panel`…) bajo `html.ui-skin`. Así no hay que
  generar ni desplegar archivos derivados de vendor; sin la hoja, la UI usa su CSS propio.
- **Retratos por código**: el Portrait Generator trae las capas en PNG, así que
  `pnpm portraits:compose` las apila según la receta de `seeds/agents.json` (dos tamaños:
  64 px para la UI y 32 px para el mapa). El resultado se queda en vendor (ignorado).
- **El aviso de assets no comerciales** se calcula en el cliente con `assetsInUse` (los mismos
  datos que `pnpm assets:check`), y solo se mostrará en modo Director.
- **Mundos sin cambiar agent-core**: cada mundo tiene sus propias instancias de los stores con
  su `worldId` (Pg filtra todas las consultas por `world_id`), así que las interfaces de
  agent-core no cambian. Los ids de agente (`lucia`…) se repiten entre mundos: la unicidad es
  (world_id, agent_id), y las claves primarias de `social_profiles` y `chronicles` la incluyen.
- **La API habla con un `WorldGateway`**, no con la simulación: hoy `LocalWorldGateway` (mismo
  proceso). En el Paso 3 el proceso `api` usará una implementación remota (BD + bus) con las
  mismas rutas. Las mutaciones son `WorldCommand` (thought, spot, weather, speed, chronicle).
- **Alias**: `/api/...` y `/ws` sin `?world=` apuntan al mundo `default`. El cliente usa ya
  `/api/worlds/<id>/...` (parámetro `?world=` de la URL).
- **Instantáneas**: la foto es síncrona (no frena el reloj ni cambia el orden de eventos: el
  test dorado no cambió) y la escritura va en segundo plano. Se guardan cada hora de juego y al
  apagar; se conservan 48 por mundo. Las llegadas de los viajes se guardan (`arrival`) y se
  reprograman al restaurar. Una instantánea de otra versión se ignora (arranque limpio).
- **Test dorado antes del refactor**: `apps/server/src/sim/golden.test.ts` fija la línea de
  tiempo de 3 días en mock (SIM_SEED=7). Se creó antes de tocar la simulación.
- **Sesiones propias con cookie** (no JWT): token aleatorio de 32 bytes en una cookie
  httpOnly + SameSite=Lax (+ Secure en producción); en la BD solo su SHA-256. Se pueden revocar
  borrando la fila. Contraseñas con argon2id (parámetros OWASP) vía `@node-rs/argon2`
  (binarios precompilados, sin node-gyp). La tabla `users` ya tiene `provider` +
  `provider_subject` para OAuth (`UserStore.findOrCreateOAuth`).
- **CSRF**: SameSite=Lax y, además, toda petición que no es GET exige un `Origin` de la lista
  `ALLOWED_ORIGINS` (si lo trae; sin Origin = cliente no navegador).
- **Costes = admin**: `/costs` y los mensajes `cost` del WS solo para admin (el director ve la
  intervención; el espectador nada de costes).
- **Presupuesto**: `BudgetGuard` suma lo de hoy/este mes (UTC) desde `llm_calls` al arrancar y
  cada `CostTracker.record` después. Bloquea en dos sitios: pausa el mundo (velocidad 0, evento
  y mensaje `status`) y `BudgetedProvider` rechaza cualquier llamada al LLM del mundo
  bloqueado. Reanudar falla (409) mientras siga superado. Kill switch global para admin.
- **Moderación dentro de la orden**: sanear + moderar ocurre en `vetUserText` del mundo (quien
  tiene el LLM y el presupuesto), no en la ruta. Si la moderación falla o no hay presupuesto,
  el texto se rechaza (fail-closed). Los rechazos van a `moderation_log`.
- **Anti-inyección**: el texto del usuario va entre `⟦ ⟧` (se eliminan de la entrada para que
  no pueda cerrar el bloque) y el prompt fijo del agente dice que es un dato, no una orden.
  Esto cambió el prompt de sistema, así que el test dorado se regeneró a propósito.
- **onnxruntime-node**: en linux/x64 su postinstall descarga de NuGet los binarios CUDA (y
  sin red falla la instalación). Los de CPU vienen en el paquete, así que se excluye con
  `pnpm.neverBuiltDependencies`. Si aun así no cargan, el servidor cae solo a `EMBEDDINGS=hash`.
- **`DEV_ADMIN_PASSWORD`**: en RAM (sin Postgres) no hay `user:create`; esta variable crea un
  admin en memoria, y se ignora en producción.
- **Bus = LISTEN/NOTIFY de Postgres** (no pg-boss): no añade dependencias ni procesos, y los
  mensajes son efímeros (estado vivo, señales, órdenes con respuesta y timeout). pg-boss aporta
  colas persistentes y reintentos que aquí no hacen falta. Los mensajes de más de ~7 KB van a
  `bus_messages` y se notifica el id (NOTIFY admite ~8000 bytes).
- **Leases en tabla** (`world_leases`, TTL 20 s renovado cada 5 s) en vez de advisory locks:
  se ven en `/api/admin/worlds` y sobreviven a reconexiones del pool. Reclamar es un
  `INSERT … ON CONFLICT … DO UPDATE … WHERE expires_at < now()`, atómico.
- **El api no ejecuta simulación**: lee memoria/eventos/crónicas de Postgres, calcula el
  inspector con su propio embedder y recibe el estado vivo por el bus. Sin Postgres, `pnpm dev`
  arranca el api en modo todo en uno y el worker sale (no hay leases sin BD).
- **Presupuesto global con varios workers**: cada worker suma lo suyo en memoria y recarga los
  totales de `llm_calls` cada 30 s, así que el exceso posible es ~30 s de gasto de los demás.
- **LOD sin espectadores** (por defecto): los agentes piensan cada `SIM_TICK_MINUTES ×
LOD_TICK_FACTOR`; `NO_VIEWERS_MODE=pause` los detiene del todo (recomendado en producción).
- **Deltas por WS**: reloj + agentes cambiados respecto al último envío del canal; al conectar
  un cliente, primero se manda un delta a los demás para que todos compartan la base del
  snapshot.
- **Batch API solo para Anthropic** (OpenAI pide subir un JSONL a Files): se usa para
  `consolidate` y `chronicle` si ningún mundo va más rápido que `LLM_BATCH_MAX_SPEED` (a x10
  una noche de juego dura ~54 min reales); si tarda más de `LLM_BATCH_MAX_WAIT_MINUTES`, se
  repite por la vía normal.
- **tsx en producción**: los paquetes del monorepo se consumen como TypeScript; compilar a JS
  obligaría a cambiar `main` de shared/agent-core. El coste es ~1 s más de arranque.
- **Iterative scans**: `SET LOCAL hnsw.iterative_scan = relaxed_order` en una transacción
  corta por consulta. pgvector 0.8.7 en la imagen `pgvector/pgvector:pg16`.
- **Dramas fuera de la línea de tiempo**: el `DramaDetector` solo observa (eventos, efectos de
  memoria y cambios de afinidad) y guarda en su propia tabla, así el test dorado no cambia. La
  puntuación (pura) está en `shared/schemas/drama.ts`.
- **«Ir a verlo»** lleva la cámara al lugar y selecciona al primer implicado; no hay viaje en el
  tiempo (el mundo es en vivo): para el pasado están Rashomon y el historial.
- **Idioma de los prompts**: los prompts siguen en español y, si el mundo es `en`, se añade una
  regla al prompt fijo para que el modelo responda en inglés (cacheable, por mundo). Traducir
  todos los prompts (y el mock, que los lee) queda para después.
- **Clips en el navegador**: el lienzo de Phaser (con `preserveDrawingBuffer`) se recorta al
  centro en 9:16 y se graba con MediaRecorder en WebM; no pasa nada por el servidor.
- **Piel de Modern UI** con `border-image` sobre las piezas recortadas; colores de texto
  oscuros bajo `html.ui-skin` para mantener el contraste sobre el pergamino claro.
- **Etiquetas de nombre**: ya solo aparecen al seleccionar o con el ratón encima; además se
  recolocan si dos visibles chocan.
- **El WS se reconecta al iniciar o cerrar sesión** (la cookie viaja en el upgrade): así un
  admin recibe los mensajes de coste sin recargar.
