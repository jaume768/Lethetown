# Métricas de evolución y análisis de partidas

Objetivo: ver cómo cambia el pueblo día a día (y comparar partidas) con las mismas cifras en la
pestaña de admin y en el estudio de una partida grabada, sin llamadas nuevas al LLM.

## Decisiones

- **Un solo cálculo** (`apps/server/src/analysis/evolution.ts`, puro): eventos de la simulación,
  auditoría de la memoria, historial de las fichas y llamadas al LLM → métricas por día de juego
  y del total. Lo usan `GET /api/worlds/:id/evolution` (pestaña «Evolución», solo admin) y
  `pnpm study:analyze`. El tipo del informe es un esquema zod en shared (`EvolutionReport`).
- **Sin estado nuevo**: todo sale de lo que ya se guarda (`sim_events` con `meta`, `memory_audit`,
  `social_profile_history`, `llm_calls`). Lo que no se guardaba se deduce del texto de los
  eventos («📝 se propone», «terminan de hablar (N turnos; motivo)», «⚠ Error en "tarea"»).
- **Cifras vivas de los sistemas**: cada `SimSystem` aporta `metrics(ctx)`; se piden con la
  orden de solo lectura `metrics` (llega al worker igual que las demás órdenes) junto con
  `MinorGuard.stats()` (bloqueos por error y por contenido).
- **Coste por sistema**: cada sistema puede declarar sus tareas del LLM (`llmTasks`); el resto es
  del núcleo. Hoy ningún sistema hace llamadas propias (el puente va en la tarea `social`).
- **En vivo, el coste por tarea es el total** (el `CostTracker` del mundo no guarda la hora de
  cada llamada); por día solo sale en el análisis de una partida, donde la hora real de
  `llm_calls.at` se pasa a minuto de juego con los eventos grabados.
- **Acciones formales frente a acordadas hablando**: un acuerdo ejecuta la acción formal, que
  deja su propio evento; el primer paso se descuenta de las formales para no contarlo dos veces.
  Las aceptaciones de una cita acordada sí cuentan como `accept_meeting` formales.
- **La pestaña se recalcula cada 30 s**: lee hasta 200 000 filas de cada almacén. Para mundos
  muy largos habría que agregar por día al vuelo; no hace falta todavía.

## Métricas (por día y total)

| Métrica                                                                             | De dónde sale                              |
| ----------------------------------------------------------------------------------- | ------------------------------------------ |
| Frases, parejas que han hablado (y % de las posibles), parejas acumuladas           | eventos `speech` (hablante y destinatario) |
| Concentración: parte de las 4 parejas que más hablan; Gini de las frases por agente | eventos `speech`                           |
| Interlocutores distintos por agente (media y mínimo)                                | eventos `speech`                           |
| Conversaciones (de grupo / de dos), turnos de media, motivo de fin                  | «terminan de hablar (N turnos; motivo)»    |
| Intenciones: propuestas, cumplidas, se le pasan, tarde                              | eventos de memoria 📝 ✅ 🫥 😳             |
| Acciones por tipo: formales, acordadas hablando, que no salieron                    | `meta.action`, `meta.agreed`, `meta.ok`    |
| Cambios de tipo de relación (y cuáles: vecino → amistad…)                           | `social_profile_history`                   |
| Memoria: reconsolidaciones, olvidos, archivados, borrados                           | `memory_audit`                             |
| Errores del LLM por tarea                                                           | eventos de sistema «⚠ Error en "tarea"»    |
| Coste por tarea (llamadas, $, % de caché) y por sistema                             | `llm_calls` o el `CostTracker`             |
| Espera de respuesta (min de juego; s reales si se grabó)                            | `ReplyLatencyMeter` con `wallMs`           |
| Longitud de las frases por estilo (corta, media, larga, menores)                    | eventos `speech` y las semillas            |

## `pnpm study:analyze <carpeta> [<otra>]`

Lee lo que graban `record` (`messages.jsonl`, con la hora real) y `world:export` (una tabla por
fichero, en la carpeta o en `bd/`) y escribe `analysis.json` y `analysis.md` en la carpeta. Con
dos carpetas, la tabla pone las dos partidas y la diferencia (A → B). Sustituye al `analiza.py`
de la partida de estudio (que no está en el repo).
