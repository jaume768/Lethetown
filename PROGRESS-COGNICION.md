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
- [ ] 4. Hablar andando (`walkingTalk`)
- [ ] 5. Hablar sin dejar la actividad (`talkWhileActivity`)
- [ ] 6. Asociaciones sin LLM (sistema `associations`)
- [ ] 7. Instantáneas e interfaz (log, iconos, dramas, i18n)
- [ ] 8. Métricas («Evolución», `study:analyze`) y coste
- [ ] Final: tests, entrevistas, docs, PR

## Coste (`cost:report 48`, mock, SIM_SEED=7)

| Etapa                  | Llamadas | decide | importance | social | ≈ $   |
| ---------------------- | -------: | -----: | ---------: | -----: | ----- |
| Antes (`main` 382549d) |    3.632 |  1.299 |        824 |    573 | 0,804 |
| Pasos 0–3              |    3.944 |  1.424 |        871 |    615 | 0,853 |

El mock es caótico: cualquier cambio de un prompt mueve el hash y la partida entera. Por eso,
además de `cost:report 48` (semilla 7), se mide la media de 5 semillas (7, 8, 9, 11 y 13) con
el script del banco (48 h cada una): apagado, 3.855 llamadas de media (3.632–4.013); pasos 0–3,
3.889 (+0,9 %).

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
- **Quien está quieto no piensa por ver pasar a alguien** (solo quien camina tiene encuentros):
  así el coste no crece con cada vecino que pasa por delante. Un saludo, en cambio, sí puede
  hacerle pensar si le importa quien saluda (saliencia ≥ umbral); devolverlo no despierta al
  primero (sin ping-pong).

## A revisar con una partida real
