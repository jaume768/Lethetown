# Lethetown: tercera partida de estudio (7 días, dos semillas en paralelo, Mallorca 2002)

**Qué se ejecutó:** dos mundos a la vez, cada uno con los 20 vecinos y el LLM real de Anthropic (decisiones, importancia, fichas sociales, reconsolidación y resúmenes con `claude-haiku-5-5`; planes, consolidación y crónica con `claude-sonnet-5-5`). Semillas 7 (`s7`) y 13 (`s13`). Cada mundo fue desde el día 0 a las 06:50 hasta el día 7 a las 06:50: 168 h de juego, x10 de día y noche rápida a x360.
**Fecha:** 3 y 4 de noviembre de 2026, rama `chore/estudio-semana` (desde `main` en `d5801ce`, mundo de 2002). La partida se lanzó desde esta rama, sin fusionarla antes.
**Mundo:** el pueblo inventado del interior de Mallorca, lunes 15 de abril de 2002, con el euro. Bases de datos nuevas y vacías (`lethetown_estudio_s7` y `_s13`). Igual que la partida 2: modo demostración activado (`SIM_DEMO=on`), sin ralentizar por falta de espectadores (`NO_VIEWERS_MODE=off`), `LLM_CONCURRENCY=8`. Con Batch API (`LLM_BATCH=on`, consolidación y crónica) y noche rápida (`SIM_NIGHT_SPEED=360`).
**Cómo se lanzó:** `scripts/estudio-semana.sh` (bases, usuario director, un servidor «todo en uno» por semilla en los puertos 3001 y 3002, sin la web y con 4 GB de heap, y `record`). La vigilancia está en [`vigilancia.md`](vigilancia.md).

## Lo que pasó durante la partida

Hubo un arranque fallido y dos paradas. Ninguna obligó a tirar la partida.

1. **Clave de la API inválida** (`401 invalid x-api-key`). Se paró a los 10 min de juego, sin gasto, y se empezó de cero con la clave buena. Los logs de ese intento están en `fallido-401/`.
2. **Día 0, 23:00: falsa alarma de coste.** La vigilancia dividía lo gastado entre la parte del día transcurrida, justo después de pagar la consolidación de la noche, y daba 2,52 $ por día. El día entero costó 1,74 $ (s7) y 1,46 $ (s13). Al revisar la parada salió un fallo real:
   - **La Batch API no se usaba.** Anthropic rechazaba todos los lotes: «The `fallbacks` parameter is not supported for batch requests».
   - La consolidación se repetía por la vía normal, a precio completo.
   - Se arregló en `ad112f2` y se comprobó con un lote real. Los mundos se reanudaron desde su instantánea; la crónica del día 0 se pidió a mano.
3. **Día 3, 15:30: parada real** (s13 con 21 errores en una hora). No eran del LLM, sino ticks perdidos: Postgres rechazaba el UPDATE de `memories` porque la `stability` de algunos recuerdos llegaba a **3,8·10³⁸ h**, fuera del rango de `real`.
   - Cada evocación la multiplicaba por 1,8–3,6 sin tope. Las metas, evocadas en cada decisión, acumularon hasta 142 evocaciones.
   - Se arregló en `9e87684` con `decay.maxStabilityHours` (10 años de juego); el test dorado cambió. Se reanudó desde la instantánea, con unos 15 min reales parados cada vez.

Además, `record` admite ahora `--until <minuto de juego>`: al relanzarlo termina en el día 7 a las 06:50 y no vuelve a contar 168 h.

## Datos (en esta carpeta, fuera de git)

| Fichero                                         | Contenido                                                                      |
| ----------------------------------------------- | ------------------------------------------------------------------------------ |
| `s7/`, `s13/` · `messages.jsonl`                | Mensajes del WebSocket con la hora real                                        |
| `s7/`, `s13/` · `states.jsonl`                  | Estado de los 20 agentes cada 10 min de juego (con la hora real)               |
| `s7/bd/`, `s13/bd/`                             | `world:export` de cada base (recuerdos, auditoría, metas, saberes, llm_calls…) |
| `s7/`, `s13/` · `analysis.md` · `analysis.json` | `pnpm study:analyze` de cada semilla                                           |
| `compare-s7-s13.log`                            | La comparación de las dos semillas (`study:analyze s7 s13`)                    |
| `extract-s7.txt`, `extract-s13.txt`             | Cifras de las preguntas pendientes (metas, intenciones, saberes, PersonGuard…) |
| `server.log`, `record.log` · `vigilancia.md`    | Logs de cada servidor y de la grabación; el registro de la vigilancia (en git) |

