/**
 * Ánimo y necesidades (fase 3 de la psicología). El ánimo es bidimensional (modelo circumplejo
 * de Russell): valencia (-1..1, desagradable → agradable) y activación (0..1, calma → tensión).
 * Cada agente tiene un nivel base según su personalidad y el ánimo vuelve a él con una vida
 * media; las necesidades lo empujan (hambre → irritable, cansancio → apagado, soledad → triste).
 * Lógica pura: el servidor la llama en cada tick.
 */
import type { ActivityKind, BigFive, Mood, Needs } from "@lethetown/shared";
import { z } from "zod";

export const MoodConfig = z.object({
  /** Valencia base de alguien en la media de todo (la gente suele estar ligeramente bien). */
  baseValence: z.number().min(-1).max(1).default(0.2),
  /** Cuánto sube la valencia base por extraversión: + k·(extraversion − 0.5)·2. */
  extraversionValence: z.number().min(0).max(1).default(0.15),
  /** Cuánto baja la valencia base por neuroticismo: − k·(neuroticism − 0.5)·2. */
  neuroticismValence: z.number().min(0).max(1).default(0.25),
  /** Activación base de alguien en la media. */
  baseArousal: z.number().min(0).max(1).default(0.4),
  /** Activación base: + k·(extraversion − 0.5)·2 y + k·(neuroticism − 0.5)·2. */
  extraversionArousal: z.number().min(0).max(1).default(0.15),
  neuroticismArousal: z.number().min(0).max(1).default(0.1),
  /** Vida media (minutos de juego) de la vuelta de la valencia a su nivel base. */
  halfLifeMinutes: z.number().positive().default(240),
  /** Vida media de la activación (se despierta o se calma antes de lo que cambia el humor). */
  arousalHalfLifeMinutes: z.number().positive().default(60),
  /** Vida media mientras duerme (dormir restablece el ánimo, aunque no del todo). */
  sleepHalfLifeMinutes: z.number().positive().default(120),
  /** Activación hacia la que tiende mientras duerme. */
  sleepArousal: z.number().min(0).max(1).default(0.15),
  /** Peso (0..1) de lo que percibe en el ánimo en cada tick con percepciones. */
  perceptionWeight: z.number().min(0).max(1).default(0.2),
  /** Hambre (0..1) a partir de la cual irrita: baja la valencia y sube la activación, por hora. */
  hungerThreshold: z.number().min(0).max(1).default(0.7),
  hungerValencePerHour: z.number().min(0).default(0.15),
  hungerArousalPerHour: z.number().min(0).default(0.12),
  /** Energía (0..1) por debajo de la cual apaga: baja la valencia y la activación, por hora. */
  tiredThreshold: z.number().min(0).max(1).default(0.3),
  tiredValencePerHour: z.number().min(0).default(0.08),
  tiredArousalPerHour: z.number().min(0).default(0.15),
  /** Social (0..1) por debajo de la cual se siente solo: baja la valencia, × (0.5 + extraversion). */
  lonelyThreshold: z.number().min(0).max(1).default(0.3),
  lonelyValencePerHour: z.number().min(0).default(0.1),
});
export type MoodConfig = z.infer<typeof MoodConfig>;

/** Ritmos de las necesidades (por hora de juego); los de antes de la fase 3 son los de defecto. */
export const NeedsConfig = z.object({
  energySleepPerHour: z.number().min(0).default(0.11),
  energyAwakePerHour: z.number().min(0).default(0.05),
  hungerEatPerHour: z.number().min(0).default(0.5),
  hungerSleepPerHour: z.number().min(0).default(0.02),
  hungerAwakePerHour: z.number().min(0).default(0.07),
  /** Pérdida de la necesidad social, × (0.5 + extraversion): los extravertidos la notan antes. */
  socialPerHour: z.number().min(0).default(0.04),
  /**
   * Lo que recupera un introvertido (de energía y social) estando solo en algo tranquilo,
   * × (0.5 − extraversion)·2 (nada si es extravertido).
   */
  introvertRecoveryPerHour: z.number().min(0).default(0.04),
});
export type NeedsConfig = z.infer<typeof NeedsConfig>;

const clamp = (x: number, lo: number, hi: number) =>
  Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : lo;
const clamp01 = (x: number) => clamp(x, 0, 1);

/** Nivel base del ánimo según la personalidad. */
export function baselineMood(p: BigFive, cfg: MoodConfig): { valence: number; arousal: number } {
  return {
    valence: clamp(
      cfg.baseValence +
        cfg.extraversionValence * (p.extraversion - 0.5) * 2 -
        cfg.neuroticismValence * (p.neuroticism - 0.5) * 2,
      -1,
      1,
    ),
    arousal: clamp01(
      cfg.baseArousal +
        cfg.extraversionArousal * (p.extraversion - 0.5) * 2 +
        cfg.neuroticismArousal * (p.neuroticism - 0.5) * 2,
    ),
  };
}

