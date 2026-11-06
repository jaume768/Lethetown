# Fase 3.6: cognición en movimiento

Rama `feat/cognicion-movimiento`. Antes, quien caminaba no pensaba ni era visto
(`simulation.ts` se saltaba su turno, `perception.ts` lo excluía e `isHere` exigía el mismo
lugar): dos vecinos que se cruzaban no se enteraban. Objetivo: encuentros por el camino,
pensamiento por asociación, pararse a charlar, hablar andando y hablar sin dejar lo que se está
haciendo, con poco coste y con interruptores por mundo (mundo de control en el próximo estudio).

Al retomar: leer este fichero, `docs/decisiones/cognicion.md` y `git log --oneline main..`.

## Checklist

- [ ] 0. Interruptores `cognition` por mundo (y `SIM_COGNITION`); dorado con todo apagado = antes
- [ ] 1. Posición real y proximidad (shared, con tests) e índice por celdas
- [ ] 2. Encuentros por el camino (sistema `encounters`): saliencia, enfriamientos, topes,
      revalidación, memoria prospectiva
- [ ] 3. Saludar, pararse a charlar o seguir; viaje pendiente y retomarlo; presencia por
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

## Decisiones

(ver también `docs/decisiones/cognicion.md`)

## A revisar con una partida real
