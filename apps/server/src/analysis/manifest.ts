/**
 * Manifiesto de una partida grabada (corrección 3.5): con qué se jugó, para poder comparar
 * partidas (el código, la semilla, la velocidad, los modelos y sus precios, la ablación de la
 * memoria y la fecha). Lo escribe `record` al empezar y `study:analyze` lo pone en analysis.md.
 * Solo claves de una lista blanca: nunca secretos (ni API keys ni DATABASE_URL).
 */
import { z } from "zod";

/** Variables de entorno que se apuntan (sin secretos). */
const MANIFEST_ENV = [
  "SIM_SEED",
  "SIM_SPEED",
  "SIM_NIGHT_SPEED",
  "SIM_DEMO",
  "LLM_PROVIDER",
  "ANTHROPIC_MODEL_FAST",
  "ANTHROPIC_MODEL_REFLECTION",
  "LLM_BATCH",
  "LLM_BATCH_MAX_SPEED",
  "LLM_CONCURRENCY",
  "MEMORY_ABLATION",
  "SIM_COGNITION",
] as const;

export const StudyManifest = z.object({
  /** SHA del código (git), o null si no se pudo leer. */
  sha: z.string().nullable(),
  /** Hay cambios sin commit (el SHA no lo describe todo). */
  dirty: z.boolean().nullable(),
  seed: z.number().nullable(),
  speed: z.number().nullable(),
  nightSpeed: z.number().nullable(),
  provider: z.string().nullable(),
  /** Modelos por tipo (fast, reflection) y el enrutado por tarea de config/llm-routing.json. */
  models: z.record(z.string(), z.string()),
  routing: z.unknown().nullable(),
  /** Precios de config/pricing.json. */
  pricing: z.unknown().nullable(),
  /** Flags de `MemoryConfig.ablation` activos. */
  ablation: z.array(z.string()),
  /**
   * Cognición en movimiento (fase 3.6): `SIM_COGNITION` («on», «off» = mundo de control, o la
   * lista de partes apagadas). Los manifiestos de antes de la 3.6 no lo tienen.
   */
  cognition: z.string().default("on"),
  /** El resto de lo apuntado del entorno (lista blanca). */
  env: z.record(z.string(), z.string()),
  /** ISO, hora real. */
  createdAt: z.string(),
});
export type StudyManifest = z.infer<typeof StudyManifest>;

const num = (v: string | undefined) => (v === undefined || v === "" ? null : Number(v));

/** El manifiesto con lo que se sabe (las lecturas de ficheros y de git, inyectadas). */
export function buildManifest(input: {
  env: Record<string, string | undefined>;
  git: { sha: string | null; dirty: boolean | null };
  routing: unknown;
  pricing: unknown;
  now: Date;
}): StudyManifest {
  const env = Object.fromEntries(
    MANIFEST_ENV.flatMap((k) => (input.env[k] !== undefined ? [[k, input.env[k]!]] : [])),
  );
  return {
    sha: input.git.sha,
    dirty: input.git.dirty,
    seed: num(env.SIM_SEED),
    speed: num(env.SIM_SPEED),
    nightSpeed: num(env.SIM_NIGHT_SPEED),
    provider: env.LLM_PROVIDER ?? null,
    models: {
      ...(env.ANTHROPIC_MODEL_FAST ? { fast: env.ANTHROPIC_MODEL_FAST } : {}),
      ...(env.ANTHROPIC_MODEL_REFLECTION ? { reflection: env.ANTHROPIC_MODEL_REFLECTION } : {}),
    },
    routing: input.routing ?? null,
    pricing: input.pricing ?? null,
    ablation: (env.MEMORY_ABLATION ?? "")
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean),
    cognition: env.SIM_COGNITION?.trim() || "on",
    env,
    createdAt: input.now.toISOString(),
  };
}

/** La sección de analysis.md. */
export function manifestMarkdown(m: StudyManifest): string {
  const models = Object.entries(m.models)
    .map(([k, v]) => `${k}: ${v}`)
    .join(", ");
  return [
    "## Manifiesto",
    "",
    `- Código: ${m.sha ?? "?"}${m.dirty ? " (con cambios sin commit)" : ""}`,
    `- Semilla ${m.seed ?? "?"}, velocidad x${m.speed ?? "?"}${m.nightSpeed ? `, noche x${m.nightSpeed}` : ""}`,
    `- Proveedor: ${m.provider ?? "?"}${models ? ` (${models})` : ""}`,
    `- Ablación de la memoria: ${m.ablation.length ? m.ablation.join(", ") : "ninguna"}`,
    `- Cognición en movimiento (fase 3.6): ${m.cognition === "off" ? "apagada (mundo de control)" : m.cognition}`,
    `- Enrutado y precios: en manifest.json`,
    `- Fecha: ${m.createdAt}`,
    "",
  ].join("\n");
}
