# Corrección 3.5 (a partir de la tercera partida de estudio)

Rama `feat/correccion-3-5` (desde `main` en `93d7cf1`, que ya contiene `ad112f2`, lotes sin
`fallbacks`, y `9e87684`, `decay.maxStabilityHours`). Fuente: `estudio/semana-fase3/ESTUDIO.md`
(168 h, semillas 7 y 13). Léelo al retomar: lo hecho, lo que falta y las decisiones.

## Checklist

### A. Ruido de los registros

- [x] A1. Apodos (`nicknames` en la semilla; apodos y prefijos de ≥ 4 letras)
- [x] A2. Siglas e instituciones (`institutions` en la biblia)
- [x] A3. Listas: la coma abre elemento también en el `PersonGuard`
- [x] A4. Conocidos por otros (saberes que tiene; gente de fuera de un vecino con trato)
- [x] A5. Minúsculas en los textos que compone el código
- [x] A6. Fela Kuti y Bob Dylan en `culturalReferences`
- [x] A7. `MinorGuard` en familia (parentesco al moderador; padre/madre e hijo sin léxico claro)
- [x] Verificación de A: regresión con todos los ejemplos

### B. Mecanismos que distorsionan los resultados

- [x] B1. Espaciado en la estabilidad
- [x] B2. Metas vitales: candidatas y confirmadas por la noche
- [x] B3. Histéresis en las etiquetas de habilidad
- [x] B4. Práctica rutinaria con peso reducido
- [x] B5. Repetición de la enseñanza
- [x] B6. Deriva de la personalidad con señales negativas y relativa al pueblo

### C. Saberes y resultados

- [x] C1. `share_lore` no se ofrece a quien ya lo sabe y lo oyó hace poco
- [x] C2. Deformación (10–20 % en mock)
- [x] C3. Pérdida (test de 60–70 días)
- [x] C4. Consumir lo hecho

### D. Coste y partidas de estudio

- [x] D1. Caché del plan y de la consolidación
- [x] D2. Partidas en paralelo (desfase, tercer mundo en ablación, coste conjunto)
- [x] D3. Rangos en la base de datos
- [x] D4. Manifiesto de la partida

### E. Cierre

- [x] `cost:report 48` por bloque
- [x] Test dorado regenerado una vez por cambio de comportamiento
- [x] Entrevistas en mock tras los cambios
- [x] Decisiones, README y CLAUDE.md
- [x] «A revisar en la partida real (E4)»

## Coste por bloque (`cost:report 48`, mock, `SIM_SEED=7`)

| Momento                      | Llamadas |   ≈ $ | Respuestas en charla | Notas                                               |
| ---------------------------- | -------: | ----: | -------------------: | --------------------------------------------------- |
| Antes (`93d7cf1`)            |    4.028 | 0,853 |                  533 |                                                     |
| Tras A (registros)           |    4.028 | 0,853 |                  533 | igual: en el mock no hay apodos ni siglas           |
| Tras B (mecanismos)          |    3.639 | 0,794 |                  456 | espaciado, metas vitales, habilidades, personalidad |
| Tras C y D (saberes, caché…) |    3.632 | 0,804 |                  434 | el mock no mide la caché real (D1)                  |

| Tarea         |     Antes |     Final | Notas                                                              |
| ------------- | --------: | --------: | ------------------------------------------------------------------ |
| decide        |     1.435 |     1.299 | menos charlas en el mock (la segunda sesión deja menos vínculo)    |
| importance    |       849 |       824 |                                                                    |
| social        |       694 |       573 | una ficha por charla acabada                                       |
| gist          |       443 |       476 | estabilidades menores (espaciado): más recuerdos se vuelven vagos  |
| reconsolidate |       448 |       374 |                                                                    |
| summarize     |        77 |         3 | con menos estabilidad, el olvido natural deja sitio al presupuesto |
| plan          |        40 |        40 | igual (el prompt fijo cambia de orden, no de tamaño)               |
| consolidate   |        40 |        40 | igual: la vital por proyectos se confirma en la misma llamada      |
| chronicle     |         2 |         2 |                                                                    |
| **total**     | **4.028** | **3.632** | ≈ 0,853 $ → ≈ 0,804 $ (precios de Haiku y Sonnet 5.5)              |

