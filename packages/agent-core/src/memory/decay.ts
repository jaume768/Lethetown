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
  /**
   * Tope de la estabilidad (horas de juego). Sin él, lo que se evoca en cada decisión (las
   * metas) crecía ×1,8 por evocación hasta salirse del `real` de Postgres en 3 días de juego.
   */
  maxStabilityHours: number;
}

export const DEFAULT_DECAY: DecayConfig = {
  baseStabilityHours: 12,
  importanceBoost: 0.35,
  emotionBoost: 1.5,
  recallStrengthGain: 0.6,
  recallStabilityGrowth: 1.8,
  maxStabilityHours: 87_600,
};

/** La estabilidad, como mucho `maxStabilityHours` (10 años de juego por defecto). */
export function capStability(stability: number, config: DecayConfig = DEFAULT_DECAY): number {
  return Math.min(stability, config.maxStabilityHours);
}

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
 * Multiplicador de la estabilidad al evocar (efecto de espaciado): k(Δt) = 1 + (k_max − 1) ·
 * (1 − e^(−Δt/τ)), con Δt el tiempo de juego desde la evocación anterior y τ la estabilidad
 * actual (las dos en horas). k_max = `recallStabilityGrowth` × la dificultad (×1,8 a ×3,6, la
 * regla de siempre). Evocar algo un minuto después casi no consolida; evocarlo cuando ya se
 * estaba olvidando, casi k_max. Corrección 3.5: las metas, evocadas en cada decisión (cada
 * 10 min), acumulaban 142 evocaciones ×1,8 en 3 días.
 */
export function spacingFactor(
  memory: Pick<MemoryRecord, "strength" | "stability" | "lastAccessedAt">,
  now: number,
  config: DecayConfig = DEFAULT_DECAY,
): number {
  const s = currentStrength(memory, now);
  const kMax = config.recallStabilityGrowth * (1 + (1 - s));
  const hours = Math.max(0, now - memory.lastAccessedAt) / MINUTES_PER_HOUR;
  return 1 + (kMax - 1) * (1 - Math.exp(-hours / memory.stability));
}

/**
 * Refuerzo al recordar (repetición espaciada): la fuerza sube hacia 1 y la estabilidad crece
 * según lo espaciado de la evocación (`spacingFactor`). Recordar algo que ya estaba debilitado
 * consolida más ("dificultad deseable").
 */
export function reinforce(
  memory: Pick<MemoryRecord, "strength" | "stability" | "lastAccessedAt" | "accessCount">,
  now: number,
  config: DecayConfig = DEFAULT_DECAY,
): Pick<MemoryRecord, "strength" | "stability" | "lastAccessedAt" | "accessCount"> {
  const s = currentStrength(memory, now);
  return {
    strength: Math.min(1, s + (1 - s) * config.recallStrengthGain),
    stability: capStability(memory.stability * spacingFactor(memory, now, config), config),
    lastAccessedAt: now,
    accessCount: memory.accessCount + 1,
  };
}