Los datos brutos de la partida 2 no están en esta máquina: la comparación con ella usa las cifras de [su informe](../e2-partida-3dias-metas/ESTUDIO.md).

## Resumen en cifras

|                                | s7 (semilla 7)                                 | s13 (semilla 13)                               |
| ------------------------------ | ---------------------------------------------- | ---------------------------------------------- |
| Coste                          | **8,35 $** (1,19 $ por día)                    | **10,03 $** (1,43 $ por día)                   |
| Coste por día de juego         | 1,74 · 1,02 · 1,06 · 1,18 · 1,14 · 1,06 · 1,15 | 1,46 · 1,07 · 1,31 · 1,47 · 1,44 · 1,57 · 1,71 |
| Llamadas                       | 15.304                                         | 14.364                                         |
| Frases                         | 2.421 en 600 conversaciones (12 de grupo)      | 2.109 en 525 conversaciones (10 de grupo)      |
| Espera entre frase y respuesta | 1,8 min de juego, 11 s reales                  | 1,8 min de juego, 11 s reales                  |
| Red                            | 39,5 % de las parejas; Gini 0,31               | 43,2 % de las parejas; Gini 0,25               |
| Intenciones                    | 705 propuestas, 518 cumplidas (73 %)           | 617 propuestas, 479 cumplidas (78 %)           |
| Metas                          | 68 conseguidas, 2 abandonadas                  | 58 conseguidas, 4 abandonadas                  |
| Metas vitales cumplidas        | 7 de 20                                        | 5 de 20                                        |
| Vecinos que se van             | 0                                              | 0                                              |
| Enseñar / ayudar               | 99 sesiones, 35 ayudas                         | 81 sesiones, 20 ayudas                         |
| Saberes                        | 21 aprendidos, 0 deformados, 0 perdidos        | 16 aprendidos, 1 deformado, 0 perdidos         |
| Anacronismos                   | 0                                              | 0                                              |
| Errores del LLM                | 5 (2 JSON mal formados, 3 fuera del esquema)   | 3 (2 cortes de red, 1 JSON mal formado)        |
| Ticks perdidos (estabilidad)   | 6                                              | 20                                             |
| Memoria del servidor           | 350–490 MB                                     | 360–490 MB                                     |

**Las dos semillas comparten la caché de prompts.** Tienen las mismas semillas de personajes, la misma cuenta y el mismo prompt fijo, y planifican en el mismo segundo de cada mañana.

- s13 escribió casi toda la caché: 564.000 tokens de escritura en el plan.
- s7 la leyó: 652.000 tokens de lectura, frente a 242.000 en s13.
- El plan sale a 1,45 ¢ por llamada en s7 y 2,57 ¢ en s13; la consolidación, a 1,53 ¢ y 1,88 ¢.

Así que **el reparto del coste entre las dos es arbitrario**. La cifra honesta es la suma: **18,38 $ por las dos, 1,31 $ por mundo y día de juego**. Un mundo solo costaría como s13, unos 1,4 $ por día.

### Coste por tarea (las dos semillas)

| Tarea                | Llamadas |  Coste | Lectura de caché (s7 / s13) |
| -------------------- | -------: | -----: | --------------------------: |
| plan (Sonnet)        |      280 | 5,63 $ |                 63 % / 23 % |
| consolidate (Sonnet) |      280 | 4,78 $ |                 40 % / 20 % |
| decide               |   10.655 | 4,45 $ |                 74 % / 75 % |
| importance           |    7.695 | 1,11 $ |                 93 % / 93 % |
| social               |    2.652 | 0,89 $ |                 80 % / 82 % |
| reconsolidate        |    3.382 | 0,64 $ |                 94 % / 93 % |
| gist + summarize     |    4.620 | 0,76 $ |                     87–92 % |
| chronicle (Sonnet)   |       14 | 0,11 $ |                         0 % |
| moderate_minor       |       62 | 0,00 $ |                             |

**Lectura:**

