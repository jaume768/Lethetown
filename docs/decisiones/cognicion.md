# Cognición en movimiento (fase 3.6)

Antes, quien caminaba no pensaba ni era visto: `simulation.ts` se saltaba su turno,
`perception.ts` lo excluía e `isHere` exigía el mismo lugar. Dos vecinos que se cruzaban no se
enteraban. Ahora hay encuentros por el camino, pensamiento por asociación, pararse a charlar,
hablar andando con quien acompaña y hablar sin dejar lo que se está haciendo. Todo con poco
coste y con interruptores por mundo, para poder apagarlo en un mundo de control.

## Interruptores (mundo de control)

- **`cognition` por mundo** (`worlds.cognition`, jsonb; `CognitionSettings` en shared): un
  interruptor general (`enabled`) y cinco partes: `encounters`, `associations`, `stopToChat`,
  `walkingTalk` y `talkWhileActivity`. Todo encendido por defecto; solo se guarda lo que cambia.
  Con el general apagado, todas las partes quedan apagadas.
- **`SIM_COGNITION`** (entorno): lo de por defecto del proceso: `on`, `off` o una lista
  (`encounters=off,walkingTalk=off`). Lo que guarde el mundo manda. Lo que no se entiende es un
  error al arrancar (mejor eso que estudiar un mundo de control que no lo era).
- **Apagada = antes, byte a byte.** El test dorado `three-days-off.txt` (con `SIM_COGNITION=off`)
  es la línea de tiempo de `main` antes de la 3.6 y no cambia. Para ello: todo lo nuevo mira
  `ctx.cognition` o su sistema (`encounters`, `associations`; `SimContext.enabled` los sigue);
  las acciones de sistemas desactivados no se describen en el prompt fijo (`hiddenActions`), y el
  cambio de rumbo a mitad de camino (salir de la baldosa actual, no de la de salida) solo va con
  la cognición encendida.
- **Parámetros** (`CognitionParams`, con unidades): `nearRadius` (4 baldosas, «cerca»),
  `callRadius` (8, «a voces»), `scanEveryMinutes` (2), `decisionLeadMinutes` (1,5),
  `pairCooldownMinutes` (60), `maxWalkDecisionsPerHour` (2), `eavesdropRadius` (2),
  `practiceWhileTalking` (0,5), `attentionSlowdown` (1,5), `maxAssociationsPerHour` (2),
  `associationRecall` (1), `associationMinImportance` (3), `associationMinAgeMinutes` (60),
  `greetReplyMinutes` (3). La saliencia es psicología: `MemoryConfig.encounter` (agent-core).

### Cómo crear un mundo con la 3.6 apagada

- **Partida de estudio** (el mundo por defecto de cada servidor): `SIM_COGNITION=off` en su
  `.env.study.<semilla>`. `scripts/estudio-semana.sh` lo hace con `COGNITION_CONTROL=on`: un
  mundo más, `s7c`, la semilla 7 con `.env.study.s7c` (ver `.env.study.example`). El manifiesto
  de `record` lo apunta (`cognition: "off"`) y `study:analyze s7 s7c` compara los dos.
- **Por la API** (un mundo más en el mismo proceso): `POST /api/admin/worlds` con
  `{"id":"control","name":"Control","map":"seeds/town.tmj","seed":7,"cognition":{"enabled":false}}`.
  Al abrirlo, el log dice «Cognición en movimiento: todo apagado (mundo de control)».
- Para apagar solo una parte: `{"cognition":{"walkingTalk":false}}` o
  `SIM_COGNITION=walkingTalk=off`.

## Posición y proximidad

- **`tileAt`** (shared): la baldosa de un agente en un instante a partir de `movement` (la misma
  interpolación que el cliente), y **`tileDistance`** (euclídea). **`CellIndex`**: índice por
  celdas del tamaño del radio; no se compara a todos con todos.
- **Distancia mínima en el intervalo** (`closestApproach`), no en el instante: a 6 baldosas por
  minuto, dos que se cruzan en sentidos opuestos atraviesan un radio de 4 en menos de un minuto;
  mirando solo cada 2 minutos, casi nunca se veían. Solo cuentan los instantes en que **se ven**
  (si uno está en un sitio a cubierto, solo desde dentro del mismo sitio: no a través de una
  pared; quien sale de casa no ve la calle hasta que sale).
- **Se ve venir a la gente** por su ruta (`decisionLeadMinutes`): la ventana es [ahora − 2 min,
  ahora + 1,5 min]. La respuesta del LLM real tarda ~1,7 min de juego a x10; así llega cuando se
  cruzan. Lo que se decide antes de cruzarse se hace al cruzarse (si sigue valiendo).

## Encuentros por el camino (sistema `encounters`)

- **Cada 2 min de juego, sin LLM**: para cada uno que camina, quién tiene cerca (camine o no).
  Cada pareja (quien camina → a quien ve) cuenta como mucho una vez por `pairCooldownMinutes`; si
  se acababan de ver en el mismo sitio (salían de él), no es un encuentro. Todo encuentro deja
  su evento (👀, `meta.salient`, `meta.reunion`).
