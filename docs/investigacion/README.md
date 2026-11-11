# Investigación

[English](../en/README.md)

Lethetown es un pueblo de 20 vecinos movidos por un LLM con una memoria que **se parece a la
humana**: olvida, se vuelve vaga, se reescribe al recordar y confunde quién le contó qué. La
pregunta: **¿qué pasa en un pueblo cuando la memoria de sus habitantes deja de ser un registro
fiable e ilimitado?** La hipótesis es que el olvido, la reconstrucción de los recuerdos y las
diferencias psicológicas producen historias individuales y dinámicas sociales más variadas y
verosímiles. Es una hipótesis abierta: los estudios de abajo son observaciones, todavía sin el
mundo de control que la pondría a prueba (ver [preguntas abiertas](../roadmap.md#preguntas-abiertas)).

Toda la psicología es código con parámetros (`MemoryConfig` en `packages/agent-core`), no
instrucciones al modelo: el LLM habla, propone y redacta; el motor decide qué se recuerda, qué se
olvida y qué se ha conseguido, y lo deja auditado con su motivo. Por eso cada fenómeno se puede
contar, comparar entre semillas y apagar para tener un control.

## Qué se estudia

| Tema                                | Qué hace el motor                                                                              | Dónde                                                                        |
| ----------------------------------- | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| **Olvido**                          | La fuerza de cada recuerdo cae con el tiempo de juego; bajo un umbral (0,05) ya no se recupera | [memoria](../decisiones/memoria.md)                                          |
| **Vaguedad**                        | Bajo otro umbral (0,3) solo queda la esencia                                                   | [memoria](../decisiones/memoria.md)                                          |
| **Reconsolidación**                 | Recordar algo lo reescribe un poco según el ánimo; queda el historial de versiones             | [memoria](../decisiones/memoria.md)                                          |
| **Confusión de fuentes**            | «Me lo contó X» puede pasar a «lo viví»                                                        | [memoria](../decisiones/memoria.md)                                          |
| **Falsos recuerdos (y colectivos)** | Lo vago se rellena; lo que se cuenta y se repite se fija en la consolidación como un hecho     | [psicología](../decisiones/psicologia.md), [social](../decisiones/social.md) |
| **Memoria prospectiva**             | Intenciones que se cumplen, se pasan o se olvidan («felicitar a Pilar por el aniversario»)     | [psicología](../decisiones/psicologia.md)                                    |
| **Metas**                           | Meta vital, proyectos y pasos que el motor mide; motivación, frustración y abandono            | [metas](../decisiones/metas.md)                                              |
| **Aprendizaje**                     | Habilidades que suben con la práctica y se oxidan; saberes que se transmiten y se deforman     | [skills](../decisiones/skills.md), [lore](../decisiones/lore.md)             |

## Estudios

Partidas reales (Anthropic: decisiones con `claude-haiku-5-5`, planes y consolidación con
`claude-sonnet-5-5`), grabadas y analizadas con `pnpm study:analyze`. Cada informe trae sus cifras
y de dónde salen.

### E1 — 48 horas ([informe](estudios/e1-partida-2dias/ESTUDIO.md))

- **Un falso recuerdo colectivo nace de una muletilla.** La de Hugo («ya te lo pago, de verdad»)
  se vuelve una deuda con Valentina que nadie sembró: intenciones, reconsolidación («ya van dos
  días…», cuando había pasado una hora) y consolidación la fijan como hecho. Al final, fichas
  asimétricas: Hugo la ve como amiga (+0,76); ella, como alguien que no paga (−0,20).
- **Memoria prospectiva:** 197 intenciones cumplidas frente a 30 fallidas (13 %).
- **Coste:** 3,65 $ por 48 h de juego; el 75 % en tres tareas de Sonnet que no tocan la charla.

### E2 — 72 horas, Mallorca y metas ([informe](estudios/e2-partida-3dias-metas/ESTUDIO.md))

- **Una vecina que no existe:** los dos chismosos inventan a «la Pepa» y la sostienen con la
  misma maquinaria: 23 recuerdos con ella, aprendidos el uno del otro con su fuente.
- **Medir no es conseguir:** Julián «consigue» hablar de verdad con Inés porque el criterio
  contaba conversaciones, pero la charla nunca llega («Mañana hablamos de Palma…»). De ahí las
  metas cualitativas que comprueba la consolidación.
- **0 anacronismos** en 1.596 frases; 27 metas conseguidas; 1,63 $ por día de juego.

### E3 — una semana, dos semillas en paralelo ([informe](estudios/e3-semana-fase3/ESTUDIO.md))

- **Las cifras se parecen; las historias, no.** Con las mismas semillas de personajes, en s13
  Julián le dice a Inés que le da miedo quedarse solo (y la consolidación lo confirma); en s7 lo
  esquiva. A Tomás se le pasa el aniversario en s13 y se acuerda en s7. Lo que sale en las dos
  (la deuda de Hugo, Nuria contra Elena, Aurora contando lo de Alma) apunta al diseño.
- **Olvido visible:** Aurora olvida a su amiga de juventud a lo largo de la semana: «Alma era
  pura risa… ¿dónde estaba yo?» (día 3), «De Alma ya no me acuerdo de eso» (día 4), y el
  recuerdo cae bajo el umbral el día 6 (fuerza 0,049 < 0,05).
- **Intenciones cumplidas, del 46 % al 73–78 %**; 56 y 45 proyectos nuevos; 2 y 4 abandonos con
  historia. **1,31 $ por mundo y día** (18,38 $ las dos semillas, una semana).

Las repeticiones de E3 se pueden ver sin coste en la web (`/replay`, ver
[vídeos](../videos/README.md)).

## Evaluación y coste

Antes de los estudios con el LLM real, lo que se mide con el mock en cada fase.

Medido con el proveedor simulado (`pnpm --filter @lethetown/server cost:report 48`: 48 h de juego,
20 agentes, `SIM_SEED=7`, en RAM). Es reproducible, pero el mock solo ejercita los caminos del
programa: **no es una medida del coste ni del comportamiento con un modelo real**.

| Fase                           | Llamadas | Decidir | Entrada no cacheada | Por decisión | Lectura de caché |
| ------------------------------ | -------: | ------: | ------------------: | -----------: | ---------------: |
| Antes de las acciones (`main`) |     3613 |     963 |             854 232 |          481 |        5 349 411 |
| Con todas las acciones         |     3289 |    1054 |           1 070 873 |          600 |        5 734 538 |

Ninguna acción añade llamadas: van en la misma decisión. Se decide algo más (hay más con quién
hablar y qué hacer) y cada decisión lleva más contexto (agenda, inventario, invitaciones, lugares
descubiertos), aunque el catálogo vive en el prompt fijo cacheado. Bajaron las esencias
(`gist.minImportance` = 4: 847 → 261). Por fases, en [el historial](../historial.md#acciones).

Otros registros: en 72 h de mock hubo 74 intenciones nuevas, 41 cumplidas, 4 olvidadas y 2
recordadas tarde (antes de las acciones); con las citas, alrededor de una de cada cuatro se olvida.
Las entrevistas (`pnpm interview --advance 48`) muestran qué recuerda cada uno: tras las acciones,
Carmen recuerda que Lucía le debía el libro de poemas, Lucía que quiere volver a quedar con
Tomás y Hugo conversaciones con varios vecinos (los rumores de Aurora, los planes de Valentina, la
cita de Samuel con Ernesto); antes, cada uno repetía casi siempre el mismo recuerdo.

Qué falta para afirmar algo: comparar configuraciones con los mismos personajes y semillas (A sin
memoria imperfecta, B con olvido y vaguedad, C con personalidad y ánimo, D completa), con varias
semillas y al menos dos modelos reales, y una evaluación humana ciega de verosimilitud,
diversidad y coherencia. Las cinco familias de métricas propuestas: precisión y degradación de
los recuerdos frente a lo que pasó, consistencia de decisiones y compromisos, evolución de los
vínculos, coste y latencia por día de juego, y juicio humano.

### Métricas de evolución

La pestaña de admin **Evolución** (`GET /api/worlds/:id/evolution`) da, por día de juego: parejas
que han hablado (y % de las posibles), concentración de la red y diversidad de interlocutores,
conversaciones (grupo o pareja, turnos, cómo acaban), intenciones, acciones formales frente a
acordadas hablando, cambios de tipo de relación, memoria (reconsolidaciones, olvidos,
archivados), errores del LLM, coste por tarea y por sistema, metas (activas, conseguidas,
abandonadas, progreso y frustración, también por agente) y conocimiento externo (anacronismos y
referencias, con ejemplos), más las cifras de cada sistema.
`pnpm study:analyze` calcula lo mismo con una partida grabada. Ver
[evolución](../decisiones/evolucion.md).

Fase de cimientos (`cost:report 48`, mock; coste estimado con los tokens del mock a precios de
Haiku 5.5 y Sonnet 5.5): de 4.420 llamadas y ≈ 0,94 $ a 3.791 y ≈ 0,65 $, con el puente de los
acuerdos ya puesto. Detalle por paso en [el historial](../historial.md#cimientos-fase-0).

Mundo de la época y metas (entonces, 1996; mismo método): de 3.791 llamadas y ≈ 0,65 $ a 4.131 y ≈ 0,79 $. No hay
tareas nuevas: el prompt fijo crece con la biblia y el perfil (casi todo leído de caché), el plan
y la consolidación llevan las metas, y el mock cambia de trayectoria con las semillas nuevas.
Detalle en [el historial](../historial.md#mundo-y-metas-fases-1-y-2).

Desarrollo y aprendizaje (mismo método): de 3.525 llamadas y ≈ 0,74 $ a 3.442 y ≈ 0,79 $. Más
contexto por decisión (lo que sabe hacer, con quién aprender, los saberes que puede contar, y las
acciones nuevas en el prompt fijo): 623 → 684 tokens no cacheados por decisión. Los saberes en
cada decisión con alguien delante lo subían a ≈ 0,92 $: van como mucho cada 3 h. Detalle en
[el historial](../historial.md#desarrollo-y-aprendizaje-fase-3).

Corrección 2.5 (de la segunda partida de estudio; mismo método): de 4.131 llamadas y ≈ 0,79 $ a
3.525 y ≈ 0,74 $. Las fichas suben menos por charla (rendimientos decrecientes) y en el mock eso
deja menos charlas (524 → 384 respuestas), y por tanto menos decisiones, importancias y fichas;
la consolidación y el plan, igual. Las metas conseguidas en 48 h bajan de 9 a 3: con tema, el
mock ya no cumple proyectos con cualquier charla. Detalle en
[el historial](../historial.md#corrección-25).

Corrección 3.5 (de la tercera partida de estudio; mismo método): de 4.028 llamadas y ≈ 0,85 $ a
3.632 y ≈ 0,80 $. El efecto de espaciado deja estabilidades menores (más esencias, muchos menos
resúmenes por presupuesto: 77 → 3) y la enseñanza repetida deja menos vínculo, así que hay algo
menos de charla (533 → 434 respuestas). El prefijo común del prompt fijo, con su propio punto de
caché, no se ve en el mock: hay que medirlo con el LLM real. Detalle en
[el historial](../historial.md#corrección-35).

### Limitaciones

- No reproduce la memoria humana: son analogías computacionales con parámetros de diseño
  (configurables en `MemoryConfig`), no valores clínicos validados.
- La calibración con el mock puede no trasladarse a modelos reales; el resultado depende de los
  personajes, los prompts, el modelo y la escala de tiempo.
- Rumores, reconstrucciones y falsos recuerdos implican atribuciones erróneas a propósito: por eso
  todo se audita y el inspector separa lo que pasó de lo que cada uno cree recordar.
- Es una simulación experimental, no una representación de personas, poblaciones o trastornos.
  La protección de menores y la moderación necesitan pruebas continuas; no son una garantía
  universal frente a todos los fallos de los modelos.

## Paper

[Lethetown-paper.pdf](paper/Lethetown-paper.pdf): el artículo del proyecto (memoria humana en
agentes LLM: olvido, reconsolidación, confusión de fuentes y falsos recuerdos en un pueblo
simulado). Las cifras salen de los [estudios](#estudios); cada informe dice de qué fichero y con
qué comando (`pnpm study:analyze`).

## Proponer o ejecutar un experimento

Ver [CONTRIBUTING.md](../../CONTRIBUTING.md#proponer-un-experimento).