- **Más barato que la partida 2:** 1,31 $ por mundo y día, frente a 1,63 $. Y eso que ahora hay habilidades, saberes, intenciones con tope y el mundo de 2002 en el prompt fijo. La caché compartida explica parte; la Batch API, otra.
- **El plan es ahora la tarea más cara** (31 %). Es una llamada de Sonnet por vecino y día y, en el mundo que va primero, sin caché.
- **La consolidación cuesta la mitad desde que funciona la Batch API.** La noche 0, a precio completo, costó 1,19 $ entre las dos semillas; las noches 1 a 6, 0,60 $ de media. En s7 bajó de 3,3 ¢ a 1,2 ¢ por llamada (lote más caché de s13); en s13, de 2,7 ¢ a 1,7 ¢.

### Tiempo real: la noche rápida y los lotes

| Día de juego (06:50 → 06:50) | s7 (h reales) | s13 (h reales) | Noche 22:00 → 06:30 (min reales) |
| ---------------------------- | ------------: | -------------: | -------------------------------: |
| día 0                        |          1,81 |           1,82 |                          16 / 17 |
| días 1 a 6 (media)           |          1,79 |           1,76 |                          14 / 12 |
| a x10 sin noche rápida       |          2,40 |           2,40 |                               51 |

- **Una semana de juego, en 12,5 h reales en vez de 17.** La noche baja de 51 a 11–17 min reales:
  - de 22:00 a 23:15–00:40 va a x10: consolidación (en lote, unos minutos), crónica de las 23:00 y 15 min de juego de calma;
  - después, unos 70 s a x360 hasta las 06:30.
- **Una subida y una bajada por noche en 12 de las 14 noches.** En dos noches de s7 se cortó una vez porque empezó una llamada que no era de mantenimiento («quedan tareas del LLM pendientes»), y volvió a acelerar 16–20 min de juego después. Siempre volvió a x10 a las 06:30, y nadie se despertó con la consolidación a medias.
- **Los lotes y la noche rápida conviven:** mientras se consolida, el mundo va a x10 y la regla `LLM_BATCH_MAX_SPEED` se cumple. El precio es que la noche espera al lote, unos minutos en esta partida.

## Hallazgos

### 1. PersonGuard: casi no repite decisiones, pero sus repeticiones son casi todas falsos positivos

|                                             |     s7 |    s13 |
| ------------------------------------------- | -----: | -----: |
| Decisiones repetidas con el aviso           |      3 |      9 |
| … de 5.514 / 5.141 decisiones               | 0,05 % | 0,18 % |
| Nombres cambiados por «alguien»             |     18 |     30 |
| «Posible persona inventada» (solo se anota) |      9 |     17 |

**De las 12 repeticiones, solo una es una persona inventada de verdad:** Ernesto, otra vez, con «la señora Pepa»: «¿Te has enterado de lo de la señora Pepa? Dicen que le llegó una carta de Palma». Es la misma chismosa inventada que en la partida 2. Las demás son falsos positivos:

- **Apodos de vecinos (7 de 12):** «Rafa» es Rafael. Hugo, que le debe dinero, lo llama así en las dos semillas: «Rafa, ya te lo pago, de verdad. Esta semana, lo prometo». Cada vez se repite la decisión.
- **Siglas de estudios:** «la PAU» (Samuel a Clara: «Pues la PAU, en junio, y con buena nota») y, entre los cambiados por «alguien», «el BUP» (8 veces en s7).
- **Gente de fuera que el que habla conoce por otro:**
  - Clara habla de Alma, la amiga de su abuela, después de que Aurora le contara «El verano en que Alma se fue».
  - Andrés menciona a Francisca, la difunta de Julián.
  - Mateo nombra a Joana (de fuera, de la semilla de Aurora).

  `PersonGuard` no cuenta lo aprendido por los saberes.

- **Entre los cambiados por «alguien»** también hay ruido:
  - infinitivos tras una coma en las listas del plan: «mi madre, Abrir», «mi abuela, Pasear»…, unos 20;
  - «el Ajuntament» (9);
  - «el Fela» (8): Fela Kuti, del que habla Hugo con Samuel, que llegó de Lagos: «A ver si adivinas esto. ¿Fela o no?».

**¿Aparecen personas inventadas?** Muy pocas, y ninguna se convierte en una saga como la Pepa de la partida 2 (23 recuerdos). Las únicas claras son «la señora Pepa» (s13), «Toni el del taller», «el Pep» y algún «Pau» o «Pablo» suelto. La regla del prompt basta; lo que sobra es el ruido de la lista de nombres.

### 2. Metas: proyectos nuevos y abandonos con sentido; las metas vitales se cumplen demasiado deprisa

