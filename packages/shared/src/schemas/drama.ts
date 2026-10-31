import { z } from "zod";

/** Tipos de "drama": lo que merece la pena ir a ver. */
export const DramaKind = z.enum([
  /** Alguien oyó a escondidas una conversación. */
  "eavesdrop",
  /** Se propaga algo oído ("¿Sabes? Oí a…"). */
  "rumor",
  /** La afinidad entre dos agentes cae mucho tras hablar. */
  "argument",
  /** La afinidad sube mucho. */
  "friendship",
  /** Un recuerdo importante se reescribe al recordarlo. */
  "reconsolidation",
  /** Se olvida un recuerdo importante. */
  "forgetting",
  /** Alguien "recuerda" detalles que nunca vivió. */
  "false_memory",
  /** Se acuerda a tiempo de algo que tenía que hacer. */
  "intention_kept",
  /** Se le olvida algo que tenía que hacer. */
  "intention_forgotten",
  /** Una relación cambia de tipo (de amistad a rivalidad…). */
  "relationship",
  /** Alguien no fue a una cita (plantón). */
  "meeting_failed",
  /** Un préstamo que no se devuelve. */
  "loan_unreturned",
  /** Alguien entra en una casa ajena. */
  "intruder",
  /** Alguien descubre un lugar del pueblo. */
  "discovery",
  /** Alguien consigue una meta (vital o un proyecto). */
  "goal_achieved",
  /** Alguien abandona una meta. */
  "goal_abandoned",
  /** Alguien cambia de meta vital. */
  "life_change",
  /** Dos metas compiten por lo mismo (un lugar, una persona, los clientes). */
  "goal_conflict",
  /** Alguien se marcha del pueblo. */
  "departure",
  /** Alguien que se fue vuelve de visita. */
  "visit",
]);
export type DramaKind = z.infer<typeof DramaKind>;

export const Drama = z.object({
  id: z.string(),
  /** Minutos de juego. */
  time: z.number(),
  kind: DramaKind,
  /** Interés de 0 a 1 (el feed ordena y filtra por esto). */
  score: z.number().min(0).max(1),
  title: z.string(),
  agents: z.array(z.string()),
  /** Dónde ocurrió (para "Ir a verlo"). */
  placeId: z.string().nullable(),
  /** Evento relacionado (vista Rashomon / enlace permanente). */
  eventId: z.string().nullable(),
});
export type Drama = z.infer<typeof Drama>;

/** Por debajo de esto no se publica. */
export const DRAMA_MIN_SCORE = 0.5;

/** Cambio de afinidad a partir del cual una conversación es una discusión o una amistad. */
export const AFFINITY_DRAMA_DELTA = 0.2;

/**
 * Interés de un posible drama. Funciones puras: la detección (qué eventos lo disparan) vive en
 * el servidor; aquí solo la puntuación, para que sea fácil de ajustar y de probar.
 */
export const dramaScore = {
  eavesdrop: (listeners: number) => Math.min(1, 0.5 + 0.1 * listeners),
  rumor: (listeners: number) => Math.min(1, 0.7 + 0.1 * listeners),
  affinity: (delta: number) => Math.min(1, 0.45 + Math.abs(delta) * 1.5),
  reconsolidation: (importance: number) => Math.min(1, 0.3 + importance / 20),
  forgetting: (importance: number) => Math.min(1, importance / 10),
  falseMemory: (importance: number) => Math.min(1, 0.45 + importance / 20),
  intention: (importance: number, forgotten: boolean) =>
    Math.min(1, (forgotten ? 0.5 : 0.35) + importance / 20),
  relationship: (affinity: number) => Math.min(1, 0.55 + Math.abs(affinity) * 0.4),
  /** Plantón: más interés cuantos más se quedaron esperando. */
  meetingFailed: (waiting: number) => Math.min(1, 0.6 + 0.1 * waiting),
  loanUnreturned: () => 0.6,
  intruder: () => 0.75,
  discovery: () => 0.5,
  /** Una meta vital pesa más que un proyecto. */
  goalAchieved: (life: boolean) => (life ? 0.9 : 0.6),
  goalAbandoned: (life: boolean) => (life ? 0.8 : 0.55),
  lifeChange: () => 0.85,
  goalConflict: () => 0.7,
  departure: () => 0.95,
  visit: () => 0.7,
};

/** ¿Parece que alguien cuenta algo que oyó? (rumor que se propaga). */
export function looksLikeRumor(text: string): boolean {
  // Sin \b: en JS no trata "í" como letra. Límites de palabra con clases Unicode.
  return /(^|[^\p{L}])(oí|oi|dicen que|me contaron|¿sabes|he oído|he oido)(?=$|[^\p{L}])/iu.test(
    text,
  );
}
