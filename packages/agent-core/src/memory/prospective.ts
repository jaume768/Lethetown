/**
 * Memoria prospectiva (fase 5): acordarse de hacer algo en el momento oportuno. Una intención
 * ("devolverle el libro a Carmen") es un recuerdo de tipo `intention` con pistas (una persona,
 * un lugar, una hora). Cuando aparece la pista, el agente se acuerda o no según su
 * responsabilidad, su perfil de memoria y lo nítido que tenga el recuerdo; si se le pasan
 * varias ocasiones, se le olvida… y quizá más tarde cae en la cuenta ("¡vaya, se me olvidó!").
 * Lógica pura: el agente decide cuándo llamarla.
 */
import { z } from "zod";

export const ProspectiveConfig = z.object({
  enabled: z.boolean().default(true),
  /** Probabilidad de acordarse al aparecer la pista (perfil neutro, recuerdo nítido). */
  baseRecall: z.number().min(0).max(1).default(0.7),
  /**
   * Lo mismo para una cita acordada con alguien (se tiene más presente que una intención
   * suelta). Se aplica cuando llega la hora de salir.
   */
  appointmentRecall: z.number().min(0).max(1).default(0.9),
  /** Ocasiones (pistas) que se le pueden pasar antes de darla por olvidada. */
  maxMisses: z.number().int().min(1).default(2),
  /** Probabilidad por hora de caer en la cuenta de algo que se le olvidó. */
  lateRecallPerHour: z.number().min(0).max(1).default(0.04),
  /** Una intención con hora se puede cumplir desde esa hora hasta esto después (minutos). */
  timeWindowMinutes: z.number().int().positive().default(60),
  /** Días de juego tras los que una intención abierta caduca. */
  expireDays: z.number().positive().default(7),
  /** Importancia (1-10) del recuerdo de una intención. */
  importance: z.number().int().min(1).max(10).default(6),
  /**
   * Intenciones abiertas por agente como mucho: al pasarse, se descarta la menos importante
   * (auditado). En la partida 2 se proponían 199 al día y solo se cumplía el 46 %.
   */
  maxOpen: z.number().int().positive().default(8),
  /** Importancia (1-10) hasta la que una intención es poco importante… */
  lowImportance: z.number().int().min(1).max(10).default(4),
  /** …y caduca sola tras estos días de juego sin que aparezca su pista. */
  lowExpireDays: z.number().positive().default(2),
  /**
   * Parecido (palabras con contenido en común, 0..1) desde el que dos intenciones con la misma
   * persona o el mismo lugar son la misma: se queda una, reforzada.
   */
  mergeSimilarity: z.number().min(0).max(1).default(0.5),
});
export type ProspectiveConfig = z.infer<typeof ProspectiveConfig>;

export const IntentionStatus = z.enum(["pending", "done", "forgotten", "expired"]);
export type IntentionStatus = z.infer<typeof IntentionStatus>;

/** Lo que el agente lleva en la cabeza de una intención (en `AgentMind`). */
export const IntentionState = z.object({
  memoryId: z.string(),
  text: z.string(),
  personId: z.string().nullable(),
  placeId: z.string().nullable(),
  /** Minuto del día a partir del que toca (null = cuando surja). */
  atMinute: z.number().int().min(0).max(1439).nullable(),
  status: IntentionStatus,
  misses: z.number().int().nonnegative(),
  createdAt: z.number(),
  /** ¿Estaba la pista presente en la última comprobación? (solo cuenta cuando aparece). */
  cueActive: z.boolean(),
  /** Importancia (1-10): la menos importante es la que se descarta al pasarse del tope. */
  importance: z.number().int().min(1).max(10).default(6),
  /** Última vez que apareció su pista (para que caduquen las poco importantes). */
  lastCueAt: z.number().nullable().default(null),
});
export type IntentionState = z.infer<typeof IntentionState>;

/** Intención nueva detectada por el LLM (o sembrada). */
export const IntentionInput = z.object({
  text: z.string().min(3).max(200),
  personId: z.string().nullish(),
  placeId: z.string().nullish(),
  /** "HH:MM" opcional. */
  at: z.string().nullish(),
  /** Importancia (1-10); si no viene, por reglas (`intentionImportance`). */
  importance: z.coerce.number().int().min(1).max(10).nullish(),
});
export type IntentionInput = z.infer<typeof IntentionInput>;

/**
 * Importancia de una intención por reglas: con hora, 7; con alguien o un sitio, 6; sin nada
 * que la recuerde («ya lo haré»), 4. Una cita o un préstamo la llevan ya puesta.
 */
export function intentionImportance(
  i: Pick<IntentionState, "personId" | "placeId" | "atMinute">,
): number {
  if (i.atMinute !== null) return 7;
  if (i.personId || i.placeId) return 6;
  return 4;
}

const STOP = new Set(
  "a al algo con de del el en es la las le lo los me mi para por que se su sus te tu un una y ya hablar decir preguntar contar ir volver quedar hacer ver".split(
    " ",
  ),
);

/** Palabras con contenido de una intención (minúsculas, sin tildes). */
function intentionWords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .split(/[^a-z0-9ñ]+/)
      .filter((w) => w.length >= 3 && !STOP.has(w)),
  );
}

/**
 * Parecido entre dos textos (0..1): palabras en común sobre las del más largo (así el nombre de
 * la persona, que comparten casi todas las suyas, no basta: «preguntar a Carmen por su salud» no
 * es «devolverle a Carmen su libro»).
 */
export function intentionSimilarity(a: string, b: string): number {
  const x = intentionWords(a);
  const y = intentionWords(b);
  if (!x.size || !y.size) return 0;
  let shared = 0;
  for (const w of x) if (y.has(w)) shared++;
  return shared / Math.max(x.size, y.size);
}

/** ¿Son la misma intención? La misma persona o el mismo lugar y un texto parecido. */
export function sameIntention(
  a: Pick<IntentionState, "text" | "personId" | "placeId">,
  b: Pick<IntentionState, "text" | "personId" | "placeId">,
  minSimilarity: number,
): boolean {
  const samePerson = !!a.personId && a.personId === b.personId;
  const samePlace = !!a.placeId && a.placeId === b.placeId;
  if (!samePerson && !samePlace) return false;
  return intentionSimilarity(a.text, b.text) >= minSimilarity;
}

/** ¿Está presente la pista? La persona (si está aquí), el lugar o la hora. */
export function cuePresent(
  i: Pick<IntentionState, "personId" | "placeId" | "atMinute">,
  ctx: { placeId: string; present: string[]; minuteOfDay: number },
  windowMinutes: number,
): boolean {
  if (i.personId && ctx.present.includes(i.personId)) return true;
  if (i.placeId && i.placeId === ctx.placeId) return true;
  if (i.atMinute !== null) {
    const d = ctx.minuteOfDay - i.atMinute;
    if (d >= 0 && d < windowMinutes) return true;
  }
  return false;
}

/**
 * Probabilidad de acordarse al aparecer la pista: base × (0.5 + 0.5·fuerza del recuerdo) ÷
 * olvido de intenciones del perfil (la responsabilidad ya va dentro).
 */
export function recallChance(
  intentionForgetting: number,
  strength: number,
  cfg: ProspectiveConfig,
  base = cfg.baseRecall,
): number {
  const clarity = 0.5 + 0.5 * Math.min(1, Math.max(0, strength));
  return Math.min(1, Math.max(0, (base * clarity) / Math.max(0.1, intentionForgetting)));
}
