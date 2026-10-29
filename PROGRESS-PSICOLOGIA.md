# PROGRESS — feat/psicologia

Psicología más humana para los agentes y relaciones visibles. Si la sesión se corta, retomar
desde el primer elemento sin marcar. Tras cada paso: `pnpm typecheck && pnpm lint && pnpm test`
y comprobar que `pnpm dev` arranca en modo mock.

## Checklist

### Antes de empezar

- [x] Coste de referencia: 48 h en mock (`pnpm --filter @lethetown/server cost:report 48`)
- [x] Entrevistas de referencia (`pnpm interview --advance 48` en RAM con `SIM_SEED=7`)

### Fase 0 — Protección de menores

- [x] `isMinor` en `AgentSeed` (explícito u obtenido de la edad)
- [x] Regla en el prompt de identidad de todos con la lista de menores
- [x] `MinorGuard`: léxico + moderación con el LLM (fail-closed) sobre la salida del LLM
- [x] Aplicado a decisiones, planes, recuerdos, fichas sociales, consolidación, reconsolidación, esencias, resúmenes, crónica y entrevistas; voz interior
- [x] Rechazos en `moderation_log`
- [x] Tests: el mock intenta generar contenido romántico con un menor y se bloquea

### Fase 1 — Rutinas como hábitos y diario sujeto a la memoria

- [ ] `noteActivity` sin recuerdo episódico por actividad trivial
- [ ] Diario de hoy con precisión según la energía
- [ ] Hábitos semánticos en la consolidación (detectar rutinas repetidas, reforzar)
- [ ] "Ayer" del plan desde la memoria (con olvido) + hábitos
- [ ] Sin `gist` del LLM para importancia ≤ 2 (configurable)
- [ ] Coste después de la fase 1

### Fase 2 — Perfil psicológico

- [ ] `personality` (Big Five) y `memoryProfile` en `AgentSeed`
- [ ] `tools/derive-personality.ts` y valores revisados de los 20 agentes
- [ ] Efectos por edad (mayores, niños)
- [ ] Perfil aplicado en decaimiento, recuperación y confusión de fuente

### Fase 3 — Ánimo y necesidades

- [ ] Ánimo bidimensional (valencia, activación) con etiqueta circumpleja
- [ ] Nivel base por personalidad y regreso con vida media
- [ ] Necesidades → ánimo; velocidades por personalidad
- [ ] `AgentState`, inspector y prompts

### Fase 4 — Codificación y sueño

- [ ] Fuerza inicial según atención y activación (Yerkes-Dodson)
- [ ] Sueño: refuerzo emocional y efectos de dormir poco

### Fase 5 — Sesgos y fenómenos

- [ ] Sesgo de negatividad
- [ ] Desvanecimiento afectivo
- [ ] Recuerdos intrusivos (+ efecto visual)
- [ ] Falsos recuerdos controlados
- [ ] Memoria prospectiva (intenciones)

### Fase 6 — Lo social

- [ ] Identidad: intereses, discrepar, negarse; `speechStyle` de los 20
- [ ] Ficha ampliada: `familiarity`, `relationshipType`, historial (`social_profile_history`)
- [ ] Credibilidad de los rumores
- [ ] Mera exposición
- [ ] Perdón y rencor mínimo

### Fase 7 — Ver las relaciones

- [ ] Pestaña «Relaciones» en el inspector (barras, evolución, recíproca)
- [ ] Filtro, búsqueda y «personas que no conoce»
- [ ] Vista «Red del pueblo» (grafo con deslizador de tiempo)
- [ ] Indicador de afinidad sobre el mapa
- [ ] Endpoints REST paginados
- [ ] Dramas al cruzar umbrales de afinidad
- [ ] Responsive, accesible, i18n

### Final

- [ ] README, CLAUDE.md, este archivo
- [ ] Entrevistas antes/después (Carmen, Aurora, Leo)
- [ ] Push y PR

## Coste (mock, 48 h de juego, SIM_SEED=7)

### Antes (main)

| Tarea         | Llamadas | Entrada (no cacheada) | Salida | Lectura de caché |
| ------------- | -------: | --------------------: | -----: | ---------------: |
| gist          |     1208 |                 79769 |  11603 |          1502934 |
| importance    |      842 |                 96787 |  14965 |          1047433 |
| decide        |      842 |                380350 |  22988 |          1047433 |
| social        |      388 |                 46538 |   8877 |           482675 |
| reconsolidate |      258 |                 39436 |   7166 |           313486 |
| plan          |       40 |                 27490 |   8248 |            32352 |
| consolidate   |       40 |                 39298 |  10818 |            49776 |
| chronicle     |        2 |                  3295 |    102 |               72 |
| **total**     | **3620** |            **712963** |  84767 |          4476161 |

## Decisiones tomadas

- **Script de coste** (`pnpm --filter @lethetown/server cost:report [horas]`): siempre en mock,
  RAM, embeddings hash y `SIM_SEED=7`, para que antes y después sean comparables.
- **Menores, dos defensas**: regla fija en el prompt de identidad de todos (cacheable: solo
  depende del pueblo) y `MinorGuard` en código sobre todo lo que escribe el LLM. Un texto
  "implica a un menor" si un menor está entre los actores (quien escribe, a quién se dirige, de
  quién trata) o se le nombra (nombre completo o de pila, sensible a mayúsculas: "leo" el verbo
  no cuenta).
- **Léxico fuerte → descarte directo; léxico ambiguo → moderación con el modelo `fast`**
  (tarea `moderate_minor`, fail-closed: error, sin presupuesto o JSON raro = se descarta). Así
  no se paga una llamada por cada frase de Leo o Inés: solo cuando hay palabras como "te
  quiero", "cariño" o "beso", y el veredicto se cachea por texto. En 72 h de mock no hay
  ninguna llamada de moderación.
- **Conservador a propósito**: un menor tampoco guarda recuerdos con léxico romántico claro
  aunque hablen de adultos ("Mateo tiene novia"). Se pierde algún cotilleo; a cambio no hay que
  analizar quién es el sujeto de la frase.
- **Qué pasa con lo descartado**: una frase o acción → el agente sigue su plan; un bloque del
  plan → se quita; un recuerdo → no se guarda (`tryRemember` devuelve null; `remember` lanza
  `BlockedContentError`); una ficha social → no cambia; una reflexión → no se crea ni cuenta
  como cita; una reconsolidación o esencia → no se aplica; la crónica → pierde esas frases; una
  entrevista → respuesta retirada. Todo va a `moderation_log` con `kind = minor_safety:<origen>`
  y `userId = null`, nunca a la línea de tiempo pública.
- **Voz interior**: además de la moderación de siempre (a la que se añadió la regla), un
  pensamiento con léxico romántico claro dirigido a un menor o que lo nombra se rechaza en
  `vetUserText` aunque `MODERATION=off`.
- **Test dorado regenerado**: cambia el prompt de identidad (regla de menores) y los `await`
  nuevos de la revisión reordenan las tareas asíncronas del mock.
