# Ritmo y habla: progreso

Rama `fix/ritmo-y-habla`. Objetivo: que las conversaciones sean rápidas y naturales con un LLM
real. Decisiones en [docs/decisiones/ritmo.md](docs/decisiones/ritmo.md).

| Paso                                                                    | Estado                               | Commit                                      |
| ----------------------------------------------------------------------- | ------------------------------------ | ------------------------------------------- |
| Quitar el presupuesto de gasto (se controla con el saldo de la API key) | hecho                                | `chore: quitar los límites…`                |
| 1. Turnos reactivos (`SIM_REPLY_DELAY_MINUTES`)                         | hecho                                | `feat(sim): turnos reactivos…`              |
| 2. Importancia por reglas en conversación; reconsolidación tras decidir | hecho                                | `perf(agent-core): importancia por reglas…` |
| 3. Cola LLM con dos prioridades, `LLM_CONCURRENCY` 8, espera por tarea  | hecho                                | `feat(server): cola del LLM…`               |
| 4–5. Habla oral en el prompt fijo; tope en código de `say` y `reason`   | hecho                                | `feat(agent-core): habla natural…`          |
| 6. Las últimas 4 frases en `decide`                                     | hecho                                | `feat: decide ve lo último…`                |
| 7. A más de x10, el reloj va a x10 con conversaciones                   | hecho                                | `feat: a más de x10…`                       |
| 8. Charlas en lote (`CONVERSATION_BATCH`)                               | diseñado, no implementado (opcional) | —                                           |
| Medir y grabar (`latency:probe`, `record`, `world:export`)              | hecho                                | `feat(server): medir y grabar…`             |
| Partida de estudio de 48 h con LLM real y correcciones                  | hecho                                | `fix: correcciones de la partida…`          |

## Coste (`cost:report 48`, mock)

| Etapa                                    | Llamadas | importance | decide | Espera de respuesta |
| ---------------------------------------- | -------: | ---------: | -----: | ------------------: |
| `main`                                   |    3.289 |      1.054 |  1.054 |     6,2 min (p90 9) |
| Paso 1                                   |    4.192 |      1.314 |  1.314 |             1,2 min |
| Paso 2                                   |    3.863 |        801 |  1.387 |             1,5 min |
| Pasos 4–5                                |    3.613 |          — |  1.335 |             1,4 min |
| Paso 6                                   |    3.920 |          — |  1.405 |             2,0 min |
| Final (con las correcciones del estudio) |    4.420 |        876 |  1.503 |     1,7 min (p90 1) |

Hay más llamadas porque hay más conversación (las respuestas llegan antes y las charlas tienen
más turnos) y porque los agentes con hambre o soledad extremas ahora deciden. Por turno de
conversación hay menos llamadas: sin `importance` dentro de la charla y con la reconsolidación
fuera del camino crítico.

## Con el LLM real

Partida de estudio de 48 h (Haiku 5.5 / Sonnet 5.5, x10, 20 agentes): 3,65 $, 1.043 frases y una
espera media de 10,1 s reales entre una frase y su respuesta. El informe y los datos están en
`estudio/partida-2dias/`, fuera del repo.
