# Metas (ambición)

Objetivo: que cada vecino tenga una trayectoria (algo que quiere en la vida, proyectos para
llegar y pasos concretos) sin que el LLM se invente el progreso. Sistema `goals`
(`apps/server/src/sim/systems/goals.ts`, lógica en `sim/goals.ts`; psicología y criterios en
`packages/agent-core/src/goals/`).

## Decisiones

- **El LLM propone y redacta; el motor mide.** Cada meta lleva un criterio del catálogo
  (`GoalCriterion` en shared) que el servidor cuenta con lo que ya existe; el modelo nunca marca
  progreso. Una propuesta que no encaja en el catálogo (o con personas o lugares que no existen)
  no se crea y queda en la auditoría de memoria (`action: "goal"`) con el motivo.
- **Catálogo** (todo desde que se crea la meta):

  | Criterio            | Se mide con                                                      |
  | ------------------- | ---------------------------------------------------------------- |
  | `activity_hours`    | revisión cada 5 min: su actividad contiene una palabra clave     |
  | `place_time`        | revisión cada 5 min: está en el lugar (despierto, sin viajar)    |
  | `visits`            | revisión: llega a un lugar distinto del de la revisión previa    |
  | `relationship`      | cada hora, su ficha social (afinidad, confianza o tipo)          |
  | `meetings`          | eventos «🤝 … se ven en …» (citas cumplidas)                     |
  | `conversations`     | eventos de habla (cada conversación o cada persona, una vez)     |
  | `places_discovered` | eventos `discover`                                               |
  | `items`             | eventos `use_object`, `return_item`, `give_item`, `lend_item`    |
  | `notes`             | eventos `post_note` y `leave_note`                               |
  | `intentions_kept`   | eventos «✅ … se acuerda de …»                                   |
  | `projects`          | (la vital) proyectos suyos conseguidos; los activos, su parte    |
  | `skill_level`       | el nivel de la habilidad (sistema `skills`), desde el de crearla |
  | `confirmed`         | su `measure` (uno de los anteriores) y la comprobación nocturna  |

  Lo romántico no está en el catálogo (`relationship` no admite `romantic`).

- **«Conseguir» no es «contar»** (partida 2: Julián «consiguió» hablar de verdad con Inés
  contando charlas, y la charla de verdad nunca llegó: «Mañana hablamos de Palma»):
  - `conversations` admite `topics`: solo cuenta una conversación en la que se dice alguna de
    esas palabras (normalizado, sin tildes).
  - `confirmed` {question, measure} para lo cualitativo (hablar de verdad, reconciliarse,
    convencer). Al cumplirse `measure` la meta queda **candidata** (progreso 0,95) y se guardan
    las frases de esas charlas (12 como mucho, en la instantánea del sistema). La consolidación de
    esa noche (misma llamada) recibe «Para comprobar» con el extracto y contesta
    `{"op":"confirm","achieved":…}`. Si no se confirma, sigue activa y hace falta algo nuevo dicho
    para volver a presentarla. El LLM solo puede confirmar lo que el motor presentó.
  - En las semillas, «Hablar de verdad con Inés» es `confirmed`, y los proyectos de conversación
    llevan su tema (la deuda, la abuela, la casa, el pez, la juventud…).

- **Niveles**: vital (una activa), proyectos (3 activos como mucho) y pasos (3 por proyecto).
  Una meta vital de partida pide **dos proyectos más** de los sembrados: es de largo recorrido y
  los irá proponiendo al repasar sus días (en mock, con todos los proyectos sembrados, la vital
  se cumplía en dos días).
- **Lo que propone el modelo se coloca** (`placeProposal`): un paso sin proyecto se cuelga del
  proyecto activo que mejor encaje (misma persona o lugar en su criterio o en el de sus pasos,
  la persona del paso nombrada en el proyecto, palabras en común); colgado de la vital o sin
  encaje, pasa a ser un proyecto de la meta vital. Solo se descarta si no es medible. En la
  partida 2 se perdían 35 de 49 propuestas por «un paso tiene que ser de uno de sus proyectos».
- **El siguiente proyecto**: tras cumplir uno (en el último día), la consolidación recibe «Has
  cumplido X: propón el siguiente proyecto de tu meta vital»; y si la vital se queda sin
  proyectos activos, lo mismo (siete metas vitales se quedaron en 0,50 en la partida 2).
- **Metas de relación exigentes**: el objetivo queda al menos `relationshipMinGain` (0,3) por
  encima de la afinidad (o la confianza) al crearla, y además pide
  `relationshipMinConversations` (3) conversaciones con esa persona, auditado. Junto con los
  rendimientos decrecientes de las fichas ([social](social.md)), ya no se cumplen en medio día.
- **Sin llamadas nuevas.** El plan del día recibe «TUS METAS Y PROYECTOS AHORA» (compacto, con lo
  que lleva medido); la decisión, «TU PROYECTO» solo cuando viene a cuento (alguien del proyecto
  está ahí, está en su sitio o no tiene nada que hacer; como mucho cada 2 h). La revisión con el
  modelo va en la **consolidación nocturna** (gancho `consolidation`: una sección del prompt y el
  campo `goals` de la misma respuesta): añadir proyecto o paso, aplazar, abandonar o retomar.
