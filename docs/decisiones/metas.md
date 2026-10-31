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

  | Criterio            | Se mide con                                                   |
  | ------------------- | ------------------------------------------------------------- |
  | `activity_hours`    | revisión cada 5 min: su actividad contiene una palabra clave  |
  | `place_time`        | revisión cada 5 min: está en el lugar (despierto, sin viajar) |
  | `visits`            | revisión: llega a un lugar distinto del de la revisión previa |
  | `relationship`      | cada hora, su ficha social (afinidad, confianza o tipo)       |
  | `meetings`          | eventos «🤝 … se ven en …» (citas cumplidas)                  |
  | `conversations`     | eventos de habla (cada conversación o cada persona, una vez)  |
  | `places_discovered` | eventos `discover`                                            |
  | `items`             | eventos `use_object`, `return_item`, `give_item`, `lend_item` |
  | `notes`             | eventos `post_note` y `leave_note`                            |
  | `intentions_kept`   | eventos «✅ … se acuerda de …»                                |
  | `projects`          | (la vital) proyectos suyos conseguidos; los activos, su parte |

  Lo romántico no está en el catálogo (`relationship` no admite `romantic`).

- **Niveles**: vital (una activa), proyectos (3 activos como mucho) y pasos (3 por proyecto).
  Una meta vital de partida pide **dos proyectos más** de los sembrados: es de largo recorrido y
  los irá proponiendo al repasar sus días (en mock, con todos los proyectos sembrados, la vital
  se cumplía en dos días).
- **Sin llamadas nuevas.** El plan del día recibe «TUS METAS Y PROYECTOS AHORA» (compacto, con lo
  que lleva medido); la decisión, «TU PROYECTO» solo cuando viene a cuento (alguien del proyecto
  está ahí, está en su sitio o no tiene nada que hacer; como mucho cada 2 h). La revisión con el
  modelo va en la **consolidación nocturna** (gancho `consolidation`: una sección del prompt y el
  campo `goals` de la misma respuesta): añadir proyecto o paso, aplazar, abandonar o retomar.
- **Psicología en código** (`GoalsConfig` en `MemoryConfig.goals`, con valores y unidades): cada
  noche, por meta activa, avanzar sube la motivación y el ánimo (tope diario) y alivia la
  frustración; tras un día sin avanzar la frustración sube `0,12·(0,5 + neuroticismo)` al día y la
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
  temas, relaciones); las 20 de `seeds/agents.json` están revisadas a mano (coherentes con 1996 y
  cada personaje; sin conflictos nuevos). Los objetivos de relación se calibran por encima de lo
  que hay al empezar: una meta que ya se cumple al crearla se descarta.
- **Medidas en mock** (48 h, `SIM_SEED=7`): 9 proyectos conseguidos, ninguno abandonado (la
  frustración tarda unos 6 días en llegar a 0,7), progreso medio 0,33 y 2 conflictos. Lo que pase
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
