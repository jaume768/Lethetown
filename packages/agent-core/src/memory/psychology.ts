/**
 * Perfil psicológico de la memoria (fase 2): personalidad (Big Five), particularidades de la
 * semilla (`memoryProfile`) y efectos de la edad se combinan en un perfil por agente que la
 * memoria aplica al decaimiento, la recuperación y la confusión de fuente. Lógica pura.
 */
import type { AgentSeed, MemoryType } from "@lethetown/shared";
import { z } from "zod";

/** Coeficientes de la edad y la personalidad (en `MemoryConfig.profile`). */
export const ProfileConfig = z.object({
  /** Edad (años) a partir de la cual la memoria episódica empieza a decaer antes. */
  olderFromAge: z.number().int().positive().default(65),
  /** Fracción de estabilidad episódica que se pierde por cada año por encima de `olderFromAge`. */
  olderEpisodicLossPerYear: z.number().min(0).max(1).default(0.02),
  /** Multiplicador mínimo de la estabilidad episódica por la edad. */
  olderEpisodicMin: z.number().min(0).max(1).default(0.5),
  /** Multiplicador de la estabilidad semántica en los mayores (lo sabido aguanta). */
  olderSemanticBoost: z.number().positive().default(1.2),
  /** Pico de reminiscencia: multiplicador de la estabilidad de los recuerdos de juventud. */
  reminiscenceStability: z.number().positive().default(3),
  /** Pico de reminiscencia: bonus (fracción) a la puntuación de recuperación de esos recuerdos. */
  reminiscenceRecallBoost: z.number().min(0).default(0.3),
  /** Edad (años) hasta la que se es niño a efectos de memoria. */
  childUntilAge: z.number().int().positive().default(12),
  /** Multiplicadores de confusión de fuente y sugestionabilidad en niños. */
  childSourceConfusion: z.number().positive().default(1.8),
  childSuggestibility: z.number().positive().default(1.6),
  /** Edad hasta la que se es adolescente (menor) y sus multiplicadores, más suaves. */
  teenUntilAge: z.number().int().positive().default(17),
  teenSourceConfusion: z.number().positive().default(1.2),
  teenSuggestibility: z.number().positive().default(1.2),
  /**
   * Responsabilidad → olvido de intenciones: × (1 + k·(0.5 − conscientiousness)·2).
   * Con k = 0.5, alguien muy responsable (1) olvida la mitad y alguien muy despistado (0), 1.5×.
   */
  conscientiousnessIntention: z.number().min(0).max(1).default(0.5),
  /** Neuroticismo → peso de la congruencia con el ánimo: × (1 + k·(neuroticism − 0.5)·2). */
  neuroticismMoodCongruence: z.number().min(0).max(1).default(0.5),
  /** Amabilidad → sugestionabilidad (se cree lo que le cuentan): × (1 + k·(agreeableness − 0.5)·2). */
  agreeablenessSuggestibility: z.number().min(0).max(1).default(0.3),
  /** Apertura → estabilidad semántica (aprende y relaciona): × (1 + k·(openness − 0.5)·2). */
  opennessSemantic: z.number().min(0).max(1).default(0.2),
  /**
   * Sesgo de negatividad: un recuerdo negativo dura × (1 + |valencia|·(sesgo − 1)) frente a uno
   * positivo de la misma |valencia|. 1 = sin sesgo.
   */
  negativityBias: z.number().min(1).default(1.5),
  /** Neuroticismo → sesgo de negatividad: (sesgo − 1) × (1 + k·(neuroticism − 0.5)·2). */
  neuroticismNegativity: z.number().min(0).max(1).default(0.5),
});
export type ProfileConfig = z.infer<typeof ProfileConfig>;

/** Perfil de memoria ya combinado (multiplicadores; 1 = como todo el mundo). */
export interface MemoryProfile {
  episodicStability: number;
  semanticStability: number;
  sourceConfusion: number;
  dateForgetting: number;
  intentionForgetting: number;
  suggestibility: number;
  /** Estabilidad extra de los recuerdos de juventud (1 = ninguna). */
  reminiscenceStability: number;
  /** Bonus a la recuperación de los recuerdos de juventud (0 = ninguno). */
  reminiscenceRecall: number;
  /** Multiplicador del peso de la congruencia con el ánimo. */
  moodCongruence: number;
  /** Sesgo de negatividad (1 = ninguno). */
  negativityBias: number;
}

export const NEUTRAL_PROFILE: MemoryProfile = {
  episodicStability: 1,
  semanticStability: 1,
  sourceConfusion: 1,
  dateForgetting: 1,
  intentionForgetting: 1,
  suggestibility: 1,
  reminiscenceStability: 1,
  reminiscenceRecall: 0,
  moodCongruence: 1,
  negativityBias: 1,
};

