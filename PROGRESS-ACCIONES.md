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
- [x] 0.2 `mock-responder.ts` declarativo (registro de respondedores con reglas pequeñas)
- [x] 0.3 `bootstrap.ts` en factorías por área
- [x] 0.4 `MemoryStore.listActive(agentId, { withEmbedding })`
- [x] 0.5 Retención de datos configurable por tabla + job + test
- [x] 0.6 `gist.minImportance` = 4 (y medir)
- [x] 0.7 `docs/decisiones/` (ADR breves), CLAUDE.md corto, sin PROGRESS antiguos
- [x] 0.8 Tests unitarios de la lógica no visual de la web

### Paso 1 — Catálogo de acciones

- [x] `AgentAction` + `ActionRegistry` en shared
- [x] `DecideResponse` → `{ choice: "continue" | "act", action, reason }` (`do_activity`, `say`)
- [x] Prompt con solo las acciones disponibles
- [x] Errores → percepción "No pude …" + recuerdo; acciones en `sim_events`

### Paso 2 — Citas y compromisos

- [x] `propose_meeting`, `accept_meeting`, `decline_meeting`, `cancel_meeting`
- [x] Tabla `commitments` + instantánea + RAM
- [x] Hueco en el plan (hoy) y restricción en `planDay` (mañana)
- [x] Intenciones que se pueden olvidar; plantones, tardanzas, afinidad, dramas
- [x] Pestaña «Agenda»

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

### Tras el paso 0.6 (`gist.minImportance` = 4)

Esencias 847 → 346 (−59 %); llamadas 3613 → 3041 (−16 %); entrada no cacheada 854 232 → 801 988
(−6 %). Lo de importancia 3 (el diario del día, lo que se dice uno mismo) ya no se resume con el
LLM: se desvanece con la esencia provisional.

### Tras el paso 1 (catálogo: `do_activity` y `say`)

|          | Llamadas | decide | Entrada no cacheada | Entrada por decisión |
| -------- | -------: | -----: | ------------------: | -------------------: |
| Tras 0.6 |     3041 |    939 |             801 988 |                  483 |
| Paso 1   |     3468 |   1094 |             946 351 |                  507 |

Sin llamadas nuevas. La entrada por decisión sube un 5 % (la lista de acciones). El total sube porque
el mock elige con el hash del prompt: al cambiar el texto cambian sus "dados" y en estas 48 h hubo más
conversaciones (más decisiones). Es ruido del mock, no del diseño.

### Tras el paso 2 (citas)

|        | Llamadas | decide | Entrada no cacheada | Entrada por decisión |
| ------ | -------: | -----: | ------------------: | -------------------: |
| Paso 1 |     3468 |   1094 |             946 351 |                  507 |
| Paso 2 |     2991 |    959 |             873 374 |                  552 |

Sin llamadas nuevas (las citas van en la misma decisión). La entrada por decisión sube un 9 % (más
acciones en la lista y la AGENDA cuando la hay); el total vuelve a moverse por el ruido del mock.

## Decisiones tomadas

- **`agent.ts` como fachada**: la clase `Agent` conserva su API pública; el detalle vive en
  `agent-body.ts` (ánimo, necesidades, sueño, codificación, intrusivos), `agent-planning.ts`
  (semillas, diario, hábitos, plan), `agent-perception.ts`, `agent-decision.ts`,
  `agent-intentions.ts`, `agent-social.ts` y `agent-types.ts`. Las funciones reciben el agente.
  Los métodos de la fachada devuelven la promesa sin `async` para no añadir ticks de microtareas:
  el orden de los eventos (y el test dorado) no cambia. `deps` y `spots` pasan a ser públicos
  (de solo lectura) para que los módulos los usen; `validPlace` también. La división se hizo con
  un script (sin reescribir a mano la lógica).