**Funciona lo que fallaba en la partida 2:**

- **Proyectos nuevos: 56 (s7) y 45 (s13)**, frente a 0. Más 27 y 33 pasos nuevos. Algunos con muy buena pinta:
  - Samuel: «Seguimiento médico de Ernesto: que acuda al consultorio a revisarse el pecho y la tensión».
  - Aurora: «Enseñarle a Clara a hacer pan con aceite y tomate».
  - Sofía: «Ir al lago con Leo a mirar bajo las piedras con red y cubo».
- **Descartadas al proponer:** 12 y 5 «porque ya tiene 3 proyectos activos», y 7 y 6 «porque ya sabe eso».
- **Abandonos: 2 y 4, con historia:**
  - **Rafael, en s7**, abandona dos proyectos para la taberna:
    - día 3: «Que la gente venga a la taberna por las tardes» (frustración 0,81);
    - día 6: «Que Hugo cante en la taberna y se haga una tarde de música con el pueblo» (0,85), y con él, el paso que colgaba.

    Acaba la semana con su meta vital («Que la taberna sea el corazón del pueblo») en 0,25 y la frustración más alta del pueblo.

  - **Sofía, en s13**, abandona «Que Inés vuelva a clase con ganas» (frustración 0,96).
  - **Inés, en s13**, abandona «Aprender a fotografiar con Valentina» (0,73), aunque fotografía llega a «con maestría».
  - **El único cambio de rumbo razonado:** Andrés deja «Dejar a Sofía el atlas y los cuentos de peces en la escuela antes del jueves» porque «Sofía se lo llevó ella».
- **Frustración media al final:** 0,19 y 0,30 (0,06 en la partida 2). Con una semana ya se ven abandonos, y no son masivos.

**Confirmaciones nocturnas: no son demasiado fáciles, más bien exigentes.**

- **De las metas cualitativas (`confirmed`), se confirmaron 0 de 14 en s7 y 2 de 9 en s13.** Cuando dice «aún no», el motivo es concreto:
  - Julián, en s7: «Preguntó por cuándo se iría a Palma, pero esquivó el tema y no le dijo que…».
  - Valentina: «Mateo solo ha prometido contármelo mañana a las seis; todavía no me ha c…».
- **La confirmación más bonita, en s13:** Julián «Contarle a Inés, durante la cena, que me da miedo quedarme solo». Es lo que en la partida 2 no llegaba nunca («Mañana hablamos de Palma. Con calma…»):
  - lo intenta el día 2 («Inés… me da miedo quedarme solo aquí. Eso es.») y el 3, en la cena («de noche se me hace grande la casa»);
  - el día 4 por la noche se lo propone como meta;
  - el día 5, a las 20:16, en la cena: «Inés… me da miedo quedarme solo. Si no es molestia.». Inés: «Ya, papá. Pues no te quedes solo, joder. Cenamos juntos, ¿vale?» y, más tarde, «Papá, hoy sin disculpas, ¿vale?».

  Esa noche (22:13) la consolidación lo comprueba: «se ha logrado: Julián le dijo: “Inés… me da miedo quedarme s…”».

**Lo que no:**

- **Siete metas vitales cumplidas en una semana (s7) y cinco (s13).** Casi todas, por el criterio «conseguir 4 de sus proyectos», y medir no es conseguir:
  - Leo «consigue» «Encontrar el pez gigante del lago» en los dos mundos (día 3 o 4), sin encontrarlo: el día 6 sigue proponiéndose «ir al lago con Sofía y la red para pescar al pez gigante».
  - Valentina «consigue» «Descubrir qué pasó con mi abuela» en s13 (día 5, 12:28), y el día 6 sigue preguntando: «Aurora, ¿conoce a una Alma? Vivió aquí de joven.».
  - Hugo «vive de la música» en los dos mundos.
- **Nadie se va.** Clara llega a 0,84 de «Estudiar enfermería en Palma» en s13 y está a punto.
- **La meta vital de Inés** queda en `postponed` en las dos semillas (es menor de edad).

### 3. Intenciones: muchas más se cumplen, y el tope funciona

|                              |      s7 |     s13 |
| ---------------------------- | ------: | ------: |
| Propuestas                   |     705 |     617 |
| Cumplidas                    |    73 % |    78 % |
| Se le pasan / tarde          | 72 / 38 | 56 / 36 |
| Fusionadas con otra igual    |     274 |     168 |
| Descartadas por el tope (8)  |     137 |      63 |
| Olvidadas                    |      84 |      65 |
| Caducadas (poco importantes) |       3 |       3 |

