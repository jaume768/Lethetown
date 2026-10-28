# PROGRESS — feat/produccion

Preparar Lethetown para producción: seguridad, escalabilidad e interfaz. Si la sesión se corta,
retomar desde el primer elemento sin marcar. Tras cada paso: `pnpm typecheck && pnpm lint &&
pnpm test` y comprobar que `pnpm dev` arranca en modo mock.

## Checklist

### Paso 0 — Assets y licencias

- [x] Inventario de zips y `apps/web/public/assets/vendor/LICENSES.md` (ignorado)
- [x] `license` en el manifest + `pnpm assets:check` + aviso en modo Director
- [x] Personajes de Modern Exteriors documentados (no se cambian)
- [ ] Modern User Interface en el manifest (con fallback)
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

- [ ] Procesos `api` y `sim-worker` con leases en Postgres
- [ ] Pausa/LOD sin espectadores
- [ ] Deltas por WS
- [ ] pgvector filtrado (iterative scans) + inspector paginado sin embedding
- [ ] Refuerzos en lote + transacciones
- [ ] LLM: timeouts, reintentos, circuit breaker, Batch API
- [ ] Embeddings en worker_threads
- [ ] Observabilidad: pino, Sentry opcional, métricas Prometheus
- [ ] Refactor de simulation.ts + test dorado de 3 días
- [ ] Dockerfiles, docker-compose.prod.yml con Caddy, guía de despliegue

### Paso 4 — Interfaz

- [ ] Responsive + gestos táctiles
- [ ] Modos Espectador / Director / Overlay
- [ ] Feed de dramas con "Ir a verlo"
- [ ] Crear clip 9:16, exportar Rashomon, enlaces permanentes
- [ ] Tipografía legible para textos largos
- [ ] Etiquetas de nombre sin solapes
- [ ] Rediseño con Modern UI
- [ ] Onboarding de 3 pasos
- [ ] Estados de conexión/carga; pantalla de pausa por presupuesto
- [ ] Accesibilidad
- [ ] i18n (es/en) e idioma de los prompts por mundo
- [ ] Smoke tests con Playwright

### Final

- [ ] README, CLAUDE.md, este archivo
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
