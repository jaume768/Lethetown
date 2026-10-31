/**
 * Psicología de las metas (lógica pura): avanzar sube la motivación y el ánimo; estancarse sube
 * la frustración; la frustración sostenida baja el ánimo; la probabilidad de abandonar un
 * proyecto o de cambiar de meta vital depende de la personalidad y la edad. El servidor mide el
 * progreso; aquí solo se calcula qué le hace eso a la persona. Ver docs/decisiones/metas.md.
 */
import type { BigFive, Goal } from "@lethetown/shared";
import { z } from "zod";

const unit = (x: number) => z.number().min(0).max(1).default(x);

export const GoalsConfig = z.object({
  enabled: z.boolean().default(true),
  /** Motivación con que nace una meta (0..1). */
  initialMotivation: unit(0.6),
  /** Motivación que da avanzar: + k·(progreso ganado en el día). */
  motivationPerProgress: z.number().min(0).max(5).default(1),
  /** Frustración que se va en un día en que se avanza. */
  frustrationRelief: unit(0.15),
  /** Días de juego sin avanzar a partir de los cuales una meta está estancada. */
  stagnantAfterDays: z.number().positive().default(1),
  /** Frustración por día estancado: k · (0,5 + neuroticismo). */
  frustrationPerStagnantDay: unit(0.12),
  /** Motivación que se pierde por día estancado. */
  motivationDecayPerStagnantDay: unit(0.05),
  /** Ánimo (valencia) por progreso del día: + k·progreso, como mucho `moodMaxPerDay`. */
  moodPerProgress: z.number().min(0).max(2).default(0.4),
  moodMaxPerDay: unit(0.15),
  /** Con frustración media de las metas activas ≥ esto, el ánimo baja `frustrationMoodPenalty` al día. */
  frustrationMoodThreshold: unit(0.6),
  frustrationMoodPenalty: unit(0.06),
  /** Al conseguir una meta: ánimo + esto. */
  achievedMood: unit(0.2),
  /** Al abandonarla: ánimo − esto (y alivio de la frustración). */
  abandonedMood: unit(0.05),
  abandon: z
    .object({
      /** Frustración desde la que se puede abandonar un proyecto o un paso. */
      frustrationMin: unit(0.7),
      /** Probabilidad diaria con frustración 1 y personalidad media. */
      daily: unit(0.25),
      /** Responsabilidad (constancia): × (1 − k·(C − 0,5)·2). */
      conscientiousness: unit(0.6),
      /** Neuroticismo (abandona antes): × (1 + k·(N − 0,5)·2). */
      neuroticism: unit(0.6),
    })
    .prefault({}),
  lifeChange: z
    .object({
      /** Frustración de la meta vital desde la que puede cambiar de rumbo. */
      frustrationMin: unit(0.75),
      /** Probabilidad diaria con frustración 1, personalidad media y 30–65 años. */
      daily: unit(0.08),
      /** Apertura (cambia más): × (1 + k·(O − 0,5)·2). */
      openness: unit(0.7),
      /** Menos de esta edad: × youngFactor; más de `oldAge`: × oldFactor. */
      youngAge: z.number().int().positive().default(30),
      oldAge: z.number().int().positive().default(65),
      youngFactor: z.number().min(0).max(5).default(1.5),
      oldFactor: z.number().min(0).max(5).default(0.4),
    })
    .prefault({}),
  /** Proyectos activos como mucho por agente, y pasos por proyecto. */
  maxActiveProjects: z.number().int().positive().default(3),
  maxStepsPerProject: z.number().int().positive().default(3),
  /** Marcharse del pueblo y volver de visita. */
  departure: z
    .object({
      /** Días de juego entre visitas (0 = no vuelve). */
      visitEveryDays: z.number().nonnegative().default(7),
      /** Minuto del día en que llega de visita y en que se vuelve. */
      visitStart: z
        .number()
        .int()
        .min(0)
        .max(1439)
        .default(10 * 60),
      visitEnd: z
        .number()
        .int()
        .min(0)
        .max(1439)
        .default(19 * 60),
      /** Importancia del recuerdo de quienes se quedan (con el olvido de siempre). */
      memoryImportance: z.number().int().min(1).max(10).default(6),
    })
    .prefault({}),
});
export type GoalsConfig = z.infer<typeof GoalsConfig>;

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const centered = (x: number) => (x - 0.5) * 2;

