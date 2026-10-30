# Lethetown: partida de estudio de 48 horas

**Qué se ejecutó:** 20 agentes con el LLM real de Anthropic (decisiones con `claude-haiku-5-5`; planes, consolidación, resúmenes y crónica con `claude-sonnet-5-5`), a x10, desde el día 0 a las 06:51 hasta el día 2 a las 06:52.
**Fecha:** 30-10-2026, rama `fix/ritmo-y-habla`.
**Configuración:** turnos reactivos de 1 minuto, importancia por reglas dentro de una conversación, cola del LLM con prioridad y tope de longitud del habla.

Hubo una interrupción. Claude Code paró los procesos por falta de memoria del equipo en el minuto de juego 2412 (día 1, 16:12). La partida se reanudó desde la instantánea guardada al apagarse, así que no se perdió estado; solo quedó un hueco de 13 minutos reales en la grabación.

## Datos (en esta carpeta)

| Fichero          | Contenido                                                                                                                                                                                                                                     |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `messages.jsonl` | Todos los mensajes del WebSocket (eventos, «pensando», efectos de memoria, dramas, crónicas, coste) con la hora real (`wallMs`).                                                                                                              |
| `states.jsonl`   | Estado de los 20 agentes cada 10 min de juego: posición, acción, ánimo, necesidades, plan y razonamiento.                                                                                                                                     |
| `server.log`     | Log de la API, el worker y la web.                                                                                                                                                                                                            |
| `bd/*.jsonl`     | Tablas del mundo en Postgres, sin embeddings. Recuerdos (4.924), auditoría (5.973), versiones (535), fichas sociales (220) e historial (986), dramas (670), llamadas al LLM (3.953), citas, notas, objetos, lugares conocidos e instantáneas. |
| `meta.json`      | Los dos tramos de la grabación.                                                                                                                                                                                                               |

Las cifras salen de `analiza.py` (`python3 analiza.py . analisis.json`), y el resultado completo está en `analisis.json`.

## Resumen en cifras

|                                       |                                                                                                  |
| ------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Coste total                           | **3,65 $**. Haiku: 3.762 llamadas, 0,89 $. Sonnet: 191 llamadas, 2,76 $.                         |
| Frases dichas                         | 1.043, en 204 conversaciones (24 de grupo)                                                       |
| Espera entre una frase y su respuesta | Media 10,1 s reales (mediana 8,8; p90 10,4), unos 1,7 min de juego                               |
| Longitud de las frases                | Media 67 caracteres (13 palabras), máximo 155                                                    |
| Intenciones                           | 359 propuestas; 197 cumplidas, 26 se le pasan, 4 recordadas tarde                                |
| Memoria                               | 5.338 recuperaciones, 528 reconsolidaciones, 2.747 recuerdos archivados (resumidos), 510 olvidos |
| Errores                               | 30. Ninguno paró la partida; uno cortó un turno.                                                 |

### Coste por tarea

| Tarea                | Llamadas |  Coste | Lectura de caché | Entrada por llamada | Salida por llamada |
| -------------------- | -------: | -----: | ---------------: | ------------------: | -----------------: |
| summarize (Sonnet)   |      110 | 1,10 $ |             48 % |               1.403 |                137 |
| consolidate (Sonnet) |       40 | 0,99 $ |              7 % |               2.554 |              1.101 |
| plan (Sonnet)        |       39 | 0,65 $ |              0 % |                 775 |                595 |
| decide               |    1.711 | 0,57 $ |             70 % |               1.561 |                285 |
| importance           |      954 | 0,15 $ |             92 % |                 262 |                 61 |
| social               |      509 | 0,09 $ |             85 % |                 624 |                144 |
| reconsolidate        |      553 | 0,08 $ |             92 % |                 302 |                121 |
| chronicle (Sonnet)   |        2 | 0,02 $ |              0 % |               4.263 |                363 |

