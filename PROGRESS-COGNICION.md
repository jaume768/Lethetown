# Fase 3.6: cognición en movimiento

Rama `feat/cognicion-movimiento`. Antes, quien caminaba no pensaba ni era visto
(`simulation.ts` se saltaba su turno, `perception.ts` lo excluía e `isHere` exigía el mismo
lugar): dos vecinos que se cruzaban no se enteraban. Objetivo: encuentros por el camino,
pensamiento por asociación, pararse a charlar, hablar andando y hablar sin dejar lo que se está
haciendo, con poco coste y con interruptores por mundo (mundo de control en el próximo estudio).

Al retomar: leer este fichero, `docs/decisiones/cognicion.md` y `git log --oneline main..`.

## Checklist

- [x] 0. Interruptores `cognition` por mundo (y `SIM_COGNITION`); dorado con todo apagado = antes
- [x] 1. Posición real y proximidad (shared, con tests) e índice por celdas
- [x] 2. Encuentros por el camino (sistema `encounters`): saliencia, enfriamientos, topes,
      revalidación, memoria prospectiva
- [x] 3. Saludar, pararse a charlar o seguir; viaje pendiente y retomarlo; presencia por
      proximidad; escuchar a ≤ 2 baldosas; menores
- [x] 4. Hablar andando (`walkingTalk`) (falta la interfaz: paso 7)
- [x] 5. Hablar sin dejar la actividad (`talkWhileActivity`): práctica × 0,5, objetos × 1,5
- [x] 6. Asociaciones sin LLM (sistema `associations`)
- [x] 7. Instantáneas e interfaz (log, iconos, dramas, i18n)
- [x] 8. Métricas («Evolución», `study:analyze`) y coste
- [ ] Final: tests, entrevistas, docs, PR

## Coste (`cost:report 48`, mock, SIM_SEED=7)

| Etapa                  | Llamadas | decide | importance | social | ≈ $   |
| ---------------------- | -------: | -----: | ---------: | -----: | ----- |
| Antes (`main` 382549d) |    3.632 |  1.299 |        824 |    573 | 0,804 |
| Pasos 0–3              |    3.944 |  1.424 |        871 |    615 | 0,853 |
| Pasos 0–6              |    4.171 |  1.474 |        873 |    689 | 0,884 |
| Pasos 0–8              |    4.171 |  1.398 |        873 |    689 | 0,883 |

En los pasos 0–8, `decide` se parte en `decide` (1.398) y `decide_walking` (76: pensar andando,
0,009 $). Lo demás que añade la 3.6 son charlas: `social` al cerrarlas, `importance` de lo
oído y `decide` de quien está quieto y contesta.

El mock es caótico: cualquier cambio de un prompt mueve el hash y la partida entera. Por eso,
además de `cost:report 48` (semilla 7), se mide la media de 5 semillas (7, 8, 9, 11 y 13) con
el script del banco (48 h cada una): apagado, 3.855 llamadas de media (3.632–4.013); pasos 0–3,
3.889 (+0,9 %). Con 10 semillas (7, 8, 9, 11, 13, 17, 19, 23, 29, 31), pasos 0–6: apagado
3.841, encendido 4.050: **+5,4 % ± 5,1 %** (error de la media; mediana por semilla +12,9 %,
de −26 % a +30 %). Un cambio pequeño de texto mueve la media de 5 semillas entre −3 % y +13 %:
con menos de 10 semillas, las diferencias de unos pocos puntos son ruido.

## Decisiones

(ver también `docs/decisiones/cognicion.md`)

- **Apagada = antes, byte a byte**: el dorado `three-days-off.txt` es la línea de tiempo de
  `main`. Por eso todo lo nuevo mira `ctx.cognition` (o el sistema apagado), las acciones de
  sistemas desactivados no se describen en el prompt fijo (`hiddenActions`) y el cambio de
  rumbo a mitad de camino (salir de la baldosa actual) solo va con la cognición encendida.
- **Distancia mínima en el intervalo, no en el instante** (`closestApproach`): a 6 baldosas por
  minuto, dos que se cruzan atraviesan un radio de 4 en menos de un minuto; mirando solo cada
  2 minutos casi nunca se veían. Solo cuentan los instantes en que se ven (no a través de una
  pared: si uno está a cubierto, solo dentro del mismo sitio).
- **La latencia del LLM**: un cruce dura ~1 min de juego y la respuesta real tarda ~1,7 (a x10).
  Se ve venir a la gente por su ruta (`decisionLeadMinutes`, 1,5) y lo que se decide antes de
  cruzarse se hace al cruzarse; saludar o llamar vale hasta `callRadius` (8, «a voces»).
- **Quien se para a charlar sigue «de camino»** para el resto (`travelling` sin llegada): en la
  primera versión quedaba en el sitio público más cercano (casi siempre la plaza), contaba como
  presente para todos los de la plaza y se quedaba horas en grupo: +24 % de llamadas de media.
  Ahora solo cuenta para su charla en el camino y solo piensa si le hablan.
- **Los que van juntos no «se cruzan»**: no es un encuentro (ni recuerdo ni evento), solo la
  ocasión de hablar andando (sin saludar ni pararse con su acompañante).
- **Recuerdos de encuentros**: los salientes, con algo más de importancia; los demás, solo la
  primera vez del día y si no son triviales (con un recuerdo por encuentro, `summarize` pasó de 3
  a 136 llamadas en 48 h por el presupuesto de memoria).
- **Asociaciones**: solo recuerdos de importancia ≥ 3 y de hace al menos 1 h
  (`associationMinImportance`, `associationMinAgeMinutes`); sin eso, lo que más «venía a la
  cabeza» al ver a alguien era el recuerdo del cruce que se acababa de guardar. Sin
  reconsolidar (nunca el LLM); planes e intenciones, fuera (tienen su mecanismo). Si es
  importante y negativo, como un intrusivo (tiñe el ánimo, efecto `intrusive`).
- **Hablar sin dejar la actividad**: se mantiene lo que no es estar sin hacer nada (trabajar,
  comer, cocinar, leer, sentarse); la práctica cuenta × `practiceWhileTalking` (0,5) en la misma
  revisión (no dos veces) y un objeto en marcha tarda × `attentionSlowdown` (1,5, una vez).
- **`decide_walking`**: pensar andando es otra tarea del LLM (mismo prompt y respuesta, en la
  cola urgente): su coste sale aparte en `cost:report`, en «Evolución» (sistema `encounters`)
  y en `study:analyze` (decisiones andando por día).
- **Todo encuentro deja su evento** (👀, con `meta.salient` y `meta.reunion`) y las frases de
  una charla en el camino llevan `meta.road` (y `meta.walking`): así `study:analyze` mide la 3.6
  de lo grabado, sin el estado en vivo.
- **Quien está quieto no piensa por ver pasar a alguien** (solo quien camina tiene encuentros):
  así el coste no crece con cada vecino que pasa por delante. Un saludo, en cambio, sí puede
  hacerle pensar si le importa quien saluda (saliencia ≥ umbral); devolverlo no despierta al
  primero (sin ping-pong).

## A revisar con una partida real