- **Saliencia en código** (`encounterSalience`, agent-core, con tests): afinidad (también la
  negativa) y familiaridad, familia, rivalidad, intención pendiente con esa persona (si la memoria
  prospectiva se la recuerda al verla), cita pendiente, préstamo o deuda, metas que chocan, ánimo
  muy marcado que se le ve y reencuentro (≥ 2 días sin verse, si se conocen). Umbral 0,5.
- **Solo por encima del umbral piensa** (`ctx.wake`) y como mucho `maxWalkDecisionsPerHour` veces
  por hora (lo que le dicen andando siempre se atiende: es el ritmo de la charla). Por debajo,
  un recuerdo de poca importancia la primera vez del día; lo trivial y repetido, nada (un
  recuerdo por encuentro llevó `summarize` de 3 a 136 llamadas en 48 h por el presupuesto).
- **Quien está quieto no piensa por ver pasar a alguien**: solo quien camina tiene encuentros.
  Así el coste no crece con cada vecino que pasa por delante.
- **Memoria prospectiva**: cruzarse con esa persona es la pista, con el mecanismo de siempre
  (`checkIntentions` con su perfil): si se acuerda, «Te acuerdas de que querías…» va en el
  contexto y la intención cuenta para la saliencia; si se le pasa, 🫥 como siempre.
- **Ver a alguien trae recuerdos** (asociación, si el sistema está activo).

## Pensar andando

- **Turno andando** (`walking.ts`): quien camina solo piensa si algo se lo pide (un encuentro
  saliente o que le hablen). Contexto breve, sección **DE CAMINO**: a dónde va y para qué, con
  quién se cruza («Te cruzas con…» / «Ves venir a…», con lo que se le ve y por qué le importa) y
  lo que le recordó la memoria prospectiva. Es la tarea **`decide_walking`** (mismo prompt y
  respuesta que `decide`, en la cola urgente): su coste sale aparte.
- **Opciones**: seguir (`continue`, por defecto), saludar al pasar (`greet`), pararse a charlar
  (`stop_to_chat`), hablar con quien va a su lado (`say`) o cambiar de destino (`do_activity`).
- **Sigue andando mientras espera al LLM.** Al llegar la respuesta se revalida: si la otra
  persona sigue al alcance de la voz, vale; si aún no se han cruzado, se hace al cruzarse; si
  ya se alejaron, se descarta **sin percepción «No pude…»** (nadie lo intentó de verdad), con su
  cifra y un evento ⌛.
- **Pasar de largo** ante alguien que le hizo pensar es un evento (🚶, con la saliencia) y, si le
  importaba mucho (≥ 0,6), un drama.

## Saludar, pararse a charlar o seguir

- **Saludar** (`greet`): una frase muy corta (60 caracteres), sin abrir conversación. Si a quien
  lo recibe le importa quien saluda (su saliencia ≥ umbral) y puede pensar, lo oye y puede
  devolverlo (`greet` se le ofrece unos minutos, mientras siga cerca); si no, solo un recuerdo de
  poca importancia. Devolverlo no despierta al primero (sin ping-pong).
- **Pararse a charlar** (`stop_to_chat`): se detiene en su baldosa (o la libre más cercana),
  guarda el viaje (destino, para qué, el bloque del plan) y abre una charla normal **en el
  camino** (`Conversation.road`). Si la otra persona camina, se le ofrece pararse también (puede
  no hacerlo). Al acabar la charla retoma el viaje con una ruta nueva; si el bloque del plan al
  que iba ya pasó, mete ese rato en el plan (`replan`, 30 min) y va.
- **Quien se para sigue «de camino» para el resto del pueblo** (`travelling` sin llegada): no
  está en el sitio más cercano, está en la calle. En la primera versión quedaba en el sitio
  público más cercano (casi siempre la plaza): contaba como presente para todos los de la plaza,
  se formaban grupos y se quedaba horas: +24 % de llamadas de media. Ahora solo cuenta para su
  charla y solo piensa si le hablan.
- **Presencia por proximidad** (`presence.ts`): en una charla en el camino, `isHere`, `say`, la
  percepción (`presentWith`) y quien puede hablar aceptan «está a ≤ `callRadius`» en vez del mismo
  `locationId`. Quien se aleja más de ese radio de todos los demás sale de la charla.
- **Escuchar a escondidas en el camino**: solo a ≤ `eavesdropRadius` (2 baldosas), ande o no, con
  la fidelidad parcial de siempre.
- **Normas y menores**: pararse en el camino es un sitio público (el sitio de la charla es el
  público más cercano). `minorMeetingRule` y `MinorGuard` se aplican igual (el texto de saludar y
  pararse es habla); nada de llevarse a un menor a una casa desde el camino (la invitación pasa
  por su manejador).

## Hablar andando (`walkingTalk`)

