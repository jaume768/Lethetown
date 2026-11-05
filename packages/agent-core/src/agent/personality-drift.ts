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

/**
 * Lo vivido en una semana que mueve la personalidad. Lo malo también (corrección 3.5): en la
 * partida de una semana, solo pesaba lo bueno y los 20 vecinos derivaban casi igual.
 */
export const EXPERIENCES = [
  "goalAchieved",
  "goalAbandoned",
  "learned",
  "taught",
  "conflict",
  "support",
  /** Le dieron plantón en una cita. */
  "stoodUp",
  /** Una meta estancada (frustración alta al acabar la semana). */
  "goalStalled",
  /** Soledad sostenida (horas con la necesidad social baja, despierto). */
  "lonely",
  /** Le deben algo prestado que no le devuelven. */
  "unpaidLoan",
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
    stoodUp: { neuroticism: 0.004, agreeableness: -0.002 },
    goalStalled: { neuroticism: 0.003, conscientiousness: -0.002 },
    lonely: { neuroticism: 0.003, extraversion: -0.002 },
    unpaidLoan: { agreeableness: -0.003, neuroticism: 0.002 },
  }),
  /**
   * Cuánto de la media del pueblo de esa semana se resta a lo vivido por cada uno (0 = nada,
   * 1 = todo): así la deriva dice en qué se diferencia cada vecino de su semana en el pueblo.
   * La edad no se resta (cada uno la suya).
   */
  relativeToTown: z.number().min(0).max(1).default(1),
  /** Una meta activa con al menos esta frustración al acabar la semana cuenta como estancada. */
  stalledFrustration: z.number().min(0).max(1).default(0.6),
  /** Soledad: despierto con la necesidad social por debajo de esto (0..1)… */
  lonelyBelow: z.number().min(0).max(1).default(0.25),
  /** …cuenta una vez cada estas horas de juego. */
  lonelyHoursPerCount: z.number().positive().default(12),
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

type Delta = Partial<Record<Trait, number>>;

const addTo = (out: Delta, effect: Delta, times = 1) => {
  for (const t of TRAITS) if (effect[t]) out[t] = (out[t] ?? 0) + effect[t]! * times;
};

/** Lo que mueve lo vivido (cada experiencia, como mucho `maxCountPerWeek` veces), sin topes. */
export function livedDrift(lived: Partial<Record<Experience, number>>, cfg: DriftConfig): Delta {
  const out: Delta = {};
  for (const e of EXPERIENCES) {
    const n = Math.min(cfg.maxCountPerWeek, lived[e] ?? 0);
    if (n > 0) addTo(out, cfg.effects[e] ?? {}, n);
  }
  return out;
}

/** Lo que mueve la edad en una semana (principio de madurez; de mayor, algo menos de apertura). */
export function ageDrift(age: number, cfg: DriftConfig): Delta {
  const out: Delta = {};
  if (age < cfg.youngAge) addTo(out, cfg.maturity);
  else if (age <= cfg.oldAge) addTo(out, cfg.maturity, 0.5);
  else addTo(out, cfg.aging);
  return out;
}

/** Con tope por rasgo (`maxPerWeek`) y sin los cambios despreciables. */
function capped(d: Delta, cfg: DriftConfig): Delta {
  const out: Delta = {};
  for (const t of TRAITS) {
    if (d[t] === undefined) continue;
    const v = clamp(d[t]!, -cfg.maxPerWeek, cfg.maxPerWeek);
    if (Math.abs(v) >= 1e-6) out[t] = v;
  }
  return out;
}

/** El cambio de una semana: lo vivido (con tope por experiencia) más la edad, con tope por rasgo. */
export function weeklyDrift(
  lived: Partial<Record<Experience, number>>,
  age: number,
  cfg: DriftConfig,
): Delta {
  const out = livedDrift(lived, cfg);
  addTo(out, ageDrift(age, cfg));
  return capped(out, cfg);
}

/**
 * La deriva de la semana de todo el pueblo: lo vivido por cada uno menos `relativeToTown` × la
 * media del pueblo, más su edad, con tope por rasgo. En una semana buena para casi todos, solo
 * se mueve lo que diferencia a cada uno (corrección 3.5).
 */
export function townWeeklyDrift(
  people: { id: string; age: number; lived: Partial<Record<Experience, number>> }[],
  cfg: DriftConfig,
): Record<string, Delta> {
  const raw = people.map((p) => ({ p, d: livedDrift(p.lived, cfg) }));
  const mean: Delta = {};
  for (const { d } of raw) addTo(mean, d, 1 / Math.max(1, raw.length));
  const out: Record<string, Delta> = {};
  for (const { p, d } of raw) {
    const mine: Delta = { ...d };
    addTo(mine, mean, -cfg.relativeToTown);
    addTo(mine, ageDrift(p.age, cfg));
    out[p.id] = capped(mine, cfg);
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
