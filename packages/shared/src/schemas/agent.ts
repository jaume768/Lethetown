import { z } from "zod";
import { TilePoint } from "./world";

/** Aspecto del personaje: hoja de sprites del manifest y colores para recolorear el placeholder. */
export const Appearance = z.object({
  /** Clave de personaje en el manifest de assets. */
  sheet: z.string().default("default"),
  skin: z.string().default("#f1c27d"),
  hair: z.string().default("#4a3020"),
  shirt: z.string().default("#3d6fb4"),
  pants: z.string().default("#2b2b3b"),
});
export type Appearance = z.infer<typeof Appearance>;

/**
 * Receta de retrato para `pnpm portraits:compose` (piezas del Portrait Generator de LimeZu):
 * se apilan piel, ojos, peinado y accesorios en ese orden.
 */
export const PortraitRecipe = z.object({
  /** "Skin N" (1–9). */
  skin: z.number().int().min(1),
  /** "Eyes NN" (1–7). */
  eyes: z.number().int().min(1),
  /** Peinado y color: "Hairstyle NN C" (color 1–7; el 5 es canoso). */
  hair: z.object({ style: z.number().int().min(1), color: z.number().int().min(1) }),
  /** Nombres de archivo de Accessories sin extensión, p. ej. "Accessory 15 Glasses 1". */
  accessories: z.array(z.string()).default([]),
});
export type PortraitRecipe = z.infer<typeof PortraitRecipe>;

const unit = (fallback: number) => z.number().min(0).max(1).default(fallback);

/** Personalidad (Big Five), cada rasgo de 0 a 1 (0.5 = en la media). */
export const BigFive = z.object({
  /** Apertura a la experiencia: curiosidad, imaginación. */
  openness: unit(0.5),
  /** Responsabilidad: orden, puntualidad, cumplir lo prometido. */
  conscientiousness: unit(0.5),
  /** Extraversión: busca compañía y estímulos. */
  extraversion: unit(0.5),
  /** Amabilidad: confía, perdona, coopera. */
  agreeableness: unit(0.5),
  /** Neuroticismo: inestabilidad emocional, preocupación. */
  neuroticism: unit(0.5),
});
export type BigFive = z.infer<typeof BigFive>;

const factor = z.number().positive().max(5).default(1);

/**
 * Memoria propia del agente: multiplicadores (1 = normal) que se suman a los efectos de la edad
 * y la personalidad (ver agent-core/memory/psychology.ts).
 */
export const MemoryProfileSeed = z.object({
  /** Estabilidad de lo vivido (observaciones, planes). >1 = recuerda más tiempo. */
  episodicStability: factor,
  /** Estabilidad de lo que sabe (semántico, reflexiones, hábitos). */
  semanticStability: factor,
  /** Probabilidad de confundir quién le contó algo. */
  sourceConfusion: factor,
  /** Olvido de fechas y horas (aniversarios, citas). >1 = las olvida antes. */
  dateForgetting: factor,
  /** Olvido de intenciones (lo que tenía que hacer). >1 = se le olvida más. */
  intentionForgetting: factor,
  /** Sugestionabilidad (rellenar huecos, creerse lo que le cuentan). */
  suggestibility: factor,
});
export type MemoryProfileSeed = z.infer<typeof MemoryProfileSeed>;

export const AgentSeed = z.object({
  id: z.string(),
  name: z.string(),
  age: z.number().int().positive(),
  /** Rasgos estables: forman el prefijo fijo del prompt (cacheable). */
  traits: z.array(z.string()),
  description: z.string(),
  homeId: z.string(),
  /** Lugar donde trabaja o estudia (opcional): forma parte de la identidad fija del prompt. */
  workId: z.string().optional(),
  /**
   * Lugares que conoce al empezar. Sin indicar: los de toda la vida (todo lo público, su casa y
   * su trabajo). Quien acaba de llegar conoce menos y tiene que explorar.
   */
  knownPlaces: z.array(z.string()).optional(),
  appearance: Appearance.default({
    sheet: "default",
    skin: "#f1c27d",
    hair: "#4a3020",
    shirt: "#3d6fb4",
    pants: "#2b2b3b",
  }),
  portrait: PortraitRecipe.optional(),
  /** Recuerdos iniciales (semánticos) con los que arranca el agente. */
  initialMemories: z.array(z.string()).default([]),
  /**
   * Menor de edad (sin relaciones románticas ni sexuales, ni nadie que flirtee con él o ella).
   * Si no se indica, se deduce de la edad (`seedIsMinor`).
   */
  isMinor: z.boolean().optional(),
  /** Personalidad (Big Five); sin ella, todo en la media. */
  personality: BigFive.prefault({}),
  /** Particularidades de su memoria (opcional). */
  memoryProfile: MemoryProfileSeed.optional(),
  /** Cómo habla: así cada agente suena distinto (va en el prompt fijo de identidad). */
  speechStyle: z
    .object({
      /** "coloquial y bromista", "formal y medido"… */
      register: z.string(),
      sentenceLength: z.enum(["corta", "media", "larga"]).default("media"),
      /** Muletillas y expresiones suyas. */
      catchphrases: z.array(z.string()).default([]),
      /** Temas que le salen solos (sus intereses). */
      topics: z.array(z.string()).default([]),
    })
    .optional(),
  /**
   * Relaciones de partida (lo que piensa de otros al empezar; no tienen por qué ser
   * recíprocas). `bond` fija un vínculo que no cambia con la afinidad (familia, pareja, trabajo).
   */
  relationships: z
    .array(
      z.object({
        with: z.string(),
        bond: z.enum(["family", "romantic", "work"]).optional(),
        affinity: z.number().min(-1).max(1).default(0),
        trust: z.number().min(0).max(1).default(0.5),
        familiarity: z.number().min(0).max(1).default(0.5),
        summary: z.string().default(""),
      }),
    )
    .default([]),
  /** Cosas que tiene pensado hacer cuando surja (memoria prospectiva). */
  initialIntentions: z
    .array(
      z.object({
        text: z.string(),
        personId: z.string().optional(),
        placeId: z.string().optional(),
        /** "HH:MM" */
        at: z.string().optional(),
      }),
    )
    .default([]),
});
export type AgentSeed = z.infer<typeof AgentSeed>;

