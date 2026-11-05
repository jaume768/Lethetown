# Corrección 3.5 (a partir de la tercera partida de estudio)

Rama `feat/correccion-3-5` (desde `main` en `93d7cf1`, que ya contiene `ad112f2`, lotes sin
`fallbacks`, y `9e87684`, `decay.maxStabilityHours`). Fuente: `estudio/semana-fase3/ESTUDIO.md`
(168 h, semillas 7 y 13). Léelo al retomar: lo hecho, lo que falta y las decisiones.

## Checklist

### A. Ruido de los registros

- [ ] A1. Apodos (`nicknames` en la semilla; apodos y prefijos de ≥ 4 letras)
- [ ] A2. Siglas e instituciones (`institutions` en la biblia)
- [ ] A3. Listas: la coma abre elemento también en el `PersonGuard`
- [ ] A4. Conocidos por otros (saberes que tiene; gente de fuera de un vecino con trato)
- [ ] A5. Minúsculas en los textos que compone el código
- [ ] A6. Fela Kuti y Bob Dylan en `culturalReferences`
- [ ] A7. `MinorGuard` en familia (parentesco al moderador; padre/madre e hijo sin léxico claro)
- [ ] Verificación de A: regresión con todos los ejemplos

### B. Mecanismos que distorsionan los resultados

- [ ] B1. Espaciado en la estabilidad
- [ ] B2. Metas vitales: candidatas y confirmadas por la noche
- [ ] B3. Histéresis en las etiquetas de habilidad
- [ ] B4. Práctica rutinaria con peso reducido
- [ ] B5. Repetición de la enseñanza
- [ ] B6. Deriva de la personalidad con señales negativas y relativa al pueblo

### C. Saberes y resultados

- [ ] C1. `share_lore` no se ofrece a quien ya lo sabe y lo oyó hace poco
- [ ] C2. Deformación (10–20 % en mock)
- [ ] C3. Pérdida (test de 60–70 días)
- [ ] C4. Consumir lo hecho

### D. Coste y partidas de estudio

- [ ] D1. Caché del plan y de la consolidación
- [ ] D2. Partidas en paralelo (desfase, tercer mundo en ablación, coste conjunto)
- [ ] D3. Rangos en la base de datos
- [ ] D4. Manifiesto de la partida

### E. Cierre

- [ ] `cost:report 48` por bloque
- [ ] Test dorado regenerado una vez por cambio de comportamiento
- [ ] Entrevistas en mock tras los cambios
- [ ] Decisiones, README y CLAUDE.md
- [ ] «A revisar en la partida real (E4)»

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