**Lectura:** el 75 % del gasto se va en tres tareas de Sonnet que no tocan la conversación: resúmenes por presupuesto de memoria, consolidación nocturna y planes. Con Sonnet la caché apenas se aprovecha (0–7 % en plan, consolidación y crónica), porque cada agente lo llama una o dos veces al día y la caché caduca entre llamadas. Bajar `summarize` a Haiku, o hacerlo menos a menudo, sería el ahorro más grande.

## Hallazgos

### 1. Una muletilla que se convierte en una deuda real (Hugo y Valentina)

Es el caso más rico de la partida. La muletilla de Hugo en la semilla es «ya te lo pago, de verdad», y su descripción dice que «le debe dinero a medio pueblo» (en concreto, a Rafael). A Valentina no le debe nada.

1. **Día 0, 08:00.** Hugo le dice a Valentina, recién llegada: «Lo suficiente para deberle dinero a medio pueblo. Ya te lo pago, de verdad».
2. **08:03.** Hugo le pregunta: «¿Tú me cobras algo o qué?». Ella todavía no ha reclamado nada.
3. **08:11.** Hugo se propone «pagarle a Valentina Ríos lo que le debo». Al reconsolidarse, la intención se adorna: «Ya sé que me ha preguntado por el dinero más de una vez». No era cierto.
4. **08:38.** Valentina acepta el marco: «cobrarle a Hugo lo que me debe, a plazos». A las 09:03 su intención ya dice «ya van dos días de "mañana te lo paso"», cuando había pasado una hora.
5. **Noche del día 0.** La consolidación lo convierte en hechos semánticos. Valentina: «Hugo Peña me debe dinero desde el jueves y sigue dándome largas». Hugo: «Hugo debe dinero a Valentina, Rafael, Mateo y Nuria», una lista que sigue creciendo.
6. **Día 1.** Los detalles derivan. El jueves pasa a ser viernes; aparece «me debe dinero por una foto» y la fuente como lugar de pago. Hugo la invita dos veces «para pagarle algo de lo que le debo» y nunca paga.
7. **Fichas finales, asimétricas.** Hugo ve a Valentina como amistad (afinidad +0,76, confianza 0,45): «Cercana y paciente con mis deudas». Valentina lo ve como vecino (afinidad −0,20, confianza 0,00): «Siempre con excusas y sonrisas para no pagarme».

**Qué muestra:** un rasgo lingüístico de la semilla (la muletilla), repetido decenas de veces, se convierte en un hecho social que nadie sembró. Lo sostienen la memoria prospectiva (intenciones), la reconsolidación (que añade historia) y la consolidación (que lo fija como hecho). Es un falso recuerdo colectivo. Como efecto secundario, Hugo repite su muletilla en casi cada turno, y la regla «no repitas lo dicho» no basta contra una muletilla de la semilla.

### 2. Un fallo técnico que parece una depresión (Lucía)

- **Día 0, 07:01.** El plan de Lucía (Sonnet) vuelve con texto después del JSON y no se puede leer. Se aplica el plan de reserva: «estar en casa» de 07:00 a 22:00.
- Sola en casa no percibe nada nuevo, y sin percepciones nuevas el agente no llama al LLM, así que **no decide nada en todo el día**. Las necesidades siguen su curso: hambre 1,0, necesidad social 0, energía 0,10. El ánimo baja en línea recta de +0,12 a **−1,00** a las 21:50.
- **Día 1.** Se despierta con −0,08 y duerme mal. Sale al café, donde habla con Carmen y Mateo y come una tostada, y el ánimo sube. Al volver, «cenar en casa y descansar» no le baja el hambre: el modelo marcó la actividad como `sit` (por «descansar») en vez de `eat`. Termina el día otra vez en −0,9.
- Es la que menos habla: 8 frases en dos días.

**Qué muestra:** tres defectos encadenados.

- El JSON se extrae del primer `{` al último `}`, y con texto detrás con llaves falla.
- El plan de reserva no incluye ni una comida.
- Las necesidades extremas no cuentan como algo relevante para pensar.

