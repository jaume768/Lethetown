# Lethetown: segunda partida de estudio (72 horas, Mallorca 1996 y metas)

**Qué se ejecutó:** los 20 vecinos con el LLM real de Anthropic (decisiones, importancia, fichas sociales, reconsolidación y resúmenes con `claude-haiku-5-5`; planes, consolidación y crónica con `claude-sonnet-5-5`), a x10, desde el día 0 a las 06:51 hasta el día 3 a las 06:51 (72 h de juego, 7,2 h reales).
**Fecha:** 31-10-2026, `main` en `acca192` (fases 1 y 2: mundo de 1996, conocimiento y metas, más el arreglo de los topes de salida).
**Mundo:** un pueblo inventado del interior de Mallorca, lunes 15 de abril de 1996. Base de datos nueva y vacía. Modo demostración activado (`SIM_DEMO=on`: el tiempo cambia según el clima de la estación, hay averías y alguna ocurrencia de la voz interior). Sin espectadores no se ralentiza (`NO_VIEWERS_MODE=off`). Sin Batch API, como en la primera partida.

**Dos arranques fallidos antes de esta partida:**

1. La clave de la API no era válida: todas las llamadas devolvían `401`. Se tiró entera.
2. Con la clave buena, a las 12 h de juego llevaba 88 errores «La respuesta no contiene JSON». Las respuestas se cortaban en el tope de tokens de salida: 38 de 214 fichas sociales y 31 de 460 importancias llegaban exactamente a 400 tokens. Se arregló en `35f2c1d`, con topes holgados en `llm/limits.ts`, y la partida empezó de cero.

## Datos (en esta carpeta, fuera de git)

| Fichero                         | Contenido                                                                                                                     |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `messages.jsonl`                | Todos los mensajes del WebSocket con la hora real (36.500).                                                                   |
| `states.jsonl`                  | Estado de los 20 agentes cada 10 min de juego.                                                                                |
| `bd/*.jsonl`                    | Tablas del mundo: recuerdos, auditoría, fichas, llamadas al LLM, metas (`goals`), registro de conocimiento (`knowledge_log`)… |
| `analysis.md` · `analysis.json` | Salida de `pnpm study:analyze` (todas las cifras de este informe salen de ahí o de `bd/`).                                    |

## Resumen en cifras

|                                |                                                                                              |
| ------------------------------ | -------------------------------------------------------------------------------------------- |
| Coste total                    | **4,90 $** en 72 h (1,84 / 1,45 / 1,58 $ por día). 6.564 llamadas.                           |
| Frases                         | 1.596 en 312 conversaciones (10 de grupo); 5,1 turnos de media                               |
| Espera entre frase y respuesta | Media 10,3 s reales, 1,7 min de juego (igual que en la primera partida)                      |
| Red                            | El 36 % de las parejas posibles ha hablado; Gini 0,27; las 4 parejas que más hablan, el 22 % |
| Intenciones                    | 597 propuestas; 274 cumplidas, 15 se le pasan, 3 recordadas tarde                            |
| Metas                          | 27 conseguidas (19 proyectos y 8 pasos), 0 abandonadas, 0 vecinos se fueron                  |
| Conocimiento                   | 0 anacronismos; 134 «referencias externas» (casi todas falsos positivos)                     |
| Memoria                        | 788 reconsolidaciones, 451 olvidos, 4.522 archivados (resumidos), 714 borrados               |
| Errores del LLM                | **0** (en la primera partida, 30; en el arranque fallido, 88 en 12 h)                        |

### Coste por tarea

| Tarea                | Llamadas |  Coste | Lectura de caché | Salida media (máx.) |
| -------------------- | -------: | -----: | ---------------: | ------------------: |
| consolidate (Sonnet) |       60 | 2,16 $ |              0 % |       1.065 (1.524) |
| decide               |    2.739 | 1,00 $ |             74 % |           308 (850) |
| plan (Sonnet)        |       60 | 0,92 $ |             54 % |           598 (767) |
| importance           |    1.572 | 0,26 $ |             84 % |            59 (504) |
| social               |      802 | 0,24 $ |             82 % |           284 (911) |
| reconsolidate        |      835 | 0,13 $ |             91 % |           127 (592) |
| gist + summarize     |      488 | 0,14 $ |          63–71 % |        47–134 (291) |
| chronicle (Sonnet)   |        3 | 0,05 $ |              0 % |           443 (463) |

**Lectura:**

- Por día de juego cuesta menos que la primera partida: 1,63 $ frente a 1,83 $, aunque ahora el prompt fijo lleva la biblia del mundo y el perfil de cada uno, y el plan y la consolidación llevan las metas. El resumen pasó a Haiku y resume menos a menudo.
- La consolidación nocturna es ya el 44 % del gasto, con caché nula: cada agente la llama una vez por noche.
- Las salidas máximas confirman el arreglo de los topes: `social` llegó a 911 tokens, `moderate_minor` a 607, `reconsolidate` a 592 e `importance` a 504. Con los topes de antes (400, 200, 300 y 400), todas esas respuestas se habrían cortado.