- Quienes van juntos (`go_together` tras una invitación aceptada, `follow`) pueden hablar
  mientras caminan: la charla sigue por proximidad durante el trayecto y al llegar. No «se
  cruzan» (no es un encuentro ni deja recuerdo): verse de camino es solo la ocasión de hablar
  (`together` en la saliencia), y con su acompañante ni se paran ni se saludan.
- Mismo ritmo (despertar al minuto) y mismo recorte de frases. Andando no cambian su actividad
  («caminando a…»); el bocadillo va sobre el personaje en movimiento.

## Hablar sin dejar la actividad (`talkWhileActivity`)

- Hablar no cancela lo que se hace si es algo (trabajar, comer, cocinar, leer, estar sentado):
  `state.action` y `activityKind` se mantienen; estar sin hacer nada sí pasa a «hablando con…».
- La práctica de la habilidad sigue en la misma revisión con factor `practiceWhileTalking`
  (0,5; no se cuenta dos veces). Si lo que hace necesita atención (un objeto en marcha en su
  sitio), tarda × `attentionSlowdown` (1,5, una vez por uso).
- Lo que llega de fuera mientras habla se graba peor, como antes con «hablando» (`talking`).
- La interfaz lo muestra con la insignia 💬 y en el inspector.

## Pensamiento por asociación (sistema `associations`, sin LLM)

- **Pistas**: pasar por un sitio (de la ruta, no el de salida ni el de llegada), ver a alguien
  por el camino, ponerse en un objeto. `MemorySystem.recallByCue`: la recuperación de siempre
  (relevancia por la pista, recencia, importancia, ánimo y fuerza), pero solo lo que sale de esa
  pista (el mismo lugar, esa persona o el nombre del objeto). Recordar refuerza con el efecto de
  espaciado; **sin reconsolidar** (nunca llama al LLM).
- Solo recuerdos de importancia ≥ 3 y de hace al menos 1 h; sin eso, lo que más «venía a la
  cabeza» al ver a alguien era el recuerdo del cruce recién guardado. Planes e intenciones,
  fuera (tienen su mecanismo).
- Entran en la memoria de trabajo («te viene a la cabeza…»), así que aparecen en la siguiente
  decisión, y en el inspector («Le vino a la cabeza…», `AgentState.cameToMind`). Si es
  importante y negativo, se porta como un recuerdo intrusivo (tiñe el ánimo, efecto `intrusive`).
- Tope `maxAssociationsPerHour` por agente; solo gasta del tope si de verdad le viene algo.

## Estado, interfaz y métricas

- **Instantáneas**: el sistema `encounters` guarda enfriamientos, vistos, viajes pendientes,
  parejas que han hablado y cifras (versión 1); `associations`, sus topes y cifras. En
  `SimSnapshot`: `Conversation.road`, `Heard.greeting` y `people` en las percepciones del mundo
  (campos opcionales: las instantáneas de antes siguen valiendo, sin subir la versión).
- **Interfaz**: iconos (👋 saludar, 🛑 pararse, 👀 encuentro, 🚶 pasar de largo y retomar, 💭
  asociación), insignia 💬, «Le vino a la cabeza…», dos filas en «Evolución» y tres dramas:
  reencuentro tras días sin verse, charla nacida en el camino y pasar de largo ante alguien que
  importa. Textos en es/en.
- **Métricas** (`DayMetrics.cognition`, de los eventos y de las llamadas `decide_walking`, igual
  en «Evolución» y en `study:analyze`, que compara dos mundos): encuentros (y los que hacen
  pensar, reencuentros), decisiones andando (y las descartadas por llegar tarde), saludos,
  paradas, charlas nacidas en el camino (paradas o andando), parejas que hablaron por primera
  vez en el camino, pasar de largo y asociaciones. Las frases de una charla en el camino llevan
  `meta.road` (y `meta.walking`).

## Coste

`cost:report 48` (mock, semilla 7): 3.632 → 4.171 llamadas (+14,8 %). El mock es caótico: un
cambio pequeño mueve la partida entera; por semilla, la diferencia va de −26 % a +30 %. Con 10
semillas (48 h cada una): 3.841 → 4.050, **+5,4 % ± 5,1 %** (mediana +12,9 %). Dentro del
objetivo (≤ 10–15 %). `decide_walking` son 76 llamadas en 48 h (0,009 $); lo demás que añade son
charlas: `social` al cerrarlas, `importance` de lo oído y `decide` de quien contesta.

## A revisar con una partida real

- La latencia real frente a `decisionLeadMinutes`: cuántas decisiones andando llegan tarde.
- Si el umbral de saliencia (0,5) y el tope (2 por hora) dejan pensar lo bastante, y si los
  saludos al pasar suenan naturales (y cortos) con el LLM.
- Cuánto duran las paradas a charlar y si la gente llega tarde a sus citas por ellas.
- Si las asociaciones (≈ 2 por agente y día en mock) se notan en las decisiones o son ruido.
- El efecto en la red (parejas que hablan por primera vez en el camino) frente al mundo de control.
