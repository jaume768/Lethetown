import type { MemoryRecord } from "./types";

export interface DecayConfig {
  /** Estabilidad base (horas de juego) de un recuerdo neutro de importancia 1. */
  baseStabilityHours: number;
  /** Cuánto alarga la estabilidad inicial cada punto de importancia (multiplicativo). */
  importanceBoost: number;
  /** Cuánto la alarga la carga emocional |valence| (multiplicativo). */
  emotionBoost: number;
  /** Fracción de lo que falta hasta 1 que recupera la fuerza al recordar. */
  recallStrengthGain: number;
  /** Factor de crecimiento de la estabilidad al recordar (antes del bonus por dificultad). */
  recallStabilityGrowth: number;
}

export const DEFAULT_DECAY: DecayConfig = {
  baseStabilityHours: 12,
  importanceBoost: 0.35,
  emotionBoost: 1.5,
  recallStrengthGain: 0.6,
  recallStabilityGrowth: 1.8,
};

const MINUTES_PER_HOUR = 60;

/** Estabilidad inicial: los recuerdos importantes o emotivos duran más. */
export function initialStability(
  importance: number,
  emotionalValence: number,
  config: DecayConfig = DEFAULT_DECAY,
): number {
  return (
    config.baseStabilityHours *
    (1 + (importance - 1) * config.importanceBoost) *
    (1 + Math.abs(emotionalValence) * config.emotionBoost)
  );
}

/** Fuerza actual con decaimiento exponencial: s(t) = s0 · e^(−Δt / estabilidad). */
export function currentStrength(
  memory: Pick<MemoryRecord, "strength" | "stability" | "lastAccessedAt">,
  now: number,
): number {
  const hours = Math.max(0, now - memory.lastAccessedAt) / MINUTES_PER_HOUR;
  return memory.strength * Math.exp(-hours / memory.stability);
}

/**
 * Refuerzo al recordar (repetición espaciada): la fuerza sube hacia 1 y la estabilidad crece.
 * Recordar algo que ya estaba debilitado consolida más ("dificultad deseable").
 */
export function reinforce(
  memory: Pick<MemoryRecord, "strength" | "stability" | "lastAccessedAt" | "accessCount">,
  now: number,
  config: DecayConfig = DEFAULT_DECAY,
): Pick<MemoryRecord, "strength" | "stability" | "lastAccessedAt" | "accessCount"> {
  const s = currentStrength(memory, now);
  const difficultyBonus = 1 + (1 - s);
  return {
    strength: Math.min(1, s + (1 - s) * config.recallStrengthGain),
    stability: memory.stability * config.recallStabilityGrowth * difficultyBonus,
    lastAccessedAt: now,
    accessCount: memory.accessCount + 1,
  };
}
