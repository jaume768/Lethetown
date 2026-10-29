# LLM, mock y coste

- **Todo pasa por `LLMClient.run`**, que registra en `CostTracker`; `usage.inputTokens` es siempre
  la entrada no cacheada. Precios en `config/pricing.json`.
- **Modelos por tarea**: `fast` (decidir, importancia, esencia, reconsolidación, fichas, moderación)
  y `reflection` (plan, consolidación, resúmenes, crónica), elegidos por `ModelRouter`.
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
