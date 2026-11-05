/**
 * Habilidades (lógica pura): el catálogo de lo que se sabe hacer en el pueblo, cómo se practica
 * (rendimientos decrecientes, más deprisa con un maestro delante), cómo se oxida sin práctica
 * (más despacio que un recuerdo; lo aprendido a fondo se pierde menos) y qué cambia en el mundo
 * (probabilidad de que algo salga, calidad del resultado). El servidor (sistema `skills`) decide
 * cuándo se practica; aquí, cuánto. Ver docs/decisiones/skills.md.
 */
import { machineOf } from "@lethetown/shared";
import { z } from "zod";
import { normalizeText } from "../world/knowledge";

export const SkillDef = z.object({
  id: z.string().min(2).max(30),
  /** Cómo se dice («panadería»). */
  label: z.string(),
  /**
   * Raíces de palabras de la actividad que la practican («horne», «pan »…), sin tildes. Lo que es
   * hacerlo, no consumirlo: «tomar un café» no practica la barra, ni «ir al médico» los cuidados.
   */
  keywords: z.array(z.string()).default([]),
  /** Tipos de objeto del mapa con los que se practica (shared/objects/machines.ts). */
  objects: z.array(z.string()).default([]),
  /** Lugares (ids o tipos) donde se practica a propósito (`practice` sin lugar). */
  places: z.array(z.string()).default([]),
  /** Lo que sale al practicarla un rato, si deja algo que enseñar o regalar (una foto, pan). */
  result: z.object({ kind: z.string(), name: z.string() }).nullable().default(null),
});
export type SkillDef = z.infer<typeof SkillDef>;

/** Lo que se sabe hacer en un pueblo de Mallorca en 2002 (configurable). */
export const DEFAULT_SKILLS: SkillDef[] = [
  {
    id: "cooking",
    label: "cocina",
    keywords: [
      "cocin",
      "guis",
      "tumbet",
      "sopa",
      "frit",
      "preparar el desayuno",
      "preparar la comida",
      "preparar la cena",
    ],
    objects: ["cocina"],
    places: ["home"],
    result: null,
  },
  {
    id: "baking",
    label: "panadería",
    keywords: ["horne", "pan ", "masa", "magdalen", "ensaim", "panader", "amasa"],
    objects: ["horno"],
    places: ["panaderia"],
    result: { kind: "pan", name: "una hogaza de pan" },
  },
  {
    id: "hospitality",
    label: "café y barra",
    keywords: [
      "servir",
      "detras de la barra",
      "camarer",
      "atender el cafe",
      "atender la taberna",
      "atender el bar",
    ],
    objects: ["cafetera"],
    places: ["cafe", "bar"],
    result: null,
  },
  {
    id: "gardening",
    label: "huerto",
    keywords: [
      "huert",
      "regar",
      "bancal",
      "plant",
      "sembr",
      "cosech",
      "girasol",
      "cuidar el jardin",
    ],
    objects: ["bancal"],
    places: ["huerto"],
    result: { kind: "verdura", name: "un cesto de verduras" },
  },
  {
    id: "fishing",
    label: "pesca",
    keywords: ["pescar", "pescando", "de pesca", "la caña", "anzuel"],
    objects: [],
    places: ["lago"],
    result: null,
  },
  {
    id: "repair",
    label: "arreglar cosas",
    keywords: ["arregl", "repar", "herramient"],
    objects: [],
    places: [],
    result: null,
  },
  {
    id: "photography",
    label: "fotografía",
    keywords: ["foto", "carrete", "revel", "camara"],
    objects: [],
    places: ["plaza", "lago", "parque"],
    result: { kind: "foto", name: "una foto" },
  },
  {
    id: "drawing",
    label: "dibujo",
    keywords: ["dibuj", "ilustr", "pint", "boceto"],
    objects: [],
    places: ["parque", "home"],
    result: { kind: "dibujo", name: "un dibujo" },
  },
  {
    id: "music",
    label: "música",
    keywords: ["guitarr", "cancion", "tocar", "tocando", "compon", "musica", "cantar"],
    objects: [],
    places: ["plaza"],
    result: null,
  },
  {
    id: "teaching",
    label: "enseñar",
    keywords: ["dar clase", "enseñ", "explic", "alumn"],
    objects: [],
    places: ["escuela"],
    result: null,
  },
  {
    id: "care",
    label: "cuidados y primeros auxilios",
    keywords: [
      "curar",
      "curando",
      "pasar consulta",
      "pacientes",
      "cuidar a",
      "cuidar de",
      "vendar",
      "primeros auxilios",
    ],
    objects: ["botiquin"],
    places: ["consultorio"],
    result: null,
  },
  {
    id: "trade",
    label: "vender y negociar",
    keywords: [
      "vend",
      "cobrar",
      "negoci",
      "atender la tienda",
      "atender el ultramarinos",
      "atender el puesto",
      "reponer",
      "clientes",
    ],
    objects: [],
    places: ["tienda", "mercado"],
    result: null,
  },
  {
    id: "storytelling",
    label: "contar historias",
    keywords: ["contar historias", "contando historias", "contar un cuento", "leyenda", "relat"],
    objects: [],
    places: ["plaza", "taberna"],
    result: null,
  },
  {
    id: "languages",
    label: "idiomas",
    keywords: ["ingles", "frances", "aleman", "idioma", "traduc", "catalan"],
    objects: [],
    places: ["biblioteca"],
    result: null,
  },
];

