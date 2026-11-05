# Memoria humana

- **Base (Park et al. 2023)**: puntuación = media de recencia, importancia, relevancia y
  congruencia con el ánimo, × fuerza actual (decaimiento exponencial con estabilidad).
  Olvidado < 0.05 ≤ vago < 0.3. Recordar refuerza (repetición espaciada).
- **Efecto de espaciado** (corrección 3.5): al evocar, la estabilidad se multiplica por
  k(Δt) = 1 + (k_max − 1)·(1 − e^(−Δt/τ)), con Δt el tiempo de juego desde la evocación anterior
  y τ la estabilidad actual (`spacingFactor`); k_max es la regla de antes
  (`recallStabilityGrowth` × dificultad, ×1,8 a ×3,6). Evocar algo cada 10 minutos ya no
  consolida como evocarlo cada día: en la partida de una semana las metas, recuperadas en cada
  decisión, sumaban 142 evocaciones y llegaban a 3,8e38 h. Sigue el tope
  `decay.maxStabilityHours` (10 años). Solo refuerza lo que se recupera de verdad:
  `retrieve` (decidir, plan), `recallByIds` (el «ayer» del plan), los intrusivos, el repaso de
  intenciones y hábitos y la consolidación; lo que el sistema muestra en el prompt (las metas,
  el plan) no toca la memoria.
- **Esencia** con el LLM al volverse vago, solo para importancia ≥ `gist.minImportance` (4): lo
  menos importante se desvanece con una esencia provisional. Subirlo de 3 a 4 bajó las esencias de
  847 a 346 en 48 h de mock.
- **Reconsolidación** al recordar (10 %), **confusión de fuente** en el mantenimiento y **olvido
  por presupuesto** (triviales viejos → resumir grupos parecidos, que se archivan → descartar lo
  de menor importancia × fuerza; nunca planes recientes ni conocimiento importante).
- **Cada decisión de olvido o transformación** queda en la auditoría con un motivo legible, y
  cada cambio de texto en el historial de versiones.
- **Las entrevistas usan `inspect`** (sin refuerzo ni reconsolidación) para medir sin alterar.
- **Diario del día** (`doneToday`) a corto plazo, sin un recuerdo por actividad; con poca energía
  se pierden o mezclan entradas. Al dormirse, un recuerdo "El día N: …" y un rastreador de
  rutinas: 3 días de 7 con la misma actividad, lugar y franja → hábito semántico "Suelo …". El
  "ayer" del plan se recuerda por id (`recallByIds`), con olvido y vaguedad.
- **`meta`** (jsonb) marca recuerdos: juventud, solo esencia, falso recuerdo, intención,
  desvanecimiento afectivo.
- **`listActive(agentId, { withEmbedding })`**: el mantenimiento, la consolidación y los intrusivos
  no traen vectores (en Postgres no se selecciona la columna); el presupuesto sí (agrupa por
  similitud).
- **Retención** (ver [produccion.md](produccion.md)): solo se borran recuerdos olvidados o
  archivados; los activos nunca.
