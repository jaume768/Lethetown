/**
 * Deriva lenta de la personalidad (lógica pura): los Big Five cambian muy despacio con lo que
 * se vive (conseguir o abandonar metas, aprender y enseñar, los conflictos, el apoyo de los
 * demás) y con la edad (de joven se gana constancia y calma; el «principio de madurez»). Unas
 * centésimas por semana como mucho, con límites y un máximo total desde la semilla. El servidor
 * (sistema `personality`) cuenta las experiencias; aquí, cuánto cambian. Ver
 * docs/decisiones/psicologia.md.
 */
import type { BigFive } from "@lethetown/shared";
import { z } from "zod";

export const TRAITS = [
  "openness",
  "conscientiousness",
  "extraversion",
  "agreeableness",
  "neuroticism",
] as const;
export type Trait = (typeof TRAITS)[number];

/** Lo vivido en una semana que mueve la personalidad. */
export const EXPERIENCES = [
  "goalAchieved",
  "goalAbandoned",
  "learned",
  "taught",
  "conflict",
  "support",
] as const;
export type Experience = (typeof EXPERIENCES)[number];

const Effect = z.partialRecord(z.enum(TRAITS), z.number().min(-0.05).max(0.05));

export const DriftConfig = z.object({
  enabled: z.boolean().default(true),
  /** Cambio máximo de cada rasgo en una semana de juego. */
  maxPerWeek: z.number().min(0).max(0.1).default(0.02),
  /** Lo más que se aleja cada rasgo de la semilla (nadie cambia de forma de ser en un mes). */
  maxTotal: z.number().min(0).max(0.5).default(0.15),
  /** Límites de cualquier rasgo. */
  floor: z.number().min(0).max(0.5).default(0.05),
  ceiling: z.number().min(0.5).max(1).default(0.95),
  /** Lo que mueve cada experiencia (por vez), antes del tope semanal. */
  effects: z.record(z.enum(EXPERIENCES), Effect).default({
    goalAchieved: { conscientiousness: 0.005, neuroticism: -0.004 },
    goalAbandoned: { conscientiousness: -0.004, neuroticism: 0.005 },
    learned: { openness: 0.004 },
    taught: { agreeableness: 0.003, extraversion: 0.002 },
    conflict: { agreeableness: -0.003, neuroticism: 0.004 },
    support: { neuroticism: -0.002, agreeableness: 0.002, extraversion: 0.001 },
  }),
  /** Una experiencia cuenta como mucho estas veces por semana (diez plantones no son diez veces). */
  maxCountPerWeek: z.number().int().positive().default(4),
  /** Madurez por semana: de joven (< 30), constancia y amabilidad suben y el neuroticismo baja. */
  youngAge: z.number().int().positive().default(30),
  oldAge: z.number().int().positive().default(65),
  maturity: Effect.default({ conscientiousness: 0.002, agreeableness: 0.001, neuroticism: -0.002 }),
  /** De mayor (> 65), la apertura baja un poco. */
  aging: Effect.default({ openness: -0.001 }),
});
export type DriftConfig = z.infer<typeof DriftConfig>;

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/** El cambio de una semana: lo vivido (con tope por experiencia) más la edad, con tope por rasgo. */
export function weeklyDrift(
  lived: Partial<Record<Experience, number>>,
  age: number,
  cfg: DriftConfig,
): Partial<Record<Trait, number>> {
  const out: Partial<Record<Trait, number>> = {};
  const add = (effect: Partial<Record<Trait, number>>, times = 1) => {
    for (const t of TRAITS) if (effect[t]) out[t] = (out[t] ?? 0) + effect[t]! * times;
  };
  for (const e of EXPERIENCES) {
    const n = Math.min(cfg.maxCountPerWeek, lived[e] ?? 0);
    if (n > 0) add(cfg.effects[e] ?? {}, n);
  }
  if (age < cfg.youngAge) add(cfg.maturity);
  else if (age <= cfg.oldAge) add(cfg.maturity, 0.5);
  else add(cfg.aging);
  for (const t of TRAITS) {
    if (out[t] === undefined) continue;
    out[t] = clamp(out[t]!, -cfg.maxPerWeek, cfg.maxPerWeek);
    if (Math.abs(out[t]!) < 1e-6) delete out[t];
  }
  return out;
}

/** Aplica el cambio sin salirse de los límites ni alejarse más de `maxTotal` de la semilla. */
export function applyDrift(
  current: BigFive,
  seed: BigFive,
  delta: Partial<Record<Trait, number>>,
  cfg: DriftConfig,
): BigFive {
  const next = { ...current };
  for (const t of TRAITS) {
    const d = delta[t];
    if (!d) continue;
    const v = clamp(current[t] + d, seed[t] - cfg.maxTotal, seed[t] + cfg.maxTotal);
    next[t] = Math.round(clamp(v, cfg.floor, cfg.ceiling) * 1000) / 1000;
  }
  return next;
}

/** Sin género (sirve para cualquier vecino): «con más constancia», «con más calma». */
const LABEL: Record<Trait, [string, string]> = {
  openness: ["con más ganas de cosas nuevas", "con más apego a lo de siempre"],
  conscientiousness: ["con más constancia", "con menos constancia"],
  extraversion: ["con más ganas de compañía", "con más necesidad de estar a solas"],
  agreeableness: ["con más paciencia con los demás", "con menos paciencia con los demás"],
  neuroticism: ["con más inquietud", "con más calma"],
};

/** «con más constancia (+0,010), con más calma (−0,008)» (para la auditoría y el evento). */
export function driftText(before: BigFive, after: BigFive): string {
  const parts = TRAITS.filter((t) => Math.abs(after[t] - before[t]) >= 0.001).map(
    (t) =>
      `${LABEL[t][after[t] > before[t] ? 0 : 1]} (${after[t] - before[t] >= 0 ? "+" : ""}${(after[t] - before[t]).toFixed(3)})`,
  );
  return parts.length ? parts.join(", ") : "";
}