## Hallazgos

### 1. El mundo de 1996 se nota y no se rompe

- **0 anacronismos** en 72 h: ni un móvil, un euro ni internet en 1.596 frases, ni en los planes, recuerdos o crónicas.
- La época sale sola, sin forzarla:
  - Valentina enseña a Inés a cargar el carrete: «Primero a la sombra, que el sol te quema el carrete».
  - Julián cobra «trescientas pesetas…».
  - Ernesto, el cartero: «yo le llevo cartas a esa casa y ya no llega nada».
  - Mateo: «eso son líos de Palma».
- La cultura local entra con naturalidad, sin caricatura:
  - el pa amb oli aparece 11 veces y la ensaimada, 24.
  - Tomás a Pilar: «Cuarenta y cinco años aguantándome, mujer. Y todavía me pones el pa amb oli como a un señor».
  - Mateo a Inés: «¿Otra ensaïmada, chiquilla? Invita la casa».
- **Promociones Llevant**, la empresa inventada del glosario, sale 50 veces. Rafael y Ernesto la convierten en el rumor del pueblo: «ya se oye que la quieren los de Promociones Llevant».
- Las crónicas también suenan a pueblo: «Café, huerto y un pez que nadie vio», «Día de tormenta, café y secretos a medias» y «Riego a las seis y secretos de la colina».

### 2. Una vecina que no existe: «la Pepa»

Es el hallazgo más curioso, y lo detectó el registro de conocimiento externo.

1. **Día 0, 19:38.** Ernesto le dice a Rafael en la taberna: «Pues me lo ha dicho la Pepa, que la vio hablar con alguien de Palma en la puerta. Pero no te fíes, ya sabes cómo es». En el pueblo no vive ninguna Pepa.
2. Rafael le sigue el juego: «Ya, la Pepa y sus historias. Pero algo habrá, ¿no?». Desde ese momento es una vecina más para los dos.
3. **20:51.** Ernesto se propone «preguntar a la Pepa si la han llamado de Promociones Llevant»: una intención (memoria prospectiva) que apunta a alguien que no existe.
4. **Día 1, 20:42.** Rafael: «Y ni una palabra a la Pepa». Ernesto: «si se entera la Pepa, ya sé de quién ha sido».
5. Al final hay 23 recuerdos con la Pepa, todos de Rafael y Ernesto. Cada uno la «aprendió» del otro: el sistema de aprender de otros guardó «Ernesto me contó algo de Pepa» con su fuente.

**Qué muestra:** los dos chismosos del pueblo crean una tercera chismosa y la sostienen con la misma maquinaria que hizo real la deuda de Hugo en la primera partida: intenciones, reconsolidación y fichas. El registro la marca como referencia externa (26 veces), pero no tiene forma de saber que «Pepa» es una vecina inventada y no alguien de fuera.

### 3. Metas: se mueven, pero se atascan a mitad de camino

Lo que funciona:

- **Conseguidas: 27**, repartidas entre 15 vecinos. Algunas con buena historia:
  - Lucía termina los dibujos del cuento (día 1).
  - Hugo «estrena la canción del lago en la plaza», un paso que se propuso él.
  - Rafael consigue «cobrar a Hugo algo de lo que me debe del verano». La deuda de la primera partida vuelve, ahora como meta medida: «¿me das un pa amb oli y me lo apuntas? Ya te lo pago, de verdad», y Rafael le contesta «tomate rojo y a pagar».
- **Los pasos que propone el LLM son buenos y medibles**:
  - Valentina: «enseñar a Inés a cargar el carrete y charlar con Aurora».
  - Andrés: «acudir a la cita con Sofía en el huerto y llevarle el libro de insectos».
  - Clara: «ir mañana a la consulta de Samuel a hablar de Palma».

Lo que no:

- **De 49 propuestas del modelo, 35 se descartaron por la misma regla**: «un paso tiene que ser de uno de sus proyectos». El modelo propone pasos sin decir de qué proyecto son, o colgados de la meta vital. Se perdieron, por ejemplo:
  - Julián: «hablar con Inés sobre su idea de ir a estudiar a Palma».
  - Mateo: «hablar con Rafael y arreglar lo de las tardes».
