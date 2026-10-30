# Ritmo y habla de las conversaciones

Objetivo: que con un LLM real las conversaciones sean rápidas y suenen a gente hablando, sin
disparar el número de llamadas.

## Decisiones

- **Turnos reactivos** (`SIM_REPLY_DELAY_MINUTES`, 1 por defecto). Quien recibe una frase dirigida
  a él piensa a ese minuto, sin esperar a su siguiente tick (10 min). Cada agente tiene un solo
  tick pendiente con un número de generación: adelantarlo invalida el normal, que se vuelve a
  programar después del tick adelantado. Si está pensando, el siguiente tick se adelanta. Solo
  se despierta al destinatario. Al resto del grupo la frase no le pide respuesta (igual que
  antes): despertarlos multiplicaría las decisiones por el tamaño del grupo.
- **Importancia por reglas en una conversación en curso** (`MemoryConfig.heardRating`). A partir
  del segundo turno, lo que se oye no pasa por la tarea `importance`. `rateHeard` usa una base
  más puntos por rumor, por temas de peso (secretos, bodas, despidos, enfermedad) y por palabras
  con carga, con valencia por palabras y por exclamaciones. La primera frase de una conversación
  y todo lo que no se oye siguen valorándose con el LLM. Se descartó pedir importancia y valencia
  dentro de `decide`: obligaría a reescribir el recuerdo después y a hacer más largo el JSON de
  la respuesta urgente.
- **Reconsolidación después de decidir** (`RecallContext.defer`). Los dados del falso recuerdo y
  de la reconsolidación se tiran al recuperar, en el mismo orden del `Rng`. La reescritura con el
  LLM se hace al terminar `decide`, en segundo plano. Hay un cambio pequeño: si un falso recuerdo
  no rellena nada, ya no se intenta además reconsolidar.
- **Cola con dos prioridades** (`LimitedProvider`, `URGENT_TASKS`). Van delante decidir,
  importancia, plan, entrevista y moderación; detrás, esencias, fichas sociales, resúmenes,
  crónicas, consolidación y reconsolidación. Dentro de cada nivel, por orden de llegada. La espera
  en cola se mide por tarea (`lethetown_llm_queue_wait_seconds` y `waitStats()` en
  `/api/admin/health`). `LLM_CONCURRENCY` pasa a 8 por defecto.
- **Habla oral en el prompt fijo**: réplicas cortas (a veces de 1-3 palabras), sin saludar en
  cada turno ni repetir. Cinco réplicas de ejemplo con desacuerdo y preguntas secas.
  `sentenceLength` se expresa en frases (corta: una frase corta o menos; media: una o dos;
  larga: dos o tres como mucho). Los menores, frases cortas y de su edad.
- **Tope en código** (`clipText`, `MemoryConfig.speech`): `say` hasta 90/160/240 caracteres según
  `sentenceLength` (los menores, 120 como mucho) y `reason` hasta 120. Se corta en el último final
  de frase; si no hay, en una palabra con «…». Va en código porque el modelo no siempre obedece
  al prompt.
- **Lo último de la conversación en `decide`**: las 4 últimas frases en orden, las propias como
  «tú: …», con la orden de no repetirlas ni volver a saludar. Sale del `transcript`, así que no
  hay estado nuevo. Cuesta unos 60 tokens no cacheados por decisión.
- **Frenar en conversación** (`SIM_SLOWDOWN_IN_CONVERSATION`, activado por defecto). Por encima de
  x10, mientras haya alguna conversación en el mundo, el reloj va a x10 (`GameClock.setCap`). A
  x60 o x360 una charla de un minuto de juego por turno pasaría en un segundo real: no se podría
  seguir, y además los turnos llegarían antes que las respuestas del LLM. La velocidad elegida no
  cambia (la interfaz la sigue mostrando como elegida); el ritmo real va en `ClockState.rate` y
  la cabecera lo indica. «Mundo visible» es el que corre en ese proceso: sin espectadores ya
  manda `NO_VIEWERS_MODE`.
- **Sin límites de gasto** en el servidor (ver [producción](produccion.md)).

## Pendiente (diseñado, no implementado)

- **Charlas en lote** (`CONVERSATION_BATCH=off|trivial|all`): generar varios turnos de una charla
  trivial en una sola llamada `converse` (ya tiene prioridad alta en la cola), aplicar a cada
  frase los mismos topes (`clipText`) y la protección de menores, emitir las frases espaciadas un
  minuto de juego y guardar un recuerdo por participante («Hablé con X de …»). «Trivial» sería una
  conversación sin rumor, sin tema de peso (`rateHeard` < 5) y sin menores. No se hizo en esta
  rama porque cambia quién decide cada turno (deja de ser cada agente con su memoria) y hace
  falta medirlo aparte con un LLM real.

## Cómo medir

- `pnpm --filter @lethetown/server cost:report 48` (mock, determinista): llamadas por tarea y
  espera media de las respuestas en minutos de juego.
- `pnpm --filter @lethetown/server latency:probe [min] [velocidad]`: corre el mundo en RAM con
  el proveedor de `.env` (gasta de verdad) y da la espera entre mensajes en segundos reales y la
  espera en cola por tarea. Para comparar con otra rama, copia este script y `reply-latency.ts` a
  un worktree de esa rama.
- `pnpm --filter @lethetown/server record <carpeta>`, con `pnpm dev` en marcha: graba una partida
  (todos los mensajes del WebSocket con su hora real y el estado de los agentes cada 10 minutos de
  juego). `world:export <carpeta>` vuelca la BD del mundo a JSONL.