const unit = (x: number) => z.number().min(0).max(1).default(x);

export const SkillsConfig = z.object({
  enabled: z.boolean().default(true),
  catalog: z.array(SkillDef).min(1).default(DEFAULT_SKILLS),
  /**
   * Práctica: por hora, el nivel sube `practiceRate` × lo que le falta (1 − nivel): rendimientos
   * decrecientes. Con 0,02, de 0 a 0,5 hacen falta unas 35 h; de 0,5 a 0,75, otras 35.
   */
  practiceRate: unit(0.02),
  /** Con un maestro delante que le saque al menos `masterGap`: × `masterFactor`. */
  masterFactor: z.number().min(1).max(5).default(2),
  masterGap: unit(0.2),
  /** Aprender de joven (< 18) y de mayor (> 65). */
  youngFactor: z.number().min(0).max(3).default(1.3),
  oldFactor: z.number().min(0).max(3).default(0.7),
  /** Apertura: × (1 + k·(O − 0,5)·2). */
  opennessFactor: unit(0.3),
  /** Días sin practicar antes de empezar a oxidarse. */
  decayGraceDays: z.number().nonnegative().default(3),
  /**
   * Olvido: cada día sin práctica pierde esta fracción de lo que tiene por encima de su suelo.
   * Mucho más lento que un recuerdo: con 0,01, en un mes sin practicar pierde un cuarto.
   */
  decayPerDay: unit(0.01),
  /** Suelo del olvido: el pico × (base + profundidad·pico). Lo aprendido a fondo se queda. */
  floorBase: unit(0.3),
  floorDepth: unit(0.5),
  /** Probabilidad de que salga algo difícil (arreglar): base + span·nivel (era un 70 % fijo). */
  successBase: unit(0.35),
  successSpan: unit(0.6),
  /** Calidad de un resultado: nivel·(1 − ruido) + ruido·azar. */
  qualityNoise: unit(0.3),
  /** Lo que nota quien lo recibe o lo consume, según la calidad (0..1, buena ≥ 0,7, mala < 0,4). */
  qualityMood: unit(0.04),
  qualityAffinity: unit(0.03),
  /** Resultados (fotos, dibujos, pan…) que puede guardar alguien a la vez. */
  maxResults: z.number().int().nonnegative().default(3),
  /** Minutos de práctica seguidos para que salga un resultado. */
  resultMinutes: z.number().int().positive().default(45),
  /** Duración (min de juego) de una sesión de enseñanza y de una ayuda. */
  sessionMinutes: z.number().int().positive().default(60),
  helpMinutes: z.number().int().positive().default(30),
  /** Afinidad y familiaridad que deja una sesión de enseñanza (a los dos) o una ayuda. */
  sessionAffinity: unit(0.05),
  helpAffinity: unit(0.03),
  /**
   * Histéresis de las etiquetas: se sube al cruzar el umbral y se baja solo por debajo de
   * umbral − esto. En la partida de una semana, 8 habilidades por mundo bajaban de etiqueta a
   * la vez el día 4 (valores de partida justo en 0,20, 0,45 o 0,70 que perdían milésimas).
   */
  labelHysteresis: unit(0.02),
  /**
   * Práctica rutinaria (corrección 3.5): las comidas de cada día (lo que hace por su plan y su
   * actividad lo dice: «preparar el desayuno», «hacer la cena») cuentan con este peso. En la
   * partida de una semana todo el pueblo subía en cocina de 0,30 a 0,55–0,60 con unos 1.300 min
   * de desayunos, comidas y cenas. Lo que se propone practicar (`practice`), una sesión, una
   * ayuda o algo que deja resultado (pan, fotos…) cuenta entero.
   */
  routinePracticeWeight: unit(0.3),
  /** Palabras de las comidas del día (normalizadas al comparar). */
  routineActivities: z
    .array(z.string())
    .default(["desayun", "almuerz", "comida", "comer ", "merend", "merienda", "cena", "cenar"]),
  /** En el prompt: habilidades destacadas desde este nivel, como mucho `maxInPrompt`. */
  promptMinLevel: unit(0.35),
  maxInPrompt: z.number().int().positive().default(3),
});
export type SkillsConfig = z.infer<typeof SkillsConfig>;

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

