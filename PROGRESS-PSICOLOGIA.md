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

- [x] `noteActivity` sin recuerdo episódico por actividad trivial
- [x] Diario de hoy con precisión según la energía
- [x] Hábitos semánticos en la consolidación (detectar rutinas repetidas, reforzar)
- [x] "Ayer" del plan desde la memoria (con olvido) + hábitos
- [x] Sin `gist` del LLM para importancia ≤ 2 (configurable)
- [x] Coste después de la fase 1

### Fase 2 — Perfil psicológico

- [x] `personality` (Big Five) y `memoryProfile` en `AgentSeed`
- [x] `tools/derive-personality.ts` y valores revisados de los 20 agentes
- [x] Efectos por edad (mayores, niños)
- [x] Perfil aplicado en decaimiento, recuperación y confusión de fuente

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

### Después de la fase 1

| Tarea         | Llamadas | Entrada (no cacheada) | Salida | Lectura de caché |
| ------------- | -------: | --------------------: | -----: | ---------------: |
| importance    |      916 |                107151 |  17050 |          1224012 |
| decide        |      916 |                418698 |  24553 |          1224012 |
| social        |      402 |                 48351 |   9177 |           537278 |
| gist          |      401 |                 27812 |   3643 |           536367 |
| reconsolidate |      278 |                 42415 |   7762 |           363462 |
| plan          |       40 |                 29058 |   8248 |            34780 |
| consolidate   |       40 |                 39439 |  11129 |            53492 |
| chronicle     |        2 |                  3281 |    102 |               72 |
| **total**     | **2995** |            **716205** |  81664 |          3973475 |

−17 % de llamadas (−625) y −11 % de lectura de caché. Las esencias caen de 1208 a 401: ya no
hay un recuerdo por actividad y lo de importancia ≤ 2 no se resume. La entrada no cacheada
queda igual (+0.5 %) porque, con el nuevo orden de los eventos, hay más decisiones y
conversaciones (decide 842 → 916), que son las llamadas con más entrada.

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
- **Diario a corto plazo**: `doneToday` sigue en `AgentState` (lo ve el inspector y el prompt de
  decidir), pero ya no crea un recuerdo por actividad. Con energía por debajo de
  `diary.lowEnergy`, cada anotación puede perderse o quedar en el lugar de la anterior, con una
  probabilidad que crece linealmente al bajar la energía. El agente no sabe que se equivoca.
- **Un recuerdo por día**: al dormirse (antes de la consolidación, que así lo ve) el diario se
  guarda como "El día N: actividad en lugar, …" (importancia 3, sin LLM). Ese es el "ayer" del
  plan: se recuerda por id (`recallByIds`) con las reglas de siempre (olvidado no sale, vago sale
  como esencia, recordar refuerza) y se excluye de la recuperación general del plan para no
  salir dos veces.
- **Hábitos sin LLM**: el rastreador (`AgentMind.habits`, en la instantánea) cuenta días por
  actividad + lugar + franja (mañana, mediodía, tarde, noche) en una ventana de 7 días; con 3 días
  nace un recuerdo semántico "Suelo … en … por las …" (importancia 4, auditoría `habit`) y cada
  repetición posterior lo refuerza (auditoría `reinforced`). La frase se compone en código.
- **`AgentMind`**: estado interno persistente que no viaja al cliente (no infla los deltas del WS).
  Va en `SimSnapshot.agents[].mind`; `SIM_SNAPSHOT_VERSION` = 5.
- **`lastConsolidation = now + 1`**: lo creado durante la consolidación (diario, hechos) ya no
  entra otra vez en la de la noche siguiente.
- **Test dorado regenerado**: el diario ya no crea recuerdos ni consume embeddings, el plan
  recibe otro "ayer" y aparecen los eventos «ya tiene una costumbre».
- **Perfil = semilla × edad × personalidad** (`resolveProfile`, puro): multiplicadores sobre
  la estabilidad episódica y semántica, la confusión de fuente, el olvido de fechas e
  intenciones y la sugestionabilidad, más el pico de reminiscencia y el peso de la congruencia
  con el ánimo. Los coeficientes están en `MemoryConfig.profile`.
- **Dónde se aplica**: en la estabilidad inicial al guardar (episódico/semántico, ÷ olvido de
  fechas si el texto menciona fechas u horas, × reminiscencia si es de juventud); en la
  recuperación (peso `moodMatch` × congruencia, bonus a los recuerdos de juventud de los
  mayores); en la confusión de fuente del mantenimiento (probabilidad × perfil). El
  `MemorySystem` recibe los perfiles de todos los agentes (`profilesFor`), también el del
  proceso api, para que el inspector puntúe igual que el worker.
- **Recuerdos de juventud**: se detectan al sembrar (`isYouthMemory`: "nací", "de joven",
  "hace cincuenta años"…) y se marcan en `meta.youth`. `meta` es una columna jsonb nueva de
  `memories` (migración 0008) pensada para las marcas de fases siguientes (falso recuerdo,
  intención…).
- **Personalidades**: `pnpm personality:derive` propone valores por palabras clave de rasgos y
  descripción, más una ligera tendencia por edad. Los valores del repo están revisados a mano;
  el script se equivoca, p. ej., con Pilar (su descripción dice que Tomás es "un desastre con
  las fechas" y el script se lo atribuye a ella) o con Mateo (lo de "cabezota" le baja demasiado
  la amabilidad). Un test comprueba que las semillas encajan con su descripción (Carmen
  memoriosa, Aurora desmemoriada, Andrés y Tomás con las fechas, Hugo impuntual, Ernesto
  puntual e hipocondríaco, Leo sugestionable…).
- **Test dorado regenerado**: los perfiles cambian la estabilidad de los recuerdos y con ella lo
  que se recuerda y se dice.
