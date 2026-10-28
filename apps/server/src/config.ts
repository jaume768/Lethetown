import { config as loadDotenv } from "dotenv";
import { z } from "zod";
import { fromRoot } from "./paths";

loadDotenv({ path: fromRoot(".env"), quiet: true });

const emptyToUndefined = (v: unknown) => (v === "" ? undefined : v);

const Env = z.object({
  LLM_PROVIDER: z.enum(["mock", "anthropic", "openai"]).default("mock"),
  ANTHROPIC_API_KEY: z.preprocess(emptyToUndefined, z.string().optional()),
  OPENAI_API_KEY: z.preprocess(emptyToUndefined, z.string().optional()),
  ANTHROPIC_MODEL_FAST: z.string().default("claude-haiku-5-5"),
  ANTHROPIC_MODEL_REFLECTION: z.string().default("claude-sonnet-5-5"),
  OPENAI_MODEL_FAST: z.string().default("gpt-6-luna"),
  OPENAI_MODEL_REFLECTION: z.string().default("gpt-6-sol"),
  LLM_CONCURRENCY: z.coerce.number().int().positive().default(4),
  /** Timeout propio por intento, reintentos (429/5xx/red) y circuit breaker del proveedor. */
  LLM_TIMEOUT_SECONDS: z.coerce.number().positive().default(60),
  LLM_RETRIES: z.coerce.number().int().nonnegative().default(3),
  LLM_BREAKER_THRESHOLD: z.coerce.number().int().positive().default(5),
  LLM_BREAKER_COOLDOWN_SECONDS: z.coerce.number().positive().default(30),
  /** Batch API (50 % más barata) para tareas sin prisa; solo Anthropic. */
  LLM_BATCH: z.enum(["on", "off"]).default("off"),
  LLM_BATCH_TASKS: z
    .string()
    .default("consolidate,chronicle")
    .transform((s) =>
      s
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
    ),
  /** Solo se usa el lote si ningún mundo va más rápido que esto (a x60 una noche dura 9 min). */
  LLM_BATCH_MAX_SPEED: z.coerce.number().nonnegative().default(10),
  LLM_BATCH_MAX_WAIT_MINUTES: z.coerce.number().positive().default(30),
  LLM_BATCH_POLL_SECONDS: z.coerce.number().positive().default(30),
  DATABASE_URL: z.preprocess(emptyToUndefined, z.string().optional()),
  EMBEDDINGS: z.enum(["local", "hash"]).default("local"),
  EMBEDDINGS_MODEL: z.string().default("Xenova/all-MiniLM-L6-v2"),
  /** Calcular los embeddings locales en un worker_thread (no bloquea el bucle de eventos). */
  EMBEDDINGS_THREAD: z.enum(["on", "off"]).default("on"),
  PORT: z.coerce.number().int().default(3001),
  SIM_TICK_MINUTES: z.coerce.number().positive().default(10),
  SIM_SPEED: z.coerce.number().default(10),
  /** Velocidad de paseo de los agentes, en baldosas por minuto de juego. */
  /** Semilla del azar de la memoria (reconsolidación, rumores...). Vacía = aleatoria. */
  SIM_SEED: z.preprocess(emptyToUndefined, z.coerce.number().int().optional()),
  SIM_WALK_TILES_PER_MINUTE: z.coerce.number().positive().default(6),

  // --- Observabilidad -----------------------------------------------------------------------
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  SENTRY_DSN: z.preprocess(emptyToUndefined, z.string().url().optional()),
  /** Token para /metrics (Authorization: Bearer …). Vacío = solo admin con sesión. */
  METRICS_TOKEN: z.preprocess(emptyToUndefined, z.string().min(16).optional()),

  // --- Servidor y seguridad -----------------------------------------------------------------
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  /** Interfaz en la que escucha la API (0.0.0.0 dentro de Docker). */
  HOST: z.string().default("127.0.0.1"),
  /** Orígenes permitidos (CORS, Origin del WebSocket y de las peticiones que mutan), separados por comas. */
  ALLOWED_ORIGINS: z
    .string()
    .default("http://localhost:5173,http://127.0.0.1:5173")
    .transform((s) =>
      s
        .split(",")
        .map((o) => o.trim())
        .filter(Boolean),
    ),
  /** Detrás de un proxy (Caddy): confiar en X-Forwarded-For para la IP del cliente. */
  TRUST_PROXY: z.preprocess((v) => v === "true" || v === "1", z.boolean()).default(false),
  /** Cookie de sesión con `Secure` (por defecto, solo en producción). */
  COOKIE_SECURE: z.preprocess(emptyToUndefined, z.enum(["true", "false"]).optional()),
  SESSION_TTL_HOURS: z.coerce.number().positive().default(168),
  /** Solo en RAM y fuera de producción: crea un admin "admin" con esta contraseña al arrancar. */
  DEV_ADMIN_PASSWORD: z.preprocess(emptyToUndefined, z.string().min(10).optional()),
  /** Peticiones por minuto e IP (global) y en las rutas que gastan LLM. */
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(300),
  RATE_LIMIT_INTERVENTION_PER_MINUTE: z.coerce.number().int().positive().default(10),
  RATE_LIMIT_CHRONICLE_PER_MINUTE: z.coerce.number().int().positive().default(2),
  BODY_LIMIT_BYTES: z.coerce.number().int().positive().default(16_384),
  WS_MAX_PAYLOAD_BYTES: z.coerce.number().int().positive().default(4096),
  WS_MAX_PER_IP: z.coerce.number().int().positive().default(8),
  WS_HEARTBEAT_SECONDS: z.coerce.number().positive().default(30),

  // --- Presupuesto de gasto en LLM (USD; 0 = sin límite) --------------------------------------
  BUDGET_DAILY_USD: z.coerce.number().nonnegative().default(5),
  BUDGET_MONTHLY_USD: z.coerce.number().nonnegative().default(50),
  WORLD_BUDGET_DAILY_USD: z.coerce.number().nonnegative().default(2),
  WORLD_BUDGET_MONTHLY_USD: z.coerce.number().nonnegative().default(20),

  // --- Texto del usuario --------------------------------------------------------------------
  /** Longitud máxima de la voz interior y de los estados de objetos. */
  USER_TEXT_MAX: z.coerce.number().int().positive().default(280),
  /** llm = moderar con el modelo fast antes de aceptar; off = solo límites y delimitación. */
  MODERATION: z.enum(["llm", "off"]).default("llm"),
});

export type AppConfig = z.infer<typeof Env>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = Env.safeParse(env);
  if (!parsed.success) {
    throw new Error(`Configuración inválida en .env:\n${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}

export const isProduction = (c: AppConfig) => c.NODE_ENV === "production";

export function cookieSecure(c: AppConfig): boolean {
  return c.COOKIE_SECURE ? c.COOKIE_SECURE === "true" : isProduction(c);
}

export function modelsFor(config: AppConfig): { fast: string; reflection: string } {
  switch (config.LLM_PROVIDER) {
    case "anthropic":
      return { fast: config.ANTHROPIC_MODEL_FAST, reflection: config.ANTHROPIC_MODEL_REFLECTION };
    case "openai":
      return { fast: config.OPENAI_MODEL_FAST, reflection: config.OPENAI_MODEL_REFLECTION };
    case "mock":
      return { fast: "mock-fast", reflection: "mock-reflection" };
  }
}