/** Edad a partir de la cual un agente es adulto. */
export const ADULT_AGE = 18;

/** ¿Es menor de edad? El campo explícito manda; si no, la edad. */
export function seedIsMinor(seed: Pick<AgentSeed, "age" | "isMinor">): boolean {
  return seed.isMinor ?? seed.age < ADULT_AGE;
}

export const Needs = z.object({
  energy: z.number().min(0).max(1),
  hunger: z.number().min(0).max(1),
  social: z.number().min(0).max(1),
});
export type Needs = z.infer<typeof Needs>;

/** Ánimo (modelo circumplejo): valencia y activación, con su etiqueta ("contento", "irritable"…). */
export const Mood = z.object({
  /** -1 (muy negativo) .. 1 (muy positivo) */
  valence: z.number().min(-1).max(1),
  /** 0 (calma, sueño) .. 1 (tensión, euforia) */
  arousal: z.number().min(0).max(1).default(0.4),
  label: z.string(),
});
export type Mood = z.infer<typeof Mood>;

/** Tipo de actividad: decide animación, pose y emote en el cliente. */
export const ActivityKind = z.enum([
  "walk",
  "idle",
  "sit",
  "sleep",
  "talk",
  "read",
  "work",
  "eat",
  "cook",
]);
export type ActivityKind = z.infer<typeof ActivityKind>;

export const Facing = z.enum(["down", "left", "right", "up"]);
export type Facing = z.infer<typeof Facing>;

export const PlanItem = z.object({
  /** Minuto del día (0..1439) en que empieza. */
  startMinute: z.number().int().min(0).max(1439),
  durationMin: z.number().int().positive(),
  activity: z.string(),
  activityKind: ActivityKind.default("idle"),
  placeId: z.string(),
  /** Objeto concreto del lugar (cama, barra...), si aplica. */
  spotId: z.string().nullable().default(null),
  /** Cambio de planes sobre la marcha (no estaba en el plan de la mañana). */
  replanned: z.boolean().optional(),
});
export type PlanItem = z.infer<typeof PlanItem>;

/** Desplazamiento en curso: el cliente interpola la posición por el reloj de juego. */
export const Movement = z.object({
  waypoints: z.array(TilePoint).min(1),
  startTime: z.number(),
  endTime: z.number(),
});
export type Movement = z.infer<typeof Movement>;

export const AgentState = z.object({
  id: z.string(),
  name: z.string(),
  appearance: Appearance,
  locationId: z.string(),
  /** Destino si se está desplazando. */
  targetId: z.string().nullable(),
  /** Spot en el que está (o al que va). */
  spotId: z.string().nullable(),
  tile: TilePoint,
  facing: Facing,
  movement: Movement.nullable(),
  action: z.string(),
  activityKind: ActivityKind,
  mood: Mood,
  needs: Needs,
  plan: z.array(PlanItem),
  /** Lo último que ha dicho, para el bocadillo. */
  lastUtterance: z.string().nullable(),
  /** Diario de hoy: lo que ha ido haciendo (minuto del día, actividad, lugar). */
  doneToday: z
    .array(z.object({ minute: z.number().int(), activity: z.string(), placeId: z.string() }))
    .optional(),
  /** Su último razonamiento al decidir (y si era sobre la voz interior), para el inspector. */
  reasoning: z
    .object({ text: z.string(), at: z.number(), innerVoice: z.boolean() })
    .nullable()
    .optional(),
});
export type AgentState = z.infer<typeof AgentState>;