Tiene interés para el estudio, porque el ciclo aislamiento → ánimo bajo → menos interacción es plausible, pero aquí su origen es un error y no una decisión.

### 3. Las conversaciones suenan a gente (con matices)

- **Ritmo:** una respuesta tarda de media 10 s reales (1,7 min de juego). En mock, antes de los turnos reactivos, eran 6,2 min de juego. 173 de 204 charlas acaban porque alguien decide irse, 11 por quedarse sin tema y 16 por el tope de seguridad de turnos. Ese tope cortó charlas vivas, como la consulta médica de Ernesto con Samuel.
- **Longitud:** respeta el estilo de cada uno.

  | Estilo  |   Media | Máximo |
  | ------- | ------: | -----: |
  | corta   | 54 car. |     90 |
  | media   | 68 car. |    150 |
  | larga   | 82 car. |    155 |
  | menores | 47 car. |     82 |

  El tope en código solo tuvo que cortar 2 frases.

- **Lo que no cumple:** las réplicas de 1–3 palabras son el **0,6 %** (6 de 1.043). El modelo casi siempre añade una segunda frase («Vale, vale. Pero…»). Los saludos sí se cortan: 5 al empezar y 1 a mitad de charla. Solo hubo 2 repeticiones exactas en la misma charla.
- **Los ejemplos del prompt:** «Ni de broma» aparece 9 veces, «Ya, bueno…» 16 y «no sé yo» 10. Los ejemplos se usan, pero no dominan. Lo que más se repite son las muletillas de la semilla: «¡claro que sí!» de Clara (24), «ya te lo pago» de Hugo (14+) y «¿y eso desde cuándo?» de Valentina (8). Antes atribuí estas dos últimas a los ejemplos; era un error.

**Un buen ejemplo**, Sofía (maestra) e Inés (16 años, falta a clase):

> Sofía: «Inés, a ver si mañana vuelves a clase, que te echo de menos.»
> Inés: «Ya, ya. Qué pereza.»
> Sofía: «¿Y si las fotos las hacemos en el huerto? Seguro que sale algo bonito.»
> Inés: «Vale, a las cuatro en el huerto. No llegues tarde, eh.»

Quedan con una cita formal (`propose_meeting`), van, hacen las fotos y vuelven a quedar el día 1. La relación pasa de «trabajo» a «amistad» (Inés → Sofía: afinidad +0,9, confianza +0,6), el cambio social más grande de la partida.

### 4. Una red social muy concentrada

- El **69 %** de las parejas posibles no cruza ni una palabra.

  | Pareja                        | Frases |
  | ----------------------------- | -----: |
  | Aurora–Clara (abuela y nieta) |     90 |
  | Carmen–Mateo (madre e hijo)   |     85 |
  | Hugo–Valentina                |     75 |
  | Ernesto–Rafael                |     69 |

- Hablan mucho Mateo (138 frases), Hugo (94) y Valentina (93). Apenas hablan Lucía (8), Andrés (11), Julián (11) y Marta (18).
- Los vínculos se forman donde coinciden las rutinas: el café, la taberna y las familias.

**Conflictos que crecen:**

- **Nuria y Elena** (rivalidad sembrada por la casa vacía) bajan de afinidad −0,44 y −0,29. Elena repite «lo estudiaremos con calma, por el bien del pueblo», sus dos muletillas. Nuria responde con una nota en el tablón: «Se busca gente para el jardín de la casa vacía. Traed guantes y paciencia». Es la única nota de toda la partida y es una acción colectiva que nadie le pidió.
- **Rafael y Mateo**, por los clientes del café de la tarde.

**Amistades nuevas:** Hugo–Mateo (+0,73), Mateo–Valentina (+0,45), Leo–Sofía (+0,58) y Samuel–Ernesto, que pasan de trabajo a amistad tras la consulta.

### 5. Memoria: se reescribe mucho, se inventa poco