- 7 días de mock (`cost:report 168`, tras C4): 19.132 llamadas (≈ 3,32 $); 34 cosas comidas,
  29 objetos en el pueblo y nadie lleva más de 4; 12 saberes contados, 2 con cambios (17 %);
  20 cambios de personalidad (uno por vecino), deriva media 0,031 (suma de los cinco rasgos).
- Registro de personas en 48 h de mock: 0 (en la medida final apareció «Francisca» cambiada por
  «alguien» en un recuerdo de Elena: arreglado en `fix(knowledge)`, ver Decisiones).

## Entrevistas (`pnpm interview --advance 48`, mock, `EMBEDDINGS=hash`)

Como siempre en el mock, cada uno responde con el recuerdo que más se recupera. Tomás, igual: «leo
me pregunta siempre por el pez gigante» a todo. Julián ya no contesta con «Me he propuesto: Que
Inés y yo volvamos a entendernos» (el espaciado: la meta, evocada en cada decisión, ya no se
vuelve imborrable); ahora, frases de Inés («En plan… ¡Hola!»). Inés, frases de su padre. Leo, lo
que le dijo Sofía. Con el LLM real hay que mirarlo en la partida.

## Decisiones

- **Apodos y prefijos** (A1): los de la semilla (`nicknames`, solo «Rafa»: no se inventó ninguno
  más) y el principio de ≥ 4 letras de un nombre que existe, salvo que sea otro nombre de pila de
  la lista («Julia» no es Julián): si no, se colaría una persona inventada.
- **Conocidos por otros** (A4): por trato, con familiaridad ≥ `personGuard.acquaintanceFamiliarity`
  (0,5, en la biblia); por saberes, la gente de fuera de cualquier semilla que sale en el título,
  los elementos o las variantes. El sistema `knowledge` lo repasa cada hora y, desde el arreglo
  final, también en el momento de aprender un saber (`onLearned` del sistema `lore`).
- **Menores en familia** (A7): la exención exige un único menor, que todos los implicados y los
  vecinos nombrados sean él o su padre o madre, ninguna tercera persona (lista de palabras) ni
  otro nombre propio a media frase. Fail-closed: si no, se modera, ahora con el parentesco.
- **Espaciado** (B1): k_max sigue siendo la regla de antes (×1,8 por la dificultad). Las metas no
  llamaban a `reinforce` al mostrarse: se reforzaban porque `retrieve` las recuperaba en cada
  decisión; el espaciado basta.
- **Instantáneas** (B3, B5, B6): los campos nuevos (`tier` de las habilidades, `pairDay`, la
  soledad acumulada) llevan valor por defecto y **no suben la versión** del sistema: subirla haría
  que una instantánea vieja arrancase el sistema limpio (habilidades, personalidad). Choca con la
  regla de CLAUDE.md («subiendo su `version`»), que no se ha cambiado: hay que decidir si se
  admite esta excepción.
- **Rutina** (B4): «rutinario» son las comidas del día por las palabras de la actividad (lo que
  ya hay en el plan), no los hábitos; con eso basta para la cocina.
- **Personalidad** (B6): `relativeToTown` 1 resta toda la media del pueblo; en una semana buena
  para todos solo se mueve lo que diferencia a cada uno, y la edad.
- **Consumir** (C4): sin acción nueva (el catálogo no cambia): el motor come con hambre en la
  revisión de habilidades.
- **Caché** (D1): un único `system` con el encabezado «## Quién eres» (lo usan muchos sitios como
  texto) y el proveedor lo parte; mismo TTL en los dos bloques.

## A revisar en la partida real (E4)