- **Se cumplen el 73–78 %, frente al 46 % de la partida 2.** El tope y la fusión quitan lo que se repetía.
- **Las fusiones son correctas:** «pagarle a Rafael lo que le debo» es lo mismo que «devolverle a Rafael el dinero que le debo», y se queda una, reforzada.
- **Hugo es el que más choca con el tope:** deja de lado «tocarle una canción a Rafael en la taberna, a cambio de la deuda» por «ir a la cita con…». La deuda con Rafael vuelve a ser, como en las dos partidas anteriores, el hilo más largo del pueblo.
- **Casi nada caduca:** 3 por mundo. Lo poco importante se fusiona o se olvida antes.

### 4. Habilidades y saberes

**Enseñar y ayudar sale con naturalidad, pero algunas parejas lo repiten:**

- Entre 9 y 14 sesiones al día entre 20 vecinos: 99 y 81 en total, de las que se terminan 66 y 58. Más 35 y 20 ayudas.
- Lo propone el LLM y suele tener sentido: Tomás enseña a pescar a Leo (4), Sofía enseña a enseñar a Leo, Clara le enseña a Rafael a vender y negociar.
- En s7, entre Mateo y Hugo hay 17 eventos de enseñanza (ofrecerse, aceptar, terminar) y 7 clases terminadas de café y barra. A Hugo le cuesta, pero es mucho para una sola habilidad.

**Ritmo de aprendizaje:**

- **Con maestro y mucha práctica, sí cambian de etiqueta en una semana.**
  - Leo, cocina: de 0,05 a 0,56 (con Carmen) y de 0,05 a 0,61 en s13.
  - Inés, fotografía: de 0,35 a 0,65–0,70 («con maestría» en s13, con Valentina).
  - Leo, pesca: de 0,10 a 0,36–0,38 (con Tomás).
- **Pero casi todo el pueblo sube en cocina, de 0,30 a 0,55–0,60**, con unos 1.300 min de práctica: unas 3 h al día cocinando el desayuno, la comida y la cena. Es práctica de hacer, como se quería, pero iguala a todo el mundo en lo mismo.
- **El olvido es lento, como se quería** (−0,002 en una semana). Pero el día 4, a las 00:00, 8 habilidades por mundo bajan de etiqueta a la vez («3 días sin practicar: ahora principiante»). No es olvido: un valor justo en el límite de la etiqueta cruza la frontera por milésimas.

**Saberes:**

- **Se transmiten 21 (s7) y 16 (s13), y no se pierde ninguno.** La fidelidad media de lo aprendido es 0,97 y 0,92; lo que baja es por cosas que no se quedan («2 de 3 cosas»).
- **Deformados: 1 de 37.** Inés aprende de Ernesto «Las cartas sin remitente» con una variante («siempre en sobre blanco»). Las variantes no bastan: casi nunca se usan.
- **Se cuenta otra vez a quien ya lo sabe.** Aurora le cuenta a Clara «El verano en que Alma se fue» 6 veces (s7) y 11 (s13), y siempre «se queda con 4 de 4 cosas». Encaja con Aurora, que olvida, pero el motor lo ofrece cada vez.
- **La historia de las semillas sale a medias.**
  - En s7, Valentina aprende de Aurora «El verano en que Alma se fue» (día 3). Aurora, cuya memoria empeora, ya no puede ayudarla:
    - día 3: «Alma era pura risa, ay, criatura. Se marchó del pueblo un día y nunca más supe de ella… ¿dónde estaba yo?»;
    - día 4: «Ni idea, criatura. De Alma ya no me acuerdo de eso.».
  - «La canción de las segadoras» la aprenden Clara (de Aurora) y Leo (de Sofía), no Valentina.

**Resultados acumulados, sin consumir:**

| Objeto  |  s7 | s13 |
| ------- | --: | --: |
| verdura |  49 |  38 |
| dibujo  |  32 |  10 |
| pan     |  14 |  16 |
| foto    |  11 |  15 |

Se van acumulando en los inventarios: nadie se come el pan ni las verduras.

### 5. La deriva de la personalidad: igual para casi todos