- Hubo 528 reconsolidaciones y 7 confusiones de fuente. El falso recuerdo (confabulación) no se activó ni una vez.
- Aun así, la reconsolidación de intenciones añade detalles inventados («ya van dos días», «me ha preguntado más de una vez»), sobre todo en los recuerdos que se recuerdan muy a menudo. Funciona en la práctica como una confabulación sin marcar.
- El presupuesto de memoria resume mucho: 2.747 recuerdos archivados en dos días, 110 llamadas a `summarize` y 1,10 $.
- La memoria prospectiva funciona bien: 197 intenciones cumplidas frente a 30 fallidas (13 %). Tomás se acuerda del aniversario con Pilar, y Ernesto vuelve con Samuel para que le revise el dolor de pecho.

### 6. Las acciones del catálogo se usan poco

| Acción                    | Veces |
| ------------------------- | ----: |
| `do_activity`             |    93 |
| `use_object`              |    44 |
| `invite`                  |    30 |
| `propose_meeting`         |     5 |
| `follow`                  |     3 |
| `post_note`               |     1 |
| `explore`                 |     1 |
| `return_item`             |     1 |
| `give_item` / `lend_item` |     0 |

- Casi todo lo social se resuelve hablando («quedamos el viernes en la fuente») y queda como intención, sin pasar por la acción formal.
- Lucía nunca devuelve el libro de Carmen, y el motor lo detecta («📕 aún no le ha devuelto…»). Hugo nunca usa `give_item` para pagar a nadie, porque no hay dinero que dar. La economía es lo que falta para cerrar estos hilos.
- Los fallos tienen sentido: invitar a alguien que ya se fue, o invitar a un sitio donde ya están («ya estamos aquí», 3 veces).

### 7. Las crónicas solo ven la noche

Las dos crónicas («Tostadas, deudas y un pez que nadie escuchó» y «El pez que nadie vio (salvo Leo y Sofía)») están bien escritas, pero solo cuentan lo ocurrido a partir de las 20:00. El cronista recibe los últimos 120 eventos del día, y la mayoría son rutina («X: caminando a…»). Ni la consulta de Ernesto, ni la cita del huerto, ni la deuda de la mañana entran en la crónica del día 0.

### 8. Errores y protección de menores

- 23 respuestas sin JSON válido o mal formado: 14 en fichas sociales, 6 en reconsolidación, 5 en importancia, 2 en decisión y 1 en plan. A esto se suma 1 error de conexión.
- Solo dos tuvieron efectos visibles: el plan de Lucía (hallazgo 2) y el turno cortado de Inés el día 1 a las 07:08. Al recordar para planificar falló una reconsolidación y el error cortó el turno, así que Inés repitió el plan del día anterior.
- **Menores:** hubo 3 bloqueos, y los 3 ocurrieron porque la moderación no pudo responder, no porque hubiera contenido inadecuado. El sistema bloquea por defecto cuando no puede moderar. Se descartaron frases inocentes, por ejemplo Sofía a Inés: «Oye, ¿mañana vuelves a clase? Te echo de menos». No hubo ningún contenido inadecuado.

## Correcciones que salen de este estudio

1. Extraer el **primer objeto JSON equilibrado** en vez de ir del primer `{` al último `}`. Habría evitado el plan de Lucía y parte de los 23 errores.
2. Si **falla una reconsolidación al recordar, no cortar el turno** (caso de Inés).
3. Hacer que las **necesidades extremas cuenten como algo relevante**, de modo que con hambre o soledad extremas el agente piense. Que el plan de reserva incluya comidas, y que una actividad que dice «cenar» cuente como comer aunque el modelo la marque como `sit`.
4. Que el **cronista vea todo el día**: quitar la rutina y repartir la muestra por todo el día.
5. Para estudiar más adelante: subir el tope de turnos o hacerlo depender del interés de la charla; frenar la repetición de muletillas (una por charla); pasar `summarize` a Haiku; usar la economía (el dinero) para que las deudas puedan saldarse.