| Punto         | Objetivo en E4                                                                   | Dónde mirarlo                                                                            |
| ------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| PersonGuard   | ≤ 2 repeticiones por semana; las personas inventadas reales se siguen detectando | `knowledge_log` tipo `person`, `person.retried` en «Evolución»                           |
| Menores       | 0 falsos positivos en familia; ningún contenido inapropiado                      | `moderation_log` (`minor_safety:*`), leer cada bloqueo y cada texto permitido en familia |
| Metas vitales | Ninguna «conseguida» que se siga persiguiendo al día siguiente                   | auditoría `goal` («sin confirmar: sus proyectos se cumplen…»)                            |
| Saberes       | ≤ 2 repeticiones por pareja y saber; 10–20 % de transmisiones deformadas         | `lore_holders`, eventos 📜, métricas `transmissions` y `altered`                         |
| Habilidades   | Sin bajadas simultáneas por umbral; cada oficio sigue siendo la mejor habilidad  | auditoría `skill` a las 00:00, tabla `skills`                                            |
| Personalidad  | Varianza de Δθ entre vecinos, con signos distintos                               | auditoría `personality` del día 7                                                        |
| Memoria       | Estabilidades sin acumulación en el tope                                         | `memories.stability` (cuántas en 87.600 h)                                               |
| Coste         | Coste del plan con caché (lectura del prefijo común en las dos semillas)         | `llm_calls` por tarea, `% de caché`, coste conjunto                                      |
| Inventarios   | Acotados                                                                         | métricas `eaten` y `carriedMax`, tabla `inventory_items`                                 |

Además: si la consolidación confirma o no con criterio las metas vitales (lo cualitativo,
0/14 y 2/9 en la partida 3); si comer de lo que se lleva tiene sentido con el LLM real; y el
mundo de control en ablación (`ABLATION=on`), si se lanza.

### Probar la caché con el LLM real (no ejecutado: lo lanzas tú)

Con `.env` apuntando a Anthropic, una prueba corta de 10 minutos reales a x10 (gasta de verdad,
unos céntimos):

```bash
pnpm --filter @lethetown/server latency:probe 10 10
```

Al acabar, la prueba escribe una línea «caché …» por tarea con los tokens leídos de la caché (y
qué parte de la entrada son). Con el prefijo común, `decide` y `plan` deberían leer unos 1.500
tokens o más por llamada desde la segunda del mismo tipo, también entre agentes distintos (antes,
el plan solo leía su propio prefijo, de una consolidación anterior).

## Medidas de partida (`main` en `93d7cf1`, mock, `SIM_SEED=7`)

`cost:report 48`: **4.028 llamadas, ≈ 0,853 $**; respuestas en conversación **533** (espera media
1,8 min de juego, p90 1,0).

| Tarea         | Llamadas | Entrada no cacheada |   ≈ $ |
| ------------- | -------: | ------------------: | ----: |
| decide        |    1.435 |           1.039.647 | 0,172 |
| importance    |      849 |             108.701 | 0,046 |
| social        |      694 |             391.846 | 0,073 |
| reconsolidate |      448 |              78.061 | 0,028 |
| gist          |      443 |              32.449 | 0,019 |
| summarize     |       77 |              17.238 | 0,005 |
| plan          |       40 |              61.686 | 0,222 |
| consolidate   |       40 |              61.530 | 0,277 |
| chronicle     |        2 |               4.560 | 0,010 |

Sistemas: metas 2 conseguidas, progreso medio 0,20; habilidades 179,7 h de práctica, 4 sesiones,
15 resultados; saberes 2 transmisiones, 0 deformadas; personalidad sin cambios (es semanal).

`pnpm interview --advance 48` (mock, `EMBEDDINGS=hash`): como en la fase 3, cada uno responde con
el recuerdo que más se recupera. Tomás: «leo me pregunta siempre por el pez gigante» a todo (con
la primera letra en minúscula: el mock de la entrevista baja la inicial); Julián: frases de Tomás y
Samuel, «me he propuesto: Que Inés y yo volvamos a entendernos» y lo de Palma; Inés: «¡Ay, por
cierto! Tenía que volver a quedar con Inés» de su padre a casi todo; Leo: lo mismo de su madre.