- **Los 20 vecinos de cada mundo cambian una vez, el día 7 a las 00:00 (el repaso semanal), y como mucho ±0,02 por rasgo.** Es lo que pide `DriftConfig`: lento y auditado.
- **Pero casi todos cambian en la misma dirección:** más ganas de cosas nuevas (+0,016), más constancia (hasta +0,020) y más calma (−0,020). Por ejemplo:
  - Mateo: «enseñar (29), aprender algo (10)…».
  - Leo: «aprender algo (23), metas conseguidas…».
- En una semana buena para casi todos (aprender, enseñar, metas cumplidas), todo empuja igual. Solo Rafael, el de los dos abandonos, gana algo de inquietud (+0,014).

### 6. Red social y conversaciones

|                             | Partida 2 (72 h) |  s7 (168 h) | s13 (168 h) |
| --------------------------- | ---------------: | ----------: | ----------: |
| Frases por día              |              532 |         346 |         301 |
| Turnos por conversación     |              5,1 |         4,0 |         4,0 |
| Parejas que han hablado     |             36 % |      39,5 % |      43,2 % |
| Gini de las frases          |             0,27 |        0,31 |        0,25 |
| Cambios de tipo de relación |      36 (3 días) | 73 (7 días) | 47 (7 días) |
| Fichas con afinidad > 0,8   |                — |   28 de 324 |   28 de 323 |

- **Menos conversaciones también con el LLM real:** 346 y 301 frases al día, frente a 532 en la partida 2. Las fichas sociales que suben más despacio (corrección 2.5) dejan menos charla, como se vio en el mock. La red, aun así, se abre más.
- **Las parejas que más hablan:**
  - s7: Hugo–Valentina (205 frases), Hugo–Rafael (175, la deuda), Carmen–Nuria (145).
  - s13: Carmen–Nuria (141), Ernesto–Rafael (121), Hugo–Rafael (112).
- **Una rivalidad política que nadie sembró, en las dos semillas.** Elena, que quiere ganar las municipales, choca con quien habla de Promociones Llevant:
  - s7, con Ernesto (afinidad −0,8). Ernesto: «¿El futuro? Que no nos lo vendan los de Llevant, ¿eh?». Elena: «Antes de nada, dime de dónde sacas lo de Llevant».
  - s13, con Rafael (−0,84). Elena: «Los Ferrer, ¿qué se dice por el pueblo?». Rafael: «Ni de broma, Elena. Si quieres algo, pídeme una caña».
- **Nuria–Elena (la casa en venta)** sigue en rivalidad estable en las dos (−0,4 / −0,6), como en las dos partidas anteriores.
- **Rafael–Mateo** se reconcilian otra vez y dejan de ser rivales.

### 7. Menores: cuatro bloqueos, los cuatro falsos positivos en familia

1. **s7:** Leo, de 10 años, a su madre Marta: «¡Vale, vale! Ya voy. ¿Me das un beso?». Se bloquea dos veces (el recuerdo de cada uno): «petición de beso en un contexto que no es familiar claro».
2. **s13:** dos textos de Julián sobre su hija Inés, de 16, por ejemplo la reflexión «Se lo dije a medias: que me cuesta estar solo en esta casa…»: «interés romántico de un adulto hacia un menor».

La moderación no sabe que son madre e hijo y padre e hija. Ningún bloqueo se debió a un fallo de la moderación.

### 8. Memoria

- **Reconsolidaciones:** 1.652 y 1.557.
- **Olvidos:** 1.256 y 1.162.
- **Archivados (resumidos):** 10.830 y 9.745, unos 1.500 al día, como en la partida 2.
- **Borrados por el presupuesto:** 2.934 y 2.554.
- **La estabilidad sin tope (hallazgo de la parada 2)** también pasaba en el mock: con el tope, el test dorado cambia desde el día 1 a las 07:10.

Cada evocación cuenta igual aunque sea la del minuto anterior. Lo que se evoca en cada decisión (las metas) acaba siendo imborrable en un par de días.

## Comparación entre las dos semillas

Las cifras se parecen mucho; las historias, no.

| Tema          | s7                                    | s13                                                                 |
| ------------- | ------------------------------------- | ------------------------------------------------------------------- |
| Rafael        | Abandona dos proyectos de la taberna  | La taberna sigue a medias, sin abandonos                            |
| Julián e Inés | Julián esquiva el tema                | Julián le dice el miedo a quedarse solo, y se confirma              |
| Inés          | Fotografía, de 0,35 a 0,65            | Fotografía, de 0,35 a 0,70, pero abandona el proyecto con Valentina |
| Valentina     | Aprende la historia de Alma de Aurora | No la aprende, aunque «consigue» su meta vital                      |
| Coste         | 8,35 $ (leyó la caché)                | 10,03 $ (la escribió)                                               |