/** Desplazamiento lineal alrededor de la media: 1 + k·(x − 0.5)·2. */
const around = (x: number, k: number) => 1 + k * (x - 0.5) * 2;

/** Combina semilla, edad y personalidad en el perfil de memoria del agente. */
export function resolveProfile(
  seed: Pick<AgentSeed, "age" | "personality" | "memoryProfile">,
  cfg: ProfileConfig,
): MemoryProfile {
  const own = seed.memoryProfile;
  const p = seed.personality;
  const older = Math.max(0, seed.age - cfg.olderFromAge);
  const isOlder = seed.age >= cfg.olderFromAge;
  const child = seed.age <= cfg.childUntilAge;
  const teen = !child && seed.age <= cfg.teenUntilAge;
  const ageEpisodic = Math.max(cfg.olderEpisodicMin, 1 - older * cfg.olderEpisodicLossPerYear);
  return {
    episodicStability: (own?.episodicStability ?? 1) * ageEpisodic,
    semanticStability:
      (own?.semanticStability ?? 1) *
      (isOlder ? cfg.olderSemanticBoost : 1) *
      around(p.openness, cfg.opennessSemantic),
    sourceConfusion:
      (own?.sourceConfusion ?? 1) *
      (child ? cfg.childSourceConfusion : teen ? cfg.teenSourceConfusion : 1),
    dateForgetting: own?.dateForgetting ?? 1,
    intentionForgetting:
      (own?.intentionForgetting ?? 1) *
      Math.max(0.1, around(1 - p.conscientiousness, cfg.conscientiousnessIntention)),
    suggestibility:
      (own?.suggestibility ?? 1) *
      (child ? cfg.childSuggestibility : teen ? cfg.teenSuggestibility : 1) *
      around(p.agreeableness, cfg.agreeablenessSuggestibility),
    reminiscenceStability: isOlder ? cfg.reminiscenceStability : 1,
    reminiscenceRecall: isOlder ? cfg.reminiscenceRecallBoost : 0,
    moodCongruence: Math.max(0, around(p.neuroticism, cfg.neuroticismMoodCongruence)),
    negativityBias:
      1 + (cfg.negativityBias - 1) * Math.max(0, around(p.neuroticism, cfg.neuroticismNegativity)),
  };
}

/** Perfiles de todos los agentes del pueblo, por id. */
export function profilesFor(
  seeds: Pick<AgentSeed, "id" | "age" | "personality" | "memoryProfile">[],
  cfg: ProfileConfig,
): Record<string, MemoryProfile> {
  return Object.fromEntries(seeds.map((s) => [s.id, resolveProfile(s, cfg)]));
}

/** ¿Habla de fechas u horas concretas? (lo que olvida quien es "olvidadizo con las fechas"). */
export function mentionsDate(text: string): boolean {
  return /(aniversario|cumpleaños|fecha|el día \d+|\b\d{1,2}:\d{2}\b|a las (una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|\d)|lunes|martes|miércoles|jueves|viernes|sábado|domingo|semana que viene|mes que viene|enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)/i.test(
    text,
  );
}

/** ¿Es un recuerdo de juventud? (para el pico de reminiscencia de los mayores). */
export function isYouthMemory(text: string): boolean {
  return /(de joven|juventud|cuando era (joven|niñ|pequeñ|chic)|de niñ[oa]|de pequeñ[oa]|nací|mi infancia|hace (\d{2,}|veinte|treinta|cuarenta|cincuenta|sesenta|setenta|ochenta) años)/i.test(
    text,
  );
}

/** Lo vivido frente a lo sabido. */
export function isEpisodic(type: MemoryType): boolean {
  return type === "observation" || type === "plan";
}

/**
 * Multiplicador de la estabilidad inicial de un recuerdo según el perfil del dueño: episódico
 * o semántico, fechas (si las olvida) y pico de reminiscencia.
 */
export function stabilityFactor(
  profile: MemoryProfile,
  memory: { type: MemoryType; text: string; youth?: boolean; valence?: number },
): number {
  let f = isEpisodic(memory.type) ? profile.episodicStability : profile.semanticStability;
  if (mentionsDate(memory.text)) f /= profile.dateForgetting;
  if (memory.youth) f *= profile.reminiscenceStability;
  // Sesgo de negatividad: lo malo se graba más hondo que lo bueno de igual intensidad.
  const v = memory.valence ?? 0;
  if (v < 0) f *= 1 + Math.abs(v) * (profile.negativityBias - 1);
  return f;
}