- **Mock declarativo** (`agent/mock/`): `registry.ts` guarda un respondedor por tarea y las reglas
  de `decide` en orden (`registerDecideRule(regla, { before | after })`, que sustituye si el
  nombre ya existe). `context.ts` lee el prompt una sola vez (`decideContext`) y las reglas son
  funciones pequeñas `respond(ctx) → { response, reason } | null` (`decide.ts`); el resto de
  tareas va en `plan.ts`, `memory.ts` y `narrative.ts`, movidas sin cambios. `mock-responder.ts`
  solo carga los módulos y reexporta. Las respuestas son idénticas (el dorado no cambia). Cada
  acción del catálogo registrará su regla en su propio módulo.
- **Factorías** (`apps/server/src/factories/`): `llm.ts` (proveedor, pila compartida con
  reintentos/cola/lotes y cliente de cada mundo con costes), `memory.ts` (configuración, memoria
  de cada mundo y mantenimiento), `security.ts` (usuarios, presupuesto, protección de menores y
  moderación del texto de usuario), `worlds.ts` (abrir un mundo, instantáneas, `attachWorlds`),
  `services.ts`, `files.ts` y `types.ts`. `bootstrap.ts` solo orquesta y reexporta lo de antes,
  así que los importadores no cambian. Mismo orden de construcción: el dorado no cambia.
- **`listActive(agentId, { withEmbedding })`**: lo usan el mantenimiento, la consolidación y los
  recuerdos intrusivos (sin vectores) y el olvido por presupuesto (con vectores, porque agrupa
  por similitud). En Postgres, sin `withEmbedding` no se selecciona la columna `embedding`
  (384 floats por fila); en RAM se devuelven siempre (ya están en memoria). Tests de que el
  resultado es el mismo que `listByAgent` filtrado. El dorado no cambia.
- **Retención** (`apps/server/src/retention.ts`, sobrescribible con `config/retention.json`): una
  política por tabla con días de juego (tablas de un mundo) o reales (costes, moderación, bus,
  instantáneas) y modo. Por defecto: recuerdos olvidados o archivados, 14 días de juego (los
  activos nunca); auditoría y versiones, 30 (y las versiones huérfanas); historial social, 30 días
  **resumido** a un cambio por pareja y día de juego (la red y la mini gráfica siguen viéndose);
  eventos, 14 salvo las crónicas; `llm_calls`, 62 días reales **resumidos** a una fila por día,
  mundo, modelo y tarea (`agent_id = "*"`, sin perder el gasto); moderación, 90; bus, 1;
  instantáneas, 7 (siempre queda la última de cada mundo). Cada mundo tiene `prune()` y el proceso
  (todo en uno o worker) lo llama cada `everyMinutes` minutos **reales** con un intervalo `unref`:
  el reloj de juego no se toca y el dorado no cambia. En RAM se podan los almacenes en memoria con
  los mismos criterios. Tests en RAM, en Postgres y del inspector y Rashomon tras podar.
- **`docs/decisiones/`**: las decisiones de PROGRESS.md, PROGRESS-PRODUCCION.md y
  PROGRESS-PSICOLOGIA.md, condensadas en un archivo por área (mundo, simulación, memoria,
  psicología, relaciones, menores, LLM y coste, producción, interfaz y acciones). Se quedaron fuera
  los checklists y las notas de bloqueos ya resueltos. Los tres PROGRESS antiguos se borran;
  CLAUDE.md queda en convenciones cortas con enlaces. Este archivo se consolidará en
  `docs/decisiones/acciones.md` al final de la rama.
- **Tests de la web**: `apps/web` entra en los proyectos de Vitest. Lo no visual se saca a
  módulos puros: `net/game-state.ts` (estado y `applyMessage`, el reductor de los mensajes del
  servidor, más `worldApiPath`) y `ui/filters.ts` (jardín de recuerdos, relaciones, búsqueda sin
  tildes); `store.ts` solo conecta el WebSocket y los efectos. i18n no toca `document` fuera del
  navegador. El estimador de reloj ya estaba en shared con sus tests.