**Lo que se repite en las dos** apunta al diseño y no al azar:

- la deuda de Hugo;
- Nuria contra Elena;
- Elena contra el rumor de Llevant;
- Aurora contando una y otra vez lo de Alma;
- Leo encontrando el pez sin encontrarlo;
- «Rafa».

## Comparación con la partida 2

|                         | 2.ª (72 h, mundo y metas, 1996) | 3.ª (168 h, s7 / s13, 2002) |
| ----------------------- | ------------------------------: | --------------------------: |
| Coste por mundo y día   |                          1,63 $ |  1,19 / 1,43 $ (1,31 media) |
| Errores del LLM         |                               0 |                       5 / 3 |
| Frases por día          |                             532 |                   346 / 301 |
| Parejas que hablan      |                            36 % |                 40 % / 43 % |
| Intenciones cumplidas   |                            46 % |                 73 % / 78 % |
| Proyectos nuevos        |                               0 |                     56 / 45 |
| Metas abandonadas       |                               0 |                       2 / 4 |
| Metas vitales cumplidas |                               0 |                       7 / 5 |
| Anacronismos            |                               0 |                       0 / 0 |
| Personas inventadas     |       1 (la Pepa, 23 recuerdos) |     2 o 3 sueltas, sin saga |
| Horas reales por día    |                             2,4 |                         1,8 |

## Correcciones que salen de este estudio

1. **PersonGuard:**
   - Aceptar los apodos de los vecinos («Rafa» por Rafael: un hipocorístico en la semilla o un prefijo de un nombre conocido).
   - Ignorar las siglas de estudios y las instituciones («BUP», «PAU», «Selectividad», «el Ajuntament»).
   - Tratar la coma como inicio de elemento en las listas del plan (ya se propuso para el registro de conocimiento en la partida 2).
   - Contar como conocida la gente que aparece en un saber aprendido (Alma, para Clara) y la de fuera de los vecinos con quien se tiene trato (Francisca, para Andrés).
   - Bien ajustado, de 12 repeticiones quedaría 1.
2. **Moderación de menores:** pasar el parentesco al moderador («Marta es la madre de Leo»), o no mandar a moderar lo que pasa entre padres e hijos sin términos fuertes. Los 4 bloqueos de la semana eran de familia.
3. **Metas vitales:** que no se cumplan solo por contar proyectos. Por ejemplo, exigir también la comprobación nocturna (`confirmed`) del enunciado, o que uno de los proyectos lleve el criterio de la meta. Leo y Valentina «consiguen» lo que siguen buscando.
4. **Saberes:**
   - No ofrecer `share_lore` a quien ya tiene ese saber completo y lo oyó hace poco (Aurora a Clara, 11 veces).
   - Subir la probabilidad de deformación: en una semana, 1 de 37.
5. **Habilidades:**
   - Histéresis en las etiquetas, para que una milésima no las cambie (8 bajadas a la vez el día 4).
   - Que comer o preparar la comida de cada día cuente menos que cocinar algo de verdad, o cueste más practicarlo: todo el pueblo sube en cocina.
6. **Resultados:** que el pan y las verduras se consuman o se regalen. Se acumulan sin uso (49 cestas de verduras en s7).
7. **Personalidad:** pesar también lo malo de la semana (conflictos, planes que fallan, soledad), para que la deriva no sea igual para todos. Sigue pendiente que el perfil de memoria y el ánimo base sigan la deriva.
8. **Memoria (efecto de espaciado):** que la estabilidad crezca según el tiempo desde la última evocación. Evocar algo cada 10 minutos no debería consolidarlo como evocarlo cada día. El tope de 10 años evita el desbordamiento, pero no esto.
9. **Partidas en paralelo:** sumar el coste de los mundos que comparten caché, o lanzarlos desfasados. Para el registro de conocimiento externo, añadir a `commonReferences` a Fela Kuti (85 detecciones en s13, todas de Hugo y Samuel) y a Bob Dylan.
10. **Vigilancia:** el coste, por día de juego cerrado (no extrapolado); los errores del LLM, aparte de los de tick. Ya está así en `vigilancia.md`.
