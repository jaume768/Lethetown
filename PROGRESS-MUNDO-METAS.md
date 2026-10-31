# Mundo (1996) y metas (fases 1 y 2): progreso

Rama `feat/mundo-y-metas`. Objetivo: un mundo coherente (un pueblo inventado del interior de
Mallorca en 1996) con lo que sabe cada vecino, y metas vitales medibles por el motor que den
trayectoria a cada uno. Al retomar, leer esto primero.

Cada paso: `corepack pnpm -r typecheck && corepack pnpm lint && prettier --check --end-of-line
auto . && corepack pnpm test` (mirando el código de salida) y `pnpm dev` en mock. En esta máquina
pnpm va por `corepack pnpm` (no está en el PATH: `pnpm typecheck` falla porque llama a `pnpm -r`).

## Checklist

### Fase 1 — El mundo y lo que saben

- [ ] 1.1 Biblia del mundo (`config/world.json`, zod), sistema `world` (prompt fijo, fecha en el plan, clima)
- [ ] 1.2 Semillas, clima, mock y prompts revisados para 1996
- [ ] 1.3 Perfil de conocimiento (`knowledge`), `tools/derive-knowledge.ts`, regla del prompt, aprender de otros
- [ ] 1.4 `ExternalKnowledgeGuard` (solo registrar), tabla `knowledge_log`, métricas

### Fase 2 — Ambición (metas)

- [ ] 2.1 Modelo de metas: sistema `goals`, tabla `goals`, catálogo de criterios medibles
- [ ] 2.2 Metas iniciales (`tools/derive-goals.ts`, revisadas a mano)
- [ ] 2.3 Plan, decisión, consolidación nocturna, psicología y conflictos
- [ ] 2.4 Marcharse del pueblo (ausentes, visitas)
- [ ] 2.5 Interfaz: pestaña «Metas», dramas, «Evolución», vecinos que se fueron

### Final

- [ ] README, CLAUDE.md, docs/decisiones (mundo.md, metas.md), coste antes/después
- [ ] `pnpm interview --advance 48` antes y después (Inés, Mateo, Aurora)
- [ ] Comandos de la partida real corta de validación
- [ ] Push y PR

## Coste (`cost:report 48`, mock, SIM_SEED=7)

| Etapa                     | Llamadas | decide | social | plan | consolidate | Entrada no cacheada |   ≈ $ |
| ------------------------- | -------: | -----: | -----: | ---: | ----------: | ------------------: | ----: |
| `main` (antes de empezar) |    3.791 |  1.362 |    625 |   40 |          40 |           1.434.434 | 0,654 |

## Decisiones (para revisar en la PR)

### Arquitectura

- Todo lo nuevo es un `SimSystem`: `world` (biblia, fecha, clima), `knowledge` (registro de
  anacronismos y referencias externas; aprender de otros), `goals` (metas, psicología,
  conflictos, marcharse y volver de visita).
- Tres ganchos nuevos en `SimSystem`, genéricos (los usarán economía, oficios o el ciclo vital):
  `planSections` (secciones del prompt del plan), `consolidation` (una sección y un campo de la
  respuesta de la consolidación nocturna: misma llamada) y `holds` (el agente no está en el
  pueblo: no vive ni piensa). `simulation.ts` solo gana la comprobación de `holds` junto a la de
  `travelling`.
