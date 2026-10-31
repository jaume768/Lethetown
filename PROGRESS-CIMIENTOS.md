# Cimientos (fase 0): progreso

Rama `feat/cimientos`. Objetivo: que los sistemas nuevos (conocimiento del mundo, metas,
habilidades, economía, innovación, construcción, ciclo vital) entren como módulos sin engordar el
núcleo, y abaratar y medir. Al retomar, leer esto primero.

Cada paso: `pnpm typecheck && pnpm lint && pnpm format:check && pnpm test` (mirando el código de
salida) y `pnpm dev` en mock. En esta máquina pnpm va por `corepack pnpm` (no está en el PATH).

## Checklist

- [x] 1. Registro de sistemas (`SimSystem`) y migración sin cambiar el dorado
- [x] 2. Puente de la conversación a la acción (`agreements` en la tarea `social`)
- [ ] 3. Coste: enrutado por tarea, resumir menos, Batch API, caché larga
- [ ] 4. Habla: tope de turnos por interés, muletillas, reintento de la moderación
- [ ] 5. Métricas de evolución (pestaña) y `study:analyze`
- [ ] Final: README, CLAUDE.md, docs/decisiones, tabla de coste, PR

## Coste (`cost:report 48`, mock, SIM_SEED=7)

| Etapa                     | Llamadas | decide | social | summarize | Entrada no cacheada | Espera de respuesta |
| ------------------------- | -------: | -----: | -----: | --------: | ------------------: | ------------------: |
| `main` (antes de empezar) |    4.420 |  1.503 |    725 |       242 |           1.579.976 |   1,7 min (p90 1,0) |
| Paso 1 (sistemas)         |    4.420 |  1.503 |    725 |       242 |           1.579.976 |   1,7 min (p90 1,0) |
| Paso 2 (puente)           |    5.756 |  1.885 |    887 |       512 |           2.398.819 |   1,6 min (p90 1,0) |

## Decisiones (para revisar en la PR)

### Paso 1

- El estado de cada sistema sale de `SimContext` (`ctx.state(id, init)` + accesor tipado por
  módulo). Lo que es por agente (`Runtime.following`, `normWarned`) se queda en el runtime.
- Los sistemas migrados se definen en `sim/systems/<id>.ts`, pero su lógica sigue en
  `sim/<id>.ts` y `sim/actions/<id>.ts` (mover los ficheros solo cambiaba imports). Para un
  sistema nuevo, todo en `sim/systems/`.
- Instantánea: `SimSnapshot.systems` con versión por sistema; `SIM_SNAPSHOT_VERSION` sube a 18
  una sola vez (las de la v17 se ignoran, como siempre: arranque limpio del runtime).
- Activos por mundo: columna `worlds.systems` (jsonb, migración 0015) y `systems` en
  `POST /api/admin/worlds`. Desactivar un sistema quita sus revisiones, prompt, instantánea y
  acciones; sin `norms`, `mayEnter` no pone pegas.
- Secciones del prompt con `order` (agenda 0, invitaciones 10, inventario 20): el prompt sale
  byte a byte igual que antes.
- `identityLines` llega al prompt fijo por `AgentDeps.worldRules` (vacío hoy: el prompt no cambia).
- Retención: cada sistema declara la política que cubre su tabla o por qué no la necesita; un test
  lo comprueba. No se generalizó la poda (las tablas nuevas añadirán su política en retention.ts).
- `mock()`: los sistemas migrados ya tenían sus reglas en agent-core; el campo es para los nuevos.
- Comprobación local: `prettier --check` falla en Windows por el CRLF del checkout
  (`core.autocrlf=true`, 224 ficheros sin tocar); se comprueba con `--end-of-line auto`, que es
  lo que ve la CI (Linux, LF).

### Paso 2

- Mock, 48 h: 18 citas acordadas hablando, 9 descartadas (8 × «ya tengo demasiadas citas», 1 ×
  «ya habían quedado») y 27 intenciones enlazadas a un compromiso en vez de duplicarse.
- El coste en mock sube un 30 % (4.420 → 5.756 llamadas): no por el puente en sí (no hay
  llamadas nuevas) sino porque hay más citas → más encuentros → más charlas, decisiones,
  importancia, fichas y resúmenes. El prompt de `social` crece ~230 tokens no cacheados
  (512 frente a 281 por llamada). La frecuencia del mock (1 de cada 4 «Deberíamos venir
  juntos») es arbitraria: la cifra que importa saldrá de una partida real.
- Quien estaba en la charla cuenta como presente aunque acabe de irse (`agreedWith`), salvo
  para invitar (ir juntos ahora).
- Los descartes van a la auditoría de memoria (`agreement_discarded`, con `memoryId`
  `agreement:<conversación>`): es la auditoría que ya se ve en el inspector y se exporta. No
  es un recuerdo, pero evita una tabla nueva.
- El tipo de acuerdo es una cadena abierta: `pay` y `teach` se añadirán como
  `AgreementKind` de sus sistemas; hoy se descartan con «no hay acuerdos de tipo …».
- Dorado regenerado (72 h: 6.832 → 8.401 llamadas, 31 acuerdos).
