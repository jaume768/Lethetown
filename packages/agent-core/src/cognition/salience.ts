/**
 * Saliencia de un encuentro por el camino (fase 3.6): cuánto le importa a alguien cruzarse con
 * otra persona, calculado en código (nunca por el LLM) con lo que el motor ya sabe: la ficha
 * social, la familia, lo pendiente con esa persona (intención, cita, préstamo o deuda), metas
 * que chocan, el ánimo que se le ve y cuánto hace que no se ven. Solo por encima del umbral
 * se para a pensar (una llamada a `decide`); por debajo, como mucho un recuerdo de poca
 * importancia. Pura y testeable. Ver docs/decisiones/cognicion.md.
 */
import { z } from "zod";

export const EncounterConfig = z.object({
  /** A partir de esta saliencia (0–1) el encuentro le hace pensar (despierta su turno). */
  threshold: z.number().min(0).max(1).default(0.5),
  /** Peso de lo que siente por esa persona, en valor absoluto (querer y detestar cuentan). */
  affinityWeight: z.number().nonnegative().default(0.3),
  /** Peso de la familiaridad (0–1). */
  familiarityWeight: z.number().nonnegative().default(0.15),
  /** Familia (vínculo de las semillas). */
  family: z.number().nonnegative().default(0.25),
  /** Rivalidad (tipo de relación). */
  rivalry: z.number().nonnegative().default(0.25),
  /** Algo que tenía pensado hacer con esa persona (intención pendiente). */
  intention: z.number().nonnegative().default(0.45),
  /** Una cita pendiente con esa persona. */
  meeting: z.number().nonnegative().default(0.35),
  /** Un préstamo o una deuda entre los dos. */
  loan: z.number().nonnegative().default(0.35),
  /** Metas que chocan (quieren lo mismo). */
  goalConflict: z.number().nonnegative().default(0.3),
  /** Ánimo visible muy marcado de la otra persona (|valencia| ≥ `visibleMood`). */
  mood: z.number().nonnegative().default(0.2),
  /** Valencia (en valor absoluto) a partir de la cual el ánimo se nota desde fuera. */
  visibleMood: z.number().min(0).max(1).default(0.6),
  /** Reencuentro: hace al menos `reunionDays` días de juego que no se ven (y se conocen). */
  reunion: z.number().nonnegative().default(0.3),
  reunionDays: z.number().positive().default(2),
  /** Familiaridad mínima para que un reencuentro cuente (a un desconocido no se le echa de menos). */
  reunionFamiliarity: z.number().min(0).max(1).default(0.3),
  /** Van juntos (invitación, acompañar): de camino apetece hablar (`walkingTalk`). */
  together: z.number().nonnegative().default(0.5),
  /** Por debajo de esto, el encuentro es trivial: si ya se vieron hoy, ni se recuerda. */
  trivialBelow: z.number().min(0).max(1).default(0.15),
  /** Importancia (1–10) del recuerdo de un encuentro que no llega al umbral. */
  lowImportance: z.number().int().min(1).max(10).default(2),
});
export type EncounterConfig = z.infer<typeof EncounterConfig>;

/** Lo que el motor sabe de esa persona desde el punto de vista de quien la ve. */
export interface EncounterFactors {
  /** Afinidad de la ficha social (−1..1), o null si no piensa nada de ella. */
  affinity: number | null;
  /** Familiaridad (0..1), o null si no hay ficha. */
  familiarity: number | null;
  family: boolean;
  rivalry: boolean;
  /** Tiene una intención pendiente con esa persona. */
  intention: boolean;
  /** Tiene una cita pendiente con esa persona. */
  meeting: boolean;
  /** Le ha prestado algo o le debe algo. */
  loan: boolean;
  /** Sus metas chocan. */
  goalConflict: boolean;
  /** Valencia del ánimo de la otra persona (la visible), o null si no se le ve. */
  otherMood: number | null;
  /** Días de juego desde la última vez que se vieron, o null si no consta. */
  daysApart: number | null;
  /** Van juntos de camino (comparten ruta). */
  together?: boolean;
}

/** Por qué le importa el encuentro (para el contexto breve del prompt y la auditoría). */
export type SalienceReason =
  | "affinity"
  | "dislike"
  | "family"
  | "rivalry"
  | "intention"
  | "meeting"
  | "loan"
  | "goal_conflict"
  | "mood_low"
  | "mood_high"
  | "reunion"
  | "together";

export interface Salience {
  /** 0..1 (la suma de las razones, con tope en 1). */
  score: number;
  /** Razones, de más a menos peso. */
  reasons: SalienceReason[];
  /** ¿Le hace pensar? (score ≥ umbral) */
  salient: boolean;
  /** ¿Es trivial? (por debajo de `trivialBelow`) */
  trivial: boolean;
}

export function encounterSalience(f: EncounterFactors, cfg: EncounterConfig): Salience {
  const parts: [SalienceReason, number][] = [];
  if (f.affinity !== null && Math.abs(f.affinity) > 0) {
    parts.push([
      f.affinity >= 0 ? "affinity" : "dislike",
      Math.abs(f.affinity) * cfg.affinityWeight,
    ]);
  }
  // La familiaridad suma a lo que siente (no es una razón por sí sola).
  const familiar = (f.familiarity ?? 0) * cfg.familiarityWeight;
  if (f.family) parts.push(["family", cfg.family]);
  if (f.rivalry) parts.push(["rivalry", cfg.rivalry]);
  if (f.intention) parts.push(["intention", cfg.intention]);
  if (f.meeting) parts.push(["meeting", cfg.meeting]);
  if (f.loan) parts.push(["loan", cfg.loan]);
  if (f.goalConflict) parts.push(["goal_conflict", cfg.goalConflict]);
  if (f.otherMood !== null && Math.abs(f.otherMood) >= cfg.visibleMood) {
    parts.push([f.otherMood < 0 ? "mood_low" : "mood_high", cfg.mood]);
  }
  if (
    f.daysApart !== null &&
    f.daysApart >= cfg.reunionDays &&
    (f.familiarity ?? 0) >= cfg.reunionFamiliarity
  ) {
    parts.push(["reunion", cfg.reunion]);
  }
  if (f.together) parts.push(["together", cfg.together]);
  const raw = familiar + parts.reduce((s, [, w]) => s + w, 0);
  const score = Math.min(1, Math.round(raw * 1000) / 1000);
  const reasons = parts
    .filter(([, w]) => w > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([r]) => r);
  return {
    score,
    reasons,
    salient: score >= cfg.threshold,
    trivial: score < cfg.trivialBelow,
  };
}

/** Las razones en palabras, para el contexto breve del prompt («le debes algo»). */
export const SALIENCE_TEXT: Record<SalienceReason, string> = {
  affinity: "le tienes aprecio",
  dislike: "no te cae nada bien",
  family: "es de tu familia",
  rivalry: "es tu rival",
  intention: "tenías algo pendiente con esta persona",
  meeting: "tenéis una cita pendiente",
  loan: "hay un préstamo o una deuda entre los dos",
  goal_conflict: "queréis lo mismo",
  mood_low: "se le ve muy mal",
  mood_high: "se le ve feliz",
  reunion: "hace días que no os veis",
  together: "vais juntos",
};