- **No propuso ni un proyecto nuevo.** Como la meta vital pide dos proyectos más que los de partida, siete metas vitales se quedan exactamente en 0,50: sus dos proyectos están hechos y no hay más que contar. Al final del día 3, ninguna meta vital se ha cumplido ni podía cumplirse.
- **Medir no es lo mismo que conseguir.** Julián consigue «hablar de verdad con Inés» (día 2, 16:11), porque el criterio cuenta conversaciones. Pero la conversación de verdad nunca llega:
  - Julián, día 0: «Si quieres, mañana hablamos de Palma».
  - Julián, día 2: «Mañana hablamos de Palma. Con calma… si no es molestia».
  - Inés, día 2, 21:32: «Y lo de Palma, ¿qué? Me dijiste mañana ayer».

  Es fiel a la semilla de Julián («no sé cómo decirle que me da miedo quedarme solo») y es de lo mejor de la partida, pero el contador lo da por hecho.

- **Las metas de relación se cumplen demasiado deprisa.** Mateo llega a afinidad 0,8 con Lucía a las 10:00 del día 0, y Andrés con Sofía esa misma noche. Las fichas sociales suben 0,05–0,1 por charla, así que un objetivo de +0,2 dura medio día.
- **Nadie abandona ni se frustra**: la frustración media acaba en 0,06 y la máxima es la de Lucía, 0,21. Con los parámetros actuales hacen falta unos 6 días sin avanzar para llegar a 0,7. Tres días no bastan para ver abandonos ni cambios de rumbo.
- **Nadie se va del pueblo**: Clara va por el 12 % de «estudiar enfermería en Palma».

### 4. Los conflictos sembrados toman caminos distintos

- **Rafael y Mateo (los clientes de la tarde)**:
  - Empiezan en rivalidad: −0,35, más el −0,05 que pone el sistema al detectar que sus metas chocan.
  - En tres horas de juego, pacto: «Mateo aceptó quitar mesas de la terraza por la tarde para no robarle clientes».
  - El día 1 a las 13:14 ya son amigos.
  - Cuando Mateo consigue «que el café se llene por las tardes» (día 1, 17:04), Rafael pierde afinidad («se salió con la suya») y la ficha baja de amistad a vecino. Se recupera al día siguiente.
  - Es el primer caso en que dos metas en conflicto se ven en una ficha, y en los dos sentidos.
- **Nuria y Elena (la casa en venta)**:
  - Rivalidad estable de principio a fin: afinidad −0,49 y −0,52.
  - Nuria vuelve a usar el tablón, como en la primera partida, ahora dos veces: «Se busca gente para el jardín de la casa vacía. Sábado a las 10:00, en el huerto. Traed guantes».
  - Consigue «juntar vecinos para el jardín» (día 2, 17:08) y a Elena le baja la afinidad.
  - Elena no avanza en su proyecto de venta (0 conseguidas).
- **Un misterio que nadie sembró: «la casa de la colina»**, con 124 frases. Lo mezclan dos hilos:
  - Valentina busca a su abuela preguntando por la colina, donde ella vive.
  - Ernesto y Rafael creen que Llevant quiere comprar «la casa de la colina» (la casa en venta es otra).
  - Al final, Rafael sospecha de Mateo: «Lo vi subir a la colina con una bolsa pesada y mirar por la ventana de la casa en venta». Mateo y Valentina han hablado 65 frases.

### 5. Conversaciones y red: más repartidas que en la primera partida

|                                        | 1.ª partida (48 h) | 2.ª partida (72 h) |
| -------------------------------------- | -----------------: | -----------------: |
| Parejas que han hablado                |               31 % |               36 % |
| Vecino que menos habla                 |    Lucía, 8 frases |   Marta, 27 frases |
| Réplicas de 1–3 palabras               |              0,6 % |              1,1 % |
| Charlas cortadas por el tope de turnos |                 16 |                  0 |

- **Las parejas que más hablan:** Ernesto–Rafael (109 frases, la taberna), Nuria–Pilar (107, el huerto), Mateo–Valentina y Hugo–Mateo (65), Inés–Leo (60).
- **Cómo acaban las charlas:** 274 porque alguien decide irse, 18 porque ya no aportaban nada y 12 porque se quedaron sin tema. El tope por interés funciona: ninguna se cortó por el tope duro.
- **Longitud por estilo:** corta 48 caracteres, media 70, larga 89, menores 47. Casi idéntico a la primera partida.
- **Acuerdos hablados:** 16 se llevaron a cabo con la acción formal (11 citas y 5 invitaciones). En la primera partida no existía este puente.
- **Relaciones:** 36 cambios de tipo de relación. 22 pasan de vecinos a amistad y 5 a rivalidad.

### 6. El registro de conocimiento externo: útil, pero con mucho ruido

De sus 134 detecciones solo hay tres aciertos de verdad:

| Detección | Veces | Qué es                                                                              |
| --------- | ----: | ----------------------------------------------------------------------------------- |
| Pepa      |    26 | Vecina inventada (hallazgo 2)                                                       |
| Marcos    |     2 | «El sombrero de Marcos»: un alumno inventado por Sofía, plausible                   |
| Oasis     |     3 | Referencia real de 1996 que Clara aprende de Inés: «Es de Oasis, en plan, flipante» |

Oasis no es incoherente: falta en `commonReferences`. El resto son falsos positivos de dos tipos:

- **Infinitivos en mayúscula en las listas del diario y del plan:** «El día 2: Desayunar…, Pintar…, Jugar…». Son «Pasear» (10), «Jugar», «Cenar», «Tomar», «Volver»…, 72 de las 134 detecciones. Van detrás de una coma, que no cuenta como inicio de frase.
- **Interjecciones e imperativos justo después del id del destinatario:** «hugo Marchando», «ernesto Acábate». El vocabulario aprendido no los había visto en minúscula.

### 7. Memoria y aprender de otros

- **Memoria:** 788 reconsolidaciones, 451 olvidos y 4.522 recuerdos archivados en 72 h (unos 1.500 al día, frente a 1.370 en la primera partida). El presupuesto de memoria sigue resumiendo mucho, ahora barato: `summarize` costó 0,06 $.
- **Aprender de otros:** 5 aprendizajes con su fuente. Lo de la Pepa (dos), Oasis (Clara, de Inés), Marcos (Carmen, de Sofía) y lo que le contaron a Valentina en el banco de la plaza. Lo de Lagos de Samuel no salió esta vez.

### 8. Menores

Hubo dos descartes en `moderation_log`:

- **Un falso positivo**: «Leo sigue remoloneando con el pez gigante y ya es hora de **acostarse**». Era la decisión de Tomás, que le cuenta a Leo cómo eran los dientes del pez gigante mientras se hace tarde. La palabra «acostarse» está en la lista de contenido fuerte, así que se bloqueó sin llegar a moderar.
- **Un bloqueo correcto y prudente**: la ficha de Hugo sobre Inés («le tiene algo de intriga y cariño»). La moderación no lo encuentra claramente romántico, pero lo rechaza por el tono.

Ningún bloqueo se debió a un fallo de moderación (en la primera partida lo fueron los 3).

## Comparación con la primera partida

|                       | 1.ª (48 h, `fix/ritmo-y-habla`) | 2.ª (72 h, mundo y metas) |
| --------------------- | ------------------------------: | ------------------------: |
| Coste por día         |                          1,83 $ |                    1,63 $ |
| Errores del LLM       |                              30 |                     **0** |
| Frases por día        |                             520 |                       532 |
| Parejas que hablan    |                            31 % |                      36 % |
| Intenciones cumplidas |                            55 % |                      46 % |
| Anacronismos          |                     (sin medir) |                         0 |
| Metas conseguidas     |                               — |                        27 |

La bajada de intenciones cumplidas viene de que se proponen muchas más: 199 al día frente a 180.

## Correcciones que salen de este estudio

1. **Pasos sin proyecto padre:** que el motor los cuelgue del proyecto activo que mejor encaje (por persona o lugar del criterio). Si cuelgan de la meta vital, que pasen a ser proyectos. En el prompt de la consolidación, decir explícitamente que cuando se cumple un proyecto toca proponer el siguiente. Hoy, 35 de 49 propuestas se pierden y las metas vitales se quedan en 0,50.
2. **Metas de relación demasiado fáciles:** fijar el objetivo como «al menos +0,3 sobre la afinidad al crearla», o exigir además un número de conversaciones.
3. **«Hablar de verdad» no es «hablar»:** para metas de conversación sobre un tema, añadir palabras clave al criterio de conversaciones, contadas en lo que se dice. Así, «Mañana hablamos de Palma» no contaría como la charla pendiente.
4. **Registro de conocimiento externo:**
   - tratar la coma como inicio de elemento en listas (diario y plan);
   - ignorar la primera palabra tras el id del destinatario (lo que revisa la decisión empieza por él);
   - añadir referencias musicales de 1996 a `commonReferences` (Oasis, Blur, Nirvana…).
   - Bien ajustado, solo quedarían los vecinos inventados, que son lo interesante.
5. **«Acostarse»** no debería estar en la lista de contenido fuerte: es demasiado corriente en una familia con un niño. Que pase por la moderación con el LLM como las palabras suaves.
6. **Frustración más rápida o partidas más largas:** con 0,12 al día, los abandonos y los cambios de rumbo necesitan una semana de juego. Para estudiarlos, una partida de 7 días, o subir `frustrationPerStagnantDay` a 0,2.
7. **Consolidación (44 % del gasto, 0 % de caché):** probar la Batch API, que existe pero estaba desactivada en `.env` (`LLM_BATCH=off`), para pagar la mitad.
