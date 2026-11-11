# Investigación

[English](README.en.md)

Lethetown es un pueblo de 20 vecinos movidos por un LLM con una memoria que **se parece a la
humana**: olvida, se vuelve vaga, se reescribe al recordar y confunde quién le contó qué. La
pregunta: **¿qué pasa en un pueblo cuando la memoria de sus habitantes deja de ser un registro
fiable e ilimitado?** La hipótesis es que el olvido, la reconstrucción de los recuerdos y las
diferencias psicológicas producen historias individuales y dinámicas sociales más variadas y
verosímiles. Es una hipótesis abierta: los estudios de abajo son observaciones, todavía sin el
mundo de control que la pondría a prueba (ver [preguntas abiertas](../../ROADMAP.md#preguntas-abiertas)).

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

## Paper

En [`paper/`](paper/README.md).

## Proponer o ejecutar un experimento

Ver [COLABORA.md](../../COLABORA.md#proponer-un-experimento).