/** Lo que el día le hizo a una meta y a la persona. */
export interface GoalDayResult {
  motivation: number;
  frustration: number;
  /** Cambio del ánimo (valencia) por esta meta. */
  moodDelta: number;
  /** Por qué, legible (para la auditoría). */
  reason: string;
}

/**
 * Un día de una meta activa: `gained` es el progreso ganado desde la última revisión y
 * `stagnantDays` lo que lleva sin avanzar.
 */
export function goalDay(
  goal: Pick<Goal, "motivation" | "frustration">,
  gained: number,
  stagnantDays: number,
  p: BigFive,
  cfg: GoalsConfig,
): GoalDayResult {
  if (gained > 0) {
    const moodDelta = Math.min(cfg.moodMaxPerDay, cfg.moodPerProgress * gained);
    return {
      motivation: clamp01(goal.motivation + cfg.motivationPerProgress * gained),
      frustration: clamp01(goal.frustration - cfg.frustrationRelief),
      moodDelta,
      reason: `avanzó un ${Math.round(gained * 100)} %: más motivación, menos frustración`,
    };
  }
  if (stagnantDays < cfg.stagnantAfterDays) {
    return { ...goal, moodDelta: 0, reason: "aún es pronto para notar que no avanza" };
  }
  const rise = cfg.frustrationPerStagnantDay * (0.5 + p.neuroticism);
  return {
    motivation: clamp01(goal.motivation - cfg.motivationDecayPerStagnantDay),
    frustration: clamp01(goal.frustration + rise),
    moodDelta: 0,
    reason: `lleva ${Math.floor(stagnantDays)} días sin avanzar: más frustración (neuroticismo ${p.neuroticism.toFixed(2)})`,
  };
}

/** La frustración sostenida de sus metas activas baja el ánimo (cuánto, por día). */
export function frustrationMood(frustrations: number[], cfg: GoalsConfig): number {
  if (!frustrations.length) return 0;
  const mean = frustrations.reduce((a, b) => a + b, 0) / frustrations.length;
  return mean >= cfg.frustrationMoodThreshold ? -cfg.frustrationMoodPenalty : 0;
}

/**
 * Probabilidad diaria de abandonar un proyecto o un paso: solo con frustración alta; menos con
 * responsabilidad (constancia), más con neuroticismo.
 */
export function abandonProbability(frustration: number, p: BigFive, cfg: GoalsConfig): number {
  const a = cfg.abandon;
  if (frustration < a.frustrationMin) return 0;
  const strength = (frustration - a.frustrationMin) / (1 - a.frustrationMin || 1);
  const constancy = Math.max(0, 1 - a.conscientiousness * centered(p.conscientiousness));
  const nerves = Math.max(0, 1 + a.neuroticism * centered(p.neuroticism));
  return clamp01(a.daily * strength * constancy * nerves);
}

/**
 * Probabilidad diaria de cambiar de meta vital: con su frustración alta, más con apertura y
 * juventud, mucho menos de mayor; la responsabilidad también frena.
 */
export function lifeChangeProbability(
  frustration: number,
  p: BigFive,
  age: number,
  cfg: GoalsConfig,
): number {
  const l = cfg.lifeChange;
  if (frustration < l.frustrationMin) return 0;
  const strength = (frustration - l.frustrationMin) / (1 - l.frustrationMin || 1);
  const openness = Math.max(0, 1 + l.openness * centered(p.openness));
  const constancy = Math.max(0, 1 - cfg.abandon.conscientiousness * centered(p.conscientiousness));
  const ageFactor = age < l.youngAge ? l.youngFactor : age > l.oldAge ? l.oldFactor : 1;
  return clamp01(l.daily * strength * openness * constancy * ageFactor);
}
