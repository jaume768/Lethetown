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
  DATABASE_URL: z.preprocess(emptyToUndefined, z.string().optional()),
  EMBEDDINGS: z.enum(["local", "hash"]).default("local"),
  EMBEDDINGS_MODEL: z.string().default("Xenova/all-MiniLM-L6-v2"),
  PORT: z.coerce.number().int().default(3001),
  SIM_TICK_MINUTES: z.coerce.number().positive().default(10),
  SIM_SPEED: z.coerce.number().default(10),
});

export type AppConfig = z.infer<typeof Env>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = Env.safeParse(env);
  if (!parsed.success) {
    throw new Error(`Configuración inválida en .env:\n${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
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
