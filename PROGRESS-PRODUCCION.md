# PROGRESS — feat/produccion

Preparar Lethetown para producción: seguridad, escalabilidad e interfaz. Si la sesión se corta,
retomar desde el primer elemento sin marcar. Tras cada paso: `pnpm typecheck && pnpm lint &&
pnpm test` y comprobar que `pnpm dev` arranca en modo mock.

## Checklist

### Paso 0 — Assets y licencias

- [x] Inventario de zips y `apps/web/public/assets/vendor/LICENSES.md` (ignorado)
- [ ] `license` en el manifest + `pnpm assets:check` + aviso en modo Director
- [x] Personajes de Modern Exteriors documentados (no se cambian)
- [ ] Modern User Interface en el manifest (con fallback)
- [ ] Portrait Generator: `tools/compose-portraits.ts`, recetas en `seeds/agents.json`, retrato en inspector y bocadillos
- [ ] Créditos en la UI
- [ ] Confirmar `git check-ignore` / `git status`

### Paso 1 — Multi-mundo y persistencia

- [ ] Tabla `worlds` + `world_id` en todas las tablas (migración con mundo por defecto)
- [ ] Claves de agente únicas por mundo; API `/api/worlds/:worldId/...` (+ alias)
- [ ] `world_snapshots`: instantáneas periódicas y al apagar; restaurar al arrancar; test de ida y vuelta

### Paso 2 — Seguridad

- [ ] Usuarios, roles (viewer/director/admin), sesiones con cookie, argon2, `pnpm user:create`
- [ ] Autorización en REST y WS + tests
- [ ] Rate limiting
- [ ] Presupuesto diario/mensual por mundo y global, pausa automática, kill switch + tests
- [ ] Moderación y anti-inyección del texto del usuario
- [ ] WebSocket: Origin, maxPayload, heartbeat, límite por IP
- [ ] helmet, CORS, límites de body, errores sin detalles
- [ ] docker-compose en 127.0.0.1 con credenciales de .env; `.env.example`
- [ ] CodeQL, Dependabot, fallback de onnxruntime sin red

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
