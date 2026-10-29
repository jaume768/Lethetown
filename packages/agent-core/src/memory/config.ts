import { z } from "zod";

/**
 * Parámetros de la memoria humana. Todos tienen valor por defecto; el servidor puede
 * sobrescribirlos con config/memory.json (validado con este esquema).
 * Unidades de tiempo: horas de juego salvo que se diga otra cosa.
 */
export const MemoryConfig = z.object({
  retrieval: z
    .object({
      /** Pesos de la media ponderada de la puntuación (Park et al. usan 1, 1, 1). */
      weights: z
        .object({
          recency: z.number().nonnegative().default(1),
          importance: z.number().nonnegative().default(1),
          relevance: z.number().nonnegative().default(1),
          /** Congruencia con el ánimo: se recuerda mejor lo que encaja con cómo te sientes. */
          moodMatch: z.number().nonnegative().default(0.5),
        })
        .default({ recency: 1, importance: 1, relevance: 1, moodMatch: 0.5 }),
      /** Factor de recencia por hora (0.995 en el paper). */
      recencyDecayPerHour: z.number().min(0).max(1).default(0.995),
      /** Fuerza por debajo de la cual el recuerdo está olvidado (no se recupera). */
      forgetThreshold: z.number().min(0).max(1).default(0.05),
      /** Fuerza por debajo de la cual solo se recuerda la esencia. */
      vagueThreshold: z.number().min(0).max(1).default(0.3),
    })
    .default({
      weights: { recency: 1, importance: 1, relevance: 1, moodMatch: 0.5 },
      recencyDecayPerHour: 0.995,
      forgetThreshold: 0.05,
      vagueThreshold: 0.3,
    }),
  decay: z
    .object({
      /** Estabilidad (horas hasta caer a 1/e) de un recuerdo neutro de importancia 1. */
      baseStabilityHours: z.number().positive().default(12),
      /** Multiplicador por punto de importancia por encima de 1. */
      importanceBoost: z.number().nonnegative().default(0.35),
      /** Multiplicador por |valencia emocional|. */
      emotionBoost: z.number().nonnegative().default(1.5),
      /** Fracción de lo que falta hasta 1 que recupera la fuerza al recordar. */
      recallStrengthGain: z.number().min(0).max(1).default(0.6),
      /** Crecimiento de la estabilidad al recordar (antes del bonus por dificultad). */
      recallStabilityGrowth: z.number().min(1).default(1.8),
    })
    .default({
      baseStabilityHours: 12,
      importanceBoost: 0.35,
      emotionBoost: 1.5,
      recallStrengthGain: 0.6,
      recallStabilityGrowth: 1.8,
    }),
  /** Elementos de la memoria de trabajo (lo único que entra en el prompt). */
  workingMemoryCapacity: z.number().int().positive().default(7),
  consolidation: z
    .object({
      enabled: z.boolean().default(true),
      /** Recuerdos del día que se pasan al LLM como mucho (los más importantes). */
      maxMemories: z.number().int().positive().default(40),
      /** Reflexiones (insights) que genera por noche como máximo. */
      maxInsights: z.number().int().positive().default(3),
      /** Fuerza que se multiplica en los recuerdos citados (reforzar lo importante). */
      reinforceFactor: z.number().min(1).default(1.5),
      /** Factor de fuerza de los recuerdos triviales del día (debilitar lo trivial). */
      weakenFactor: z.number().min(0).max(1).default(0.5),
      /** Importancia máxima para considerar un recuerdo trivial. */
      trivialImportanceMax: z.number().int().min(1).max(10).default(2),
    })
    .default({
      enabled: true,
      maxMemories: 40,
      maxInsights: 3,
      reinforceFactor: 1.5,
      weakenFactor: 0.5,
      trivialImportanceMax: 2,
    }),
  gist: z
    .object({
      /** Generar la esencia con el LLM al cruzar el umbral de vaguedad. */
      enabled: z.boolean().default(true),
      /**
       * Importancia mínima (1-10) para pedir la esencia al LLM. Lo menos importante no se
       * resume: simplemente se desvanece (en el prompt sale la esencia provisional).
       */
      minImportance: z.number().int().min(1).max(10).default(3),
    })
    .prefault({}),
  reconsolidation: z
    .object({
      /** Probabilidad de reescribir un recuerdo al recuperarlo. */
      probability: z.number().min(0).max(1).default(0.1),
      /** Importancia mínima para reconsolidar (lo trivial no se reescribe). */
      minImportance: z.number().int().min(1).max(10).default(3),
    })
    .default({ probability: 0.1, minImportance: 3 }),
  sourceConfusion: z
    .object({
      /** Probabilidad diaria de confundir la fuente de un recuerdo "contado por X". */
      dailyProbability: z.number().min(0).max(1).default(0.05),
      /** De las confusiones, qué parte pasa a "vivido" (el resto, a otra persona). */
      toLivedShare: z.number().min(0).max(1).default(0.6),
      /** Edad mínima del recuerdo para poder confundirse. */
      minAgeHours: z.number().nonnegative().default(24),
    })
    .default({ dailyProbability: 0.05, toLivedShare: 0.6, minAgeHours: 24 }),
  budget: z
    .object({
      /** Presupuesto de tokens de recuerdos activos por agente (≈ texto / 4). */
      tokensPerAgent: z.number().int().positive().default(4000),
      /** Paso 1: se borran triviales de importancia ≤ esto y más viejos que trivialMinAgeHours. */
      trivialImportanceMax: z.number().int().min(1).max(10).default(2),
      trivialMinAgeHours: z.number().nonnegative().default(24),
      /** Paso 2: tamaño mínimo de un grupo de episodios para resumirlo. */
      clusterMinSize: z.number().int().min(2).default(3),
      /** Similitud (coseno) mínima para agrupar episodios. */
      clusterSimilarity: z.number().min(0).max(1).default(0.5),
      /** Recuerdos de tipo plan creados en las últimas N horas están protegidos. */
      protectPlanHours: z.number().nonnegative().default(24),
    })
    .default({
      tokensPerAgent: 4000,
      trivialImportanceMax: 2,
      trivialMinAgeHours: 24,
      clusterMinSize: 3,
      clusterSimilarity: 0.5,
      protectPlanHours: 24,
    }),
  eavesdrop: z
    .object({
      /** Probabilidad de que un agente presente capte una frase ajena. */
      probability: z.number().min(0).max(1).default(0.6),
      /** Fracción de palabras que se captan del fragmento. */
      fragmentRatio: z.number().min(0.1).max(1).default(0.6),
      /** Probabilidad de reconocer quién habló (si no, fuente "alguien"). */
      recognizeSpeaker: z.number().min(0).max(1).default(0.5),
    })
    .default({ probability: 0.6, fragmentRatio: 0.6, recognizeSpeaker: 0.5 }),
  conversation: z
    .object({
      /** Máximo de seguridad de turnos por conversación (lo normal es que la corten ellos). */
      safetyMaxTurns: z.number().int().positive().default(12),
      /** Minutos sin hablar tras los que una conversación se da por acabada. */
      idleMinutes: z.number().positive().default(30),
    })
    .default({ safetyMaxTurns: 12, idleMinutes: 30 }),
  /** Diario de hoy (`doneToday`): memoria a corto plazo del día, imprecisa con poca energía. */
  diary: z
    .object({
      /** Energía (0..1) por debajo de la cual el diario empieza a fallar. */
      lowEnergy: z.number().min(0).max(1).default(0.35),
      /** Probabilidad, con energía 0, de no anotar una actividad (crece linealmente al bajar). */
      maxLossProbability: z.number().min(0).max(1).default(0.4),
      /** Probabilidad, con energía 0, de anotarla en el lugar de la anterior (mezcla). */
      maxMixProbability: z.number().min(0).max(1).default(0.3),
      /** Entradas que caben en el diario de un día (las más recientes). */
      maxEntries: z.number().int().positive().default(16),
      /** Importancia (1-10) del recuerdo "El día N: …" que se guarda al dormirse. */
      dayImportance: z.number().int().min(1).max(10).default(3),
    })
    .prefault({}),
  /** Rutinas repetidas → recuerdos semánticos de hábito ("suelo desayunar en el café…"). */
  habits: z
    .object({
      enabled: z.boolean().default(true),
      /** Días de juego que se miran hacia atrás para detectar una rutina. */
      windowDays: z.number().int().positive().default(7),
      /** Días distintos (dentro de la ventana) con la misma actividad, lugar y franja. */
      minDays: z.number().int().min(2).default(3),
      /** Importancia (1-10) de un recuerdo de hábito nuevo. */
      importance: z.number().int().min(1).max(10).default(4),
      /** Hábitos que entran como mucho en el prompt del plan (los más claros). */
      maxInPlan: z.number().int().nonnegative().default(4),
    })
    .prefault({}),
});
export type MemoryConfig = z.infer<typeof MemoryConfig>;

export const DEFAULT_MEMORY_CONFIG: MemoryConfig = MemoryConfig.parse({});