/** Etiqueta del modelo circumplejo para una valencia y una activación. */
export function circumplexLabel(valence: number, arousal: number): string {
  if (valence >= 0.1) {
    if (arousal >= 0.7) return valence > 0.5 ? "eufórico" : "animado";
    if (arousal >= 0.35) return "contento";
    return valence > 0.4 ? "relajado" : "tranquilo";
  }
  if (valence <= -0.1) {
    if (arousal >= 0.65) return valence < -0.4 ? "irritable" : "nervioso";
    if (arousal >= 0.35) return valence < -0.5 ? "triste" : "preocupado";
    return valence < -0.5 ? "abatido" : "apagado";
  }
  if (arousal >= 0.7) return "inquieto";
  if (arousal < 0.2) return "adormilado";
  return "neutral";
}

export function makeMood(valence: number, arousal: number): Mood {
  const v = clamp(valence, -1, 1);
  const a = clamp01(arousal);
  return { valence: v, arousal: a, label: circumplexLabel(v, a) };
}

/** "contento (activación media)": el ánimo para los prompts. */
export function describeMood(mood: Mood): string {
  const a = mood.arousal;
  const level = a >= 0.66 ? "alta" : a >= 0.33 ? "media" : "baja";
  return `${mood.label} (activación ${level})`;
}

/** Actividades tranquilas en las que un introvertido recarga pilas si está solo. */
const QUIET: ReadonlySet<ActivityKind> = new Set(["read", "sit", "idle", "cook"]);

/** Necesidades tras `minutes` de juego haciendo `kind`. */
export function stepNeeds(
  needs: Needs,
  ctx: { kind: ActivityKind; alone: boolean; extraversion: number },
  minutes: number,
  cfg: NeedsConfig,
): Needs {
  const h = minutes / 60;
  const sleeping = ctx.kind === "sleep";
  const eating = ctx.kind === "eat";
  const introvert = Math.max(0, (0.5 - ctx.extraversion) * 2);
  const recharge = !sleeping && ctx.alone && QUIET.has(ctx.kind) ? introvert : 0;
  return {
    energy: clamp01(
      needs.energy +
        (sleeping ? cfg.energySleepPerHour * h : -cfg.energyAwakePerHour * h) +
        recharge * cfg.introvertRecoveryPerHour * h,
    ),
    hunger: clamp01(
      needs.hunger +
        (eating
          ? -cfg.hungerEatPerHour * h
          : sleeping
            ? cfg.hungerSleepPerHour * h
            : cfg.hungerAwakePerHour * h),
    ),
    social: clamp01(
      needs.social -
        cfg.socialPerHour * (0.5 + ctx.extraversion) * h +
        recharge * cfg.introvertRecoveryPerHour * h,
    ),
  };
}

/**
 * Ánimo tras `minutes`: vuelve hacia su nivel base (más rápido durmiendo) y las necesidades lo
 * empujan: hambre → irritable, cansancio → apagado, soledad → triste (más en extravertidos).
 */
export function stepMood(
  mood: Mood,
  ctx: {
    needs: Needs;
    sleeping: boolean;
    baseline: { valence: number; arousal: number };
    extraversion: number;
  },
  minutes: number,
  cfg: MoodConfig,
): Mood {
  const h = minutes / 60;
  const halfLife = ctx.sleeping ? cfg.sleepHalfLifeMinutes : cfg.halfLifeMinutes;
  const k = 1 - Math.pow(0.5, minutes / halfLife);
  const ka = 1 - Math.pow(0.5, minutes / cfg.arousalHalfLifeMinutes);
  const arousalTarget = ctx.sleeping ? cfg.sleepArousal : ctx.baseline.arousal;
  let v = mood.valence + (ctx.baseline.valence - mood.valence) * k;
  let a = mood.arousal + (arousalTarget - mood.arousal) * ka;
  if (!ctx.sleeping) {
    const n = ctx.needs;
    if (n.hunger > cfg.hungerThreshold) {
      const x = (n.hunger - cfg.hungerThreshold) / (1 - cfg.hungerThreshold);
      v -= cfg.hungerValencePerHour * x * h;
      a += cfg.hungerArousalPerHour * x * h;
    }
    if (n.energy < cfg.tiredThreshold) {
      const x = 1 - n.energy / cfg.tiredThreshold;
      v -= cfg.tiredValencePerHour * x * h;
      a -= cfg.tiredArousalPerHour * x * h;
    }
    if (n.social < cfg.lonelyThreshold) {
      const x = 1 - n.social / cfg.lonelyThreshold;
      v -= cfg.lonelyValencePerHour * (0.5 + ctx.extraversion) * x * h;
    }
  }
  return makeMood(v, a);
}

/** Lo percibido mueve el ánimo: valencia media y activación según importancia y carga emotiva. */
export function blendPerceptions(
  mood: Mood,
  ratings: { importance: number; valence: number }[],
  weight: number,
): Mood {
  if (!ratings.length) return mood;
  const valence = ratings.reduce((s, r) => s + r.valence, 0) / ratings.length;
  const arousal =
    ratings.reduce(
      (s, r) => s + clamp01((r.importance / 10) * 0.7 + Math.abs(r.valence) * 0.5),
      0,
    ) / ratings.length;
  return makeMood(
    (1 - weight) * mood.valence + weight * valence,
    (1 - weight) * mood.arousal + weight * arousal,
  );
}