export interface Learner {
  age: number;
  openness: number;
  /** Nivel de quien enseña o está delante haciéndolo (si hay alguien). */
  masterLevel?: number | null;
}

/**
 * Lo que sube el nivel con `minutes` de práctica: rendimientos decrecientes (cuanto más sabe,
 * menos sube), más con un maestro que le saque ventaja, de joven y con apertura.
 */
export function practiceGain(
  level: number,
  minutes: number,
  who: Learner,
  cfg: SkillsConfig,
): number {
  if (minutes <= 0) return 0;
  const master =
    who.masterLevel !== undefined &&
    who.masterLevel !== null &&
    who.masterLevel - level >= cfg.masterGap
      ? cfg.masterFactor
      : 1;
  const age = who.age < 18 ? cfg.youngFactor : who.age > 65 ? cfg.oldFactor : 1;
  const open = Math.max(0, 1 + cfg.opennessFactor * (who.openness - 0.5) * 2);
  const rate = cfg.practiceRate * master * age * open;
  // Exacto para la curva 1 − e^(−rate·h): no depende de cada cuánto se mida.
  const next = 1 - (1 - level) * Math.exp((-rate * minutes) / 60);
  return clamp01(next) - level;
}

/** Suelo del olvido: lo que se queda de lo aprendido (más cuanto más a fondo se aprendió). */
export function skillFloor(peak: number, cfg: SkillsConfig): number {
  return clamp01(peak * (cfg.floorBase + cfg.floorDepth * peak));
}

/**
 * El nivel tras `days` días sin practicar (pasados los de gracia): pierde cada día una fracción de
 * lo que tiene por encima de su suelo.
 */
export function skillAfterIdle(
  level: number,
  peak: number,
  idleDays: number,
  days: number,
  cfg: SkillsConfig,
): number {
  if (idleDays <= cfg.decayGraceDays || days <= 0) return level;
  const floor = Math.min(level, skillFloor(peak, cfg));
  return floor + (level - floor) * Math.pow(1 - cfg.decayPerDay, days);
}

/** Probabilidad de que salga algo difícil con esa habilidad (arreglar un objeto roto). */
export function successChance(level: number, cfg: SkillsConfig): number {
  return clamp01(cfg.successBase + cfg.successSpan * level);
}

