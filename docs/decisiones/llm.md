# LLM, mock y coste

- **Todo pasa por `LLMClient.run`**, que registra en `CostTracker`; `usage.inputTokens` es siempre
  la entrada no cacheada. Precios en `config/pricing.json`.
- **Modelos por tarea**: `fast` (decidir, importancia, esencia, reconsolidación, fichas, moderación,
  resúmenes) y `reflection` (plan, consolidación, crónica), elegidos por `ModelRouter`. Cada
  llamada pide su tipo y `config/llm-routing.json` (validado con zod; `TaskRouting` en
  `LLMClient`) puede cambiarlo por tarea, junto con la duración de la caché. `summarize` pasó a
  `fast`: era el 30 % del gasto de la partida real (1,10 $ de 3,65 $) para resumir en una o dos
  frases recuerdos parecidos. Los valores por defecto (esfuerzo, `max_tokens`) siguen al tipo
  efectivo.
- **Presupuesto de memoria**: 5000 tokens por agente y grupos de 4 episodios para resumir (antes
  4000 y 3). Con los valores antiguos se superaba casi cada hora y se resumía un grupo pequeño
  cada vez. En 48 h de mock: 512 → 147 resúmenes y 4410 → 1557 recuerdos archivados; a cambio,
  más olvido natural por desgaste (223 → 430) y más triviales borrados (154 → 292). Se probó una
  histéresis (al pasarse, resumir hasta el 70-80 % del presupuesto) y empeoraba: más resúmenes,
  no menos, porque el presupuesto se supera de forma continua. Barrido: 6000 → 128 resúmenes pero
  527 olvidos; 8000 → 21 resúmenes y 837 olvidos.
- **Batch API por defecto** (`LLM_BATCH=on`): consolidación nocturna y crónica, solo con
  Anthropic y si ningún mundo va a más de x10 (`LLM_BATCH_MAX_SPEED`). A x10 una noche dura 54
  minutos reales y el lote tiene 30 de margen antes de repetirse por la vía normal. Con mock u
  OpenAI no hace nada.
- **Caché de 1 hora** (`cache_control: { type: "ephemeral", ttl: "1h" }`, documentado por
  Anthropic: la escritura cuesta 2× la entrada en vez de 1,25×; la lectura, 0,1×; el desglose
  llega en `usage.cache_creation.ephemeral_1h_input_tokens` y vale también en los lotes).
  Activada solo para `plan` y `consolidate` (`cacheTtl` en el enrutado). Son las únicas
  tareas de Sonnet por agente: el prefijo (su prompt de identidad) solo lo comparten esas dos
  llamadas al día. A x10, de la consolidación (≈ 22:00) al plan del día siguiente (07:00) pasan
  54 minutos reales: con 5 min siempre fallaba (0 % y 7 % de lectura en la partida real) y con
  1 h el plan lee lo que escribió la consolidación. Del plan a la consolidación (15 h de juego,
  90 min reales) no llega. Cuenta por agente y día: 1,25 + 1,25 = 2,5× el prefijo con 5 min;
  2 + 0,1 = 2,1× con 1 h. Ahorro pequeño (≈ 16 % del prefijo de esas dos tareas) y solo a x10 o
  más rápido; a x1 cuesta más (dos escrituras a 2×). La crónica no: una al día, sin prefijo por
  agente. `CostTracker` cobra lo escrito a 1 h a 2× la entrada (o `cacheWrite1h` de
  `pricing.json`). Sin medir aún con el LLM real: si la consolidación va por lote, su escritura
  en caché es de mejor esfuerzo y el plan puede no encontrarla (el mock no simula la caché).
- **Prompt caching**: el prompt fijo de identidad no contiene nada variable; lo variable va en el
  prompt de usuario. Anthropic con `cache_control`; OpenAI con `prompt_cache_key` por agente.
- **Respuesta en un único JSON** validado con zod; si falla, comportamiento por defecto (seguir el
  plan) sin romper el tick.
- **Robustez**: timeout propio, reintentos con backoff y jitter en 429/5xx y circuit breaker;
  Batch API de Anthropic opcional para tareas sin prisa, solo si ningún mundo va rápido.
- **Mock sin red y declarativo** (`agent/mock/`): un respondedor por tarea y, para `decide`, una
  lista ordenada de reglas pequeñas (`registerDecideRule(regla, { before | after })`) sobre un
  contexto leído una vez del prompt. Cada acción nueva registra su regla en su módulo.
- **Medir el coste** con `pnpm --filter @lethetown/server cost:report 48` (mock, RAM, embeddings
  hash, `SIM_SEED=7`) antes y después de tocar prompts o memoria.

## Historial de coste (mock, 48 h, 20 agentes)

| Momento                                   | Llamadas | Entrada no cacheada | Esencias |
| ----------------------------------------- | -------: | ------------------: | -------: |
| Antes de la psicología                    |     3620 |             712 963 |     1208 |
| Tras hábitos (sin recuerdo por actividad) |     2995 |             716 205 |      401 |
| Fin de la psicología                      |     3613 |             854 232 |      847 |
| `gist.minImportance` = 4                  |     3041 |             801 988 |      346 |

Desde la fase de cimientos, `cost:report` da también el coste que tendrían esos tokens a
precios de Haiku 5.5 y Sonnet 5.5 según el enrutado, y la auditoría de la memoria. Tabla en
`PROGRESS-CIMIENTOS.md`.