- **Psicología en código** (`GoalsConfig` en `MemoryConfig.goals`, con valores y unidades): cada
  noche, por meta activa, avanzar sube la motivación y el ánimo (tope diario) y alivia la
  frustración; tras un día sin avanzar la frustración sube `0,2·(0,5 + neuroticismo)` al día y la
  motivación baja; con frustración media ≥ 0,6 el ánimo baja 0,06 al día. Con frustración ≥ 0,7
  un proyecto puede abandonarse (probabilidad diaria × menos con responsabilidad × más con
  neuroticismo); con ≥ 0,75 la vital puede cambiar (más con apertura y por debajo de 30 años, 0,4×
  por encima de 65). Todo con `memory.audit` y su motivo, y el azar por el `Rng` inyectado.
- **Recuerdo de la meta**: crear una vital o un proyecto deja «Me he propuesto: …» (importancia 6
  y 5, con el olvido de siempre); conseguirla, «Lo conseguí: …». Con importancia 8 acaparaba las
  recuperaciones (se vio en la entrevista antes/después): se bajó.
- **Metas en conflicto**: dos metas activas de distintos agentes con el mismo `resource` (texto
  libre: `casa_en_venta`, `clientes_tarde`) compiten. Al detectarlo: evento ⚔ (drama
  `goal_conflict`) y −0,05 de afinidad en las dos fichas («quiere lo contrario que yo»). Si uno lo
  consigue, el otro gana frustración (+0,3) y pierde afinidad (−0,1). Se miran al abrir el mundo,
  cada hora y tras cada noche.
- **Marcharse** (`departure: { to }` en la vital): un adulto que la consigue deja la charla, de
  acompañar, cancela sus citas (con la acción formal `cancel_meeting`), devuelve lo que tenía
  prestado (sus cosas se van con él) y pasa a `locationId: "fuera"` (`AWAY_LOCATION`): el gancho
  `holds` hace que la simulación no ejecute su tick (no vive ni llama al LLM) y nadie lo ve.
  Cada vecino guarda «X se ha ido a vivir a Palma» (importancia 6, con olvido). Su casa sigue
  siendo suya (nadie se muda todavía). Vuelve de visita cada 7 días de 10:00 a 19:00
  (`goals.departure`, configurable; 0 = no vuelve), con sus recuerdos; aparece en la plaza.
  Tabla `departures` y en la instantánea; API `/departures`.
- **Menores**: metas propias de su edad; la de irse (Inés) se formula como «cuando sea mayor de
  edad»: puede avanzar, pero al conseguirla queda **aplazada** (no se puede retomar mientras sea
  menor; lo resolverá el ciclo vital). Ningún criterio de un menor puede ser estar en una casa
  ajena; las citas ya pasan por `minorMeetingRule`; el texto de toda meta pasa por `MinorGuard`.
- **Metas de partida**: `pnpm goals:derive` propone una vital y 1–2 proyectos por reglas (trabajo,
  temas, relaciones); las 20 de `seeds/agents.json` están revisadas a mano (coherentes con la época y
  cada personaje; sin conflictos nuevos). Los objetivos de relación se calibran por encima de lo
  que hay al empezar: una meta que ya se cumple al crearla se descarta.
- **Frustración: 0,2 por día estancado** (era 0,12: en los 3 días de la partida 2 nadie llegó a
  0,7 ni abandonó nada). Con las 20 personalidades, un proyecto parado toda una semana se
  abandona con un 53 % de media: de un 32 % (Samuel, constante y tranquilo) a un 81 % (Lucía); si
  avanza aunque sea un poco cada dos días, menos de un 5 %. La probabilidad diaria de abandonar
  (0,25 con frustración 1) y la de cambiar de meta vital (0,08) no cambian: en una semana con
  todos los proyectos parados, la vital cambia en torno a un 15 % de las veces. Test con las
  semillas en `agent-core/src/__tests__/goals.test.ts`.
- **Medidas en mock** (48 h, `SIM_SEED=7`): 9 proyectos conseguidos, ninguno abandonado (la
  frustración tardaba unos 6 días en llegar a 0,7), progreso medio 0,33 y 2 conflictos. Con la
  corrección 2.5: 3 conseguidos en 48 h (los proyectos con tema no cuentan cualquier charla del
  mock), progreso medio 0,22 y frustración media 0,09. Lo que pase
  con el LLM real hay que medirlo en una partida (ver PROGRESS-MUNDO-METAS.md).

## Interfaz y métricas

- Inspector, pestaña **Metas** (para todos): vital, proyectos y pasos con lo medido, progreso,
  motivación y frustración (rol `meter`) e historial desplegable con los motivos.
- Crónicas: **Vecinos que se fueron**. En el mapa no se pinta a quien está fuera.
- Dramas: `goal_achieved`, `goal_abandoned`, `life_change`, `goal_conflict`, `departure`, `visit`
  (a partir de `meta.action` de los eventos: `goal`, `goal_life`, `goal_life_change`,
  `goal_conflict`, `departure`, `visit`).
- «Evolución» y `study:analyze`: por día, metas activas al final del día, conseguidas y
  abandonadas ese día, progreso y frustración medios, y lo mismo por agente (del historial de
  cada meta, que guarda una entrada cada noche y en cada cambio).
