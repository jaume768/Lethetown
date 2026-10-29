/**
 * Codificación y sueño (fase 4 de la psicología). Lo que se vive con atención y una activación
 * moderada se graba mejor (curva de Yerkes-Dodson); con poca energía, de camino o pendiente de
 * otra conversación, peor; y con una activación extrema solo queda la esencia. Dormir bien
 * consolida (sobre todo lo emocional); dormir mal deja peor memoria y peor ánimo al día
 * siguiente. Lógica pura.
 */
import type { Mood } from "@lethetown/shared";
import { z } from "zod";

export const EncodingConfig = z.object({
  enabled: z.boolean().default(true),
  /** Activación (0..1) con la que mejor se graba (pico de la curva de Yerkes-Dodson). */
  optimalArousal: z.number().min(0).max(1).default(0.55),
  /** Anchura de la campana (desviación típica, en unidades de activación). */
  arousalWidth: z.number().positive().default(0.3),
  /** Fuerza inicial mínima por la activación (lejos del pico). */
  minArousalFactor: z.number().min(0).max(1).default(0.6),
  /** Activación a partir de la cual solo se guarda la esencia (sin detalles). */
  overwhelmArousal: z.number().min(0).max(1).default(0.9),
  /** Energía por debajo de la cual se graba peor, hasta × `lowEnergyFactor` con energía 0. */
  lowEnergy: z.number().min(0).max(1).default(0.3),
  lowEnergyFactor: z.number().min(0).max(1).default(0.6),
  /** De camino a otro sitio se presta menos atención. */
  walkingFactor: z.number().min(0).max(1).default(0.75),
  /** Pendiente de otra conversación (llegadas, lo que se oye de otros). */
  distractedFactor: z.number().min(0).max(1).default(0.7),
  /** Con deuda de sueño máxima (1) se graba × (1 − esto). */
  sleepDebtPenalty: z.number().min(0).max(1).default(0.4),
  /** Fuerza inicial mínima de cualquier recuerdo. */
  minStrength: z.number().min(0).max(1).default(0.2),
});
export type EncodingConfig = z.infer<typeof EncodingConfig>;

export const SleepConfig = z.object({
  /**
   * Calidad del sueño (0..1, techo de la energía que se recupera durmiendo). Cada punto de
   * activación por encima de 0.5 al acostarse la baja (`arousalPenalty` con activación 1)…
   */
  arousalPenalty: z.number().min(0).max(1).default(0.4),
  /** …y la preocupación también: × |valencia negativa| × (0.5 + neuroticismo). */
  worryPenalty: z.number().min(0).max(1).default(0.5),
  minQuality: z.number().min(0).max(1).default(0.4),
  /** Energía al despertar por debajo de la cual ha dormido poco (deuda = 1 − energía / esto). */
  restedEnergy: z.number().min(0).max(1).default(0.85),
  /** Bajada de la valencia (al despertar y en su nivel base ese día) con deuda máxima. */
  debtValence: z.number().min(0).max(1).default(0.3),
  /** Consolidación emocional: los recuerdos del día con |valencia| ≥ esto se refuerzan… */
  emotionalMin: z.number().min(0).max(1).default(0.4),
  /** …× (1 + esto · |valencia|) en fuerza (hasta 1) y estabilidad. */
  emotionalGain: z.number().min(0).default(0.5),
});
export type SleepConfig = z.infer<typeof SleepConfig>;

const clamp01 = (x: number) => (Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0);

/** Curva de Yerkes-Dodson: 1 en la activación óptima, `minArousalFactor` lejos de ella. */
export function yerkesDodson(arousal: number, cfg: EncodingConfig): number {
  const d = arousal - cfg.optimalArousal;
  const bell = Math.exp(-(d * d) / (2 * cfg.arousalWidth * cfg.arousalWidth));
  return cfg.minArousalFactor + (1 - cfg.minArousalFactor) * bell;
}

/** Activación que provoca algo según su importancia (1-10) y su carga emotiva (-1..1). */
export function eventArousal(importance: number, valence: number): number {
  return clamp01((importance / 10) * 0.7 + Math.abs(valence) * 0.5);
}

export interface EncodingContext {
  arousal: number;
  energy: number;
  walking: boolean;
  distracted: boolean;
  /** Deuda de sueño de hoy (0..1). */
  sleepDebt: number;
}

/** Fuerza inicial (0..1) con la que se graba algo según la atención y el estado. */
export function encodingStrength(ctx: EncodingContext, cfg: EncodingConfig): number {
  if (!cfg.enabled) return 1;
  let f = yerkesDodson(ctx.arousal, cfg);
  if (ctx.energy < cfg.lowEnergy) {
    f *= cfg.lowEnergyFactor + (1 - cfg.lowEnergyFactor) * (ctx.energy / cfg.lowEnergy);
  }
  if (ctx.walking) f *= cfg.walkingFactor;
  if (ctx.distracted) f *= cfg.distractedFactor;
  f *= 1 - cfg.sleepDebtPenalty * clamp01(ctx.sleepDebt);
  return Math.max(cfg.minStrength, Math.min(1, f));
}

/** ¿Tan intenso que solo se graba la esencia? */
export function overwhelmed(arousal: number, cfg: EncodingConfig): boolean {
  return cfg.enabled && arousal >= cfg.overwhelmArousal;
}

/**
 * Esencia sin LLM (para lo vivido con activación extrema): sin frases literales ni cifras.
 * "Oí a Rafael decir "el 3 cierro la taberna"" → "Oí a Rafael decir algo".
 */
export function reduceDetails(text: string): string {
  const reduced = text
    .replace(/["«“][^"»”]*["»”]/g, "algo")
    .replace(/⟦[^⟧]*⟧/g, "algo")
    .replace(/\b\d+([:.,]\d+)?\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return reduced || text;
}

/** Calidad del sueño al acostarse (0..1): la activación y la preocupación lo quitan. */
export function sleepQuality(mood: Mood, neuroticism: number, cfg: SleepConfig): number {
  const tense = Math.max(0, (mood.arousal - 0.5) * 2) * cfg.arousalPenalty;
  const worry = Math.max(0, -mood.valence) * (0.5 + neuroticism) * cfg.worryPenalty;
  return Math.max(cfg.minQuality, Math.min(1, 1 - tense - worry));
}

/** Deuda de sueño al despertar (0 = descansado, 1 = sin dormir). */
export function sleepDebt(energyAtWake: number, cfg: SleepConfig): number {
  return energyAtWake >= cfg.restedEnergy ? 0 : clamp01(1 - energyAtWake / cfg.restedEnergy);
}
