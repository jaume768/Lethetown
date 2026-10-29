# PROGRESS — feat/acciones

Catálogo de acciones validado por el motor (la IA decide, el motor valida y ejecuta), con un
saneamiento previo del código. Si la sesión se corta, retomar desde el primer elemento sin
marcar. Tras cada paso: `pnpm typecheck && pnpm lint && pnpm test` (mirando el código de salida)
y comprobar que `pnpm dev` arranca en modo mock.

## Checklist

### Antes de empezar

- [x] Coste de referencia (`cost:report 48`) y entrevistas de referencia (`interview --advance 48`)

### Paso 0 — Saneamiento

- [x] 0.1 `agent.ts` dividido en módulos (dorado sin cambios)
- [ ] 0.2 `mock-responder.ts` declarativo (registro de respondedores con reglas pequeñas)
- [ ] 0.3 `bootstrap.ts` en factorías por área
- [ ] 0.4 `MemoryStore.listActive(agentId, { withEmbedding })`
- [ ] 0.5 Retención de datos configurable por tabla + job + test
- [ ] 0.6 `gist.minImportance` = 4 (y medir)
- [ ] 0.7 `docs/decisiones/` (ADR breves), CLAUDE.md corto, sin PROGRESS antiguos
- [ ] 0.8 Tests unitarios de la lógica no visual de la web

### Paso 1 — Catálogo de acciones

- [ ] `AgentAction` + `ActionRegistry` en shared
- [ ] `DecideResponse` → `{ choice: "continue" | "act", action, reason }` (`do_activity`, `say`)
- [ ] Prompt con solo las acciones disponibles
- [ ] Errores → percepción "No pude …" + recuerdo; acciones en `sim_events`

### Paso 2 — Citas y compromisos

- [ ] `propose_meeting`, `accept_meeting`, `decline_meeting`, `cancel_meeting`
- [ ] Tabla `commitments` + instantánea + RAM
- [ ] Hueco en el plan (hoy) y restricción en `planDay` (mañana)
- [ ] Intenciones que se pueden olvidar; plantones, tardanzas, afinidad, dramas
- [ ] Pestaña «Agenda»

### Paso 3 — Conocer el pueblo y explorar

- [ ] `known_places` + semillas
- [ ] Prompt con lugares conocidos + visibles
- [ ] Acción `explore` y descubrimientos (también por conversación)
- [ ] Apertura → tendencia a explorar; lugares conocidos en el inspector

### Paso 4 — Conversaciones en grupo

- [ ] Grupos con turnos, unirse y marcharse; límites configurables
- [ ] Escuchas y Rashomon con grupos

### Paso 5 — Objetos e inventario

- [ ] Máquinas de estados de objetos y `use_object`
- [ ] `inventory_items` y acciones de objetos (dar, prestar, devolver, coger, dejar)
- [ ] Préstamos → intención de devolución; el libro de Carmen
- [ ] Inventario en el inspector e icono en el mapa; economía preparada

### Paso 6 — Invitar y acompañar

- [ ] `invite`, `follow` / `go_together` con ruta compartida

### Paso 7 — Notas y mensajes

- [ ] Tablón (`post_note`) y notas privadas (`leave_note`), con caducidad y moderación

### Paso 8 — Normas del mundo

- [ ] Lugares privados con dueños e invitados; intrusos
- [ ] Horarios de apertura; abrir y cerrar

### Paso 9 — Interfaz

- [ ] Inspector: Agenda, Inventario y Lugares conocidos; iconos por acción en el log y Rashomon
- [ ] Mapa: cita, acompañando, tablón
- [ ] Dramas nuevos; responsive, accesible, i18n

### Final

- [ ] README, CLAUDE.md, `docs/decisiones/`, este archivo
- [ ] Coste y entrevistas antes/después (Lucía, Carmen, Hugo)
- [ ] Push y PR

## Coste (mock, 48 h, SIM_SEED=7)

### Antes (main)

| Tarea         | Llamadas | Entrada (no cacheada) | Salida | Lectura de caché |
| ------------- | -------: | --------------------: | -----: | ---------------: |
| importance    |      963 |                113045 |  17280 |          1434852 |
| decide        |      963 |                463100 |  27932 |          1434852 |
| gist          |      847 |                 60971 |   7830 |          1260968 |
| social        |      466 |                 92814 |  13234 |           694338 |
| reconsolidate |      281 |                 48913 |   7821 |           406622 |
| plan          |       40 |                 28611 |   8253 |            41786 |
| consolidate   |       40 |                 41521 |  11257 |            59702 |
| summarize     |       10 |                  1600 |    300 |            14730 |
| chronicle     |        2 |                  3517 |    102 |               72 |
| confabulate   |        1 |                   140 |     21 |             1489 |
| **total**     |     3613 |                854232 |  94030 |          5349411 |

## Decisiones tomadas

- **`agent.ts` como fachada**: la clase `Agent` conserva su API pública; el detalle vive en
  `agent-body.ts` (ánimo, necesidades, sueño, codificación, intrusivos), `agent-planning.ts`
  (semillas, diario, hábitos, plan), `agent-perception.ts`, `agent-decision.ts`,
  `agent-intentions.ts`, `agent-social.ts` y `agent-types.ts`. Las funciones reciben el agente.
  Los métodos de la fachada devuelven la promesa sin `async` para no añadir ticks de microtareas:
  el orden de los eventos (y el test dorado) no cambia. `deps` y `spots` pasan a ser públicos
  (de solo lectura) para que los módulos los usen; `validPlace` también. La división se hizo con
  un script (sin reescribir a mano la lógica).