/** Calidad (0..1) de lo que sale: sobre todo el nivel, con algo de azar (el día, la suerte). */
export function resultQuality(level: number, roll: number, cfg: SkillsConfig): number {
  return clamp01(level * (1 - cfg.qualityNoise) + cfg.qualityNoise * roll);
}

export type QualityLabel = "regular" | "bueno" | "muy bueno";

export function qualityLabel(q: number): QualityLabel {
  return q < 0.4 ? "regular" : q < 0.7 ? "bueno" : "muy bueno";
}

/** Lo que nota quien lo recibe: ánimo y afinidad hacia quien lo hizo (malo, un poco en contra). */
export function qualityEffect(q: number, cfg: SkillsConfig): { mood: number; affinity: number } {
  if (q >= 0.7) return { mood: cfg.qualityMood, affinity: cfg.qualityAffinity };
  if (q < 0.4) return { mood: -cfg.qualityMood / 2, affinity: -cfg.qualityAffinity / 3 };
  return { mood: cfg.qualityMood / 4, affinity: cfg.qualityAffinity / 3 };
}

/** Umbrales de las etiquetas (de «principiante» a «se defiende», a «bien», a «con maestría»). */
export const LEVEL_THRESHOLDS = [0.2, 0.45, 0.7] as const;
/** Sin género: describen el nivel. */
export const LEVEL_LABELS = ["principiante", "se defiende", "bien", "con maestría"] as const;

/** El escalón (0..3) de un nivel, sin histéresis. */
export function levelTier(level: number): number {
  return LEVEL_THRESHOLDS.filter((t) => level >= t).length;
}

/** «principiante», «se defiende», «bien», «con maestría» (sin histéresis). */
export function levelLabel(level: number): string {
  return LEVEL_LABELS[levelTier(level)]!;
}

/** La etiqueta de un escalón. */
export function tierLabel(tier: number): string {
  return LEVEL_LABELS[Math.max(0, Math.min(3, tier))]!;
}

/**
 * El escalón con histéresis: sube al cruzar el umbral y baja solo por debajo de umbral −
 * `labelHysteresis`. Sin escalón anterior, el de su nivel.
 */
export function nextTier(
  level: number,
  prev: number | null | undefined,
  cfg: SkillsConfig,
): number {
  const plain = levelTier(level);
  if (prev === null || prev === undefined || plain >= prev) return plain;
  return Math.min(prev, levelTier(level + cfg.labelHysteresis));
}

/** La habilidad del catálogo por su id. */
export function skillDef(cfg: SkillsConfig, id: string): SkillDef | undefined {
  return cfg.catalog.find((s) => s.id === id);
}

/**
 * Qué habilidad practica quien hace esto: el objeto que usa (la cafetera, el horno), si no las
 * palabras de la actividad. Null si no practica nada.
 */
/**
 * ¿Es práctica rutinaria? Una actividad de las comidas del día (`routineActivities`) con una
 * habilidad que no deja resultado. Se decide con lo que hace (su actividad), nunca con el LLM.
 */
export function isRoutinePractice(action: string, skill: string, cfg: SkillsConfig): boolean {
  if (skillDef(cfg, skill)?.result) return false;
  const text = ` ${normalizeText(action)} `;
  // Al principio de una palabra: «cena» no es «escena».
  return cfg.routineActivities.some((k) =>
    text.includes(` ${normalizeText(k)}${k.endsWith(" ") ? " " : ""}`),
  );
}

export function skillForActivity(
  what: { action: string; spotId?: string | null },
  cfg: SkillsConfig,
): string | null {
  const machine = what.spotId ? machineOf(what.spotId)?.type : undefined;
  if (machine) {
    const byObject = cfg.catalog.find((s) => s.objects.includes(machine));
    if (byObject) return byObject.id;
  }
  // Un espacio de más al final: «pan » no es «pantalón»; «cafe» sí está en «café».
  const text = ` ${normalizeText(what.action)} `;
  for (const s of cfg.catalog) {
    if (s.keywords.some((k) => text.includes(normalizeText(k) + (k.endsWith(" ") ? " " : "")))) {
      return s.id;
    }
  }
  return null;
}