- **Registro de acciones en tres capas** unidas por el `type`: en shared el esquema zod
  (`AgentAction`, unión discriminada) y su presentación en el prompt (`ACTION_SPECS`); en el
  servidor (`sim/actions/`) el manejador con disponibilidad, precondiciones, ejecución, efectos y
  descripción ("No pude …"); en agent-core la regla del mock. Un test comprueba que el esquema, las
  descripciones y los manejadores cubren las mismas acciones.
- **`Decision` = `follow_plan | act(action) | invalid(error)`**. agent-core solo comprueba la forma
  (zod); si es posible lo decide el motor. El formato antiguo (`react`/`talk`) se sigue aceptando y
  se traduce a `do_activity`/`say`; las reglas antiguas del mock se traducen igual (`asAction`).
- **Lo que no es posible** (lugar desconocido, alguien que no está, parámetros no válidos) llega como
  percepción "No pude …: motivo." (la recuerda al percibirla y puede reconsiderarlo) y deja un evento
  `✗ … no pudo …` con `meta = { action, ok: false }`. Los eventos de acciones llevan
  `meta.action` (columna jsonb nueva en `sim_events`, migración 0010) para iconos y filtros.
- **Solo las acciones disponibles van al prompt** (`availableActions`): hablar, solo si hay alguien
  despierto en el mismo sitio. Sin lista del motor (tests), agent-core usa `do_activity` (+ `say` si
  hay alguien).
- **La protección de menores** revisa cualquier acción: todo su texto libre (`actionText`) con las
  personas que nombra (`actionPeople`) como actores.
- **Citas** (`sim/meetings.ts`, `sim/actions/meetings.ts`): `propose_meeting` (a quien está aquí,
  1-4 personas, hoy o mañana, de 07:00 a 22:00, con 30 min de antelación y como mucho 3 citas
  abiertas), `accept_meeting`, `decline_meeting` y `cancel_meeting`, con ids cortos ("c3"). Viven en
  el runtime (`ctx.meetings`, en la instantánea, v10) y se escriben en `commitments` (Postgres o
  RAM) en cada cambio; el api las lee de ahí para la Agenda. El contador sigue al mayor id guardado.
- **Agenda en el prompt** (sección AGENDA de decidir): invitaciones pendientes ("Responde con
  accept_meeting o decline_meeting") y citas aceptadas. Aceptar reserva el hueco en el plan de hoy
  (desde 20 min antes de la hora, 80 min); las de mañana entran en `planDay` como compromisos que
  el prompt pide respetar y que se imponen después con `replanAt`.
- **Memoria prospectiva de verdad**: cada participante guarda la intención sin pistas automáticas
  y, 20 minutos antes, el motor tira "¿se acuerda?" con su perfil y la nitidez del recuerdo
  (`recallIntentionNow`, base `prospective.appointmentRecall` = 0.9, más que una intención suelta).
  Repasar la agenda (decidir con ella delante, una vez al día por cita) refuerza el recuerdo. Si se
  le olvida pierde el hueco del plan (quizá caiga en la cuenta después). En mock se olvida ≈ 25 %.
- **Ir y llegar**: quien se acuerda deja lo que hacía por su cuenta y el motor le lleva a la cita
  en cada revisión (cada 5 min de juego) salvo si está hablando (una charla le puede hacer llegar
  tarde). Llegar después de 10 min es llegar tarde (afinidad −0.03); a los 10 min, quien espera
  percibe que el otro no llega; a los 45, la cita se da por cumplida o fallida.
- **Plantón**: quien esperaba pierde afinidad (−0.15, la mitad si es familia o amistad) y confianza
  (−0.1) hacia quien no vino, con motivo en el historial; su ánimo baja (más preocupación si es
  alguien cercano, más enfado si no) y lo percibe. Evento 💔 y drama `meeting_failed`.
- **Anular a última hora** (menos de 3 h) molesta un poco a los demás (−0.03).
- **Menores**: si en la cita hay un menor y algún adulto, solo en un lugar público (o en la casa
  del propio menor, con su familia). La protección de menores revisa además el texto del motivo.
