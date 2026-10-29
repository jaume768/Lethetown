/**
 * Lo social (fase 6 de la psicología): tipo de relación, familiaridad, credibilidad de los
 * rumores, mera exposición, perdón y rencor. Lógica pura y configurable; las fichas las guarda
 * el `SocialProfileStore` y cada cambio queda en su historial.
 */
import type { RelationshipType, SocialProfile } from "@lethetown/shared";
import { z } from "zod";

export const SocialConfig = z.object({
  /** Afinidad y familiaridad a partir de las que una relación es amistad. */
  friendshipAffinity: z.number().min(0).max(1).default(0.35),
  friendshipFamiliarity: z.number().min(0).max(1).default(0.35),
  /** Afinidad por debajo de la cual es rivalidad (pese a ser vecinos o compañeros). */
  rivalryAffinity: z.number().min(-1).max(0).default(-0.35),
  /**
   * Romance que surge (solo entre adultos y si la opinión lo deja claro): afinidad y familiaridad
   * mínimas. Con un menor, nunca.
   */
  romanceAffinity: z.number().min(0).max(1).default(0.75),
  romanceFamiliarity: z.number().min(0).max(1).default(0.6),
  /** Familiaridad que suma cada conversación. */
  conversationFamiliarity: z.number().min(0).max(1).default(0.04),
  /** Mera exposición: minutos juntos (en el mismo sitio) en un día para que cuente. */
  exposureMinMinutes: z.number().nonnegative().default(30),
  /** …y lo que suma por hora juntos (familiaridad y algo de afinidad). */
  exposureFamiliarityPerHour: z.number().min(0).default(0.02),
  exposureAffinityPerHour: z.number().min(0).default(0.004),
  /** La mera exposición no lleva la afinidad más allá de esto. */
  exposureAffinityCap: z.number().min(0).max(1).default(0.3),
  /** Perdón: vida media (días) de la vuelta a 0 de la afinidad negativa, ÷ (0.5 + amabilidad). */
  forgiveHalfLifeDays: z.number().positive().default(6),
  /** Una bajada de afinidad de al menos esto es una ofensa importante… */
  grudgeFromDrop: z.number().min(0).max(1).default(0.2),
  /** …y deja un rencor mínimo de esta fracción de la bajada (acumulable, hasta 1). */
  grudgeShare: z.number().min(0).max(1).default(0.5),
  /** Credibilidad de quien es chismoso (× la confianza que se le tiene). */
  gossipCredibility: z.number().min(0).max(1).default(0.7),
  /** Por debajo de esta credibilidad, lo que cuenta se guarda con duda. */
  doubtBelow: z.number().min(0).max(1).default(0.35),
});
export type SocialConfig = z.infer<typeof SocialConfig>;

/**
 * Tipo de relación a partir del vínculo de base y de la afinidad y familiaridad. La pareja de
 * las semillas o un romance que surge entre adultos (`romanticHint`) es "romantic"; con un menor
 * implicado, jamás.
 */
export function classifyRelationship(
  p: Pick<SocialProfile, "affinity" | "familiarity" | "bond">,
  ctx: { minorInvolved: boolean; romanticHint?: boolean },
  cfg: SocialConfig,
): RelationshipType {
  if (p.bond === "family") return "family";
  if (p.bond === "romantic" && !ctx.minorInvolved) return "romantic";
  if (p.affinity <= cfg.rivalryAffinity) return "rivalry";
  if (
    ctx.romanticHint &&
    !ctx.minorInvolved &&
    p.affinity >= cfg.romanceAffinity &&
    p.familiarity >= cfg.romanceFamiliarity
  ) {
    return "romantic";
  }
  if (p.affinity >= cfg.friendshipAffinity && p.familiarity >= cfg.friendshipFamiliarity) {
    return "friendship";
  }
  if (p.bond === "work") return "work";
  return "neighbor";
}

/** Rencor tras un cambio de afinidad: una ofensa importante deja un poso. */
export function grudgeAfter(grudge: number, affinityDelta: number, cfg: SocialConfig): number {
  if (affinityDelta > -cfg.grudgeFromDrop) return grudge;
  return Math.min(1, grudge + Math.abs(affinityDelta) * cfg.grudgeShare);
}

/**
 * Perdón: la afinidad negativa vuelve hacia −rencor (no hasta 0 si hubo ofensas importantes),
 * más deprisa cuanto más amable es quien perdona.
 */
export function forgive(
  p: Pick<SocialProfile, "affinity" | "grudge">,
  days: number,
  agreeableness: number,
  cfg: SocialConfig,
): number {
  const floor = -p.grudge;
  if (p.affinity >= floor || days <= 0) return p.affinity;
  const halfLife = cfg.forgiveHalfLifeDays / (0.5 + agreeableness);
  return floor + (p.affinity - floor) * Math.pow(0.5, days / halfLife);
}

/** Lo que aporta la mera exposición tras `minutes` juntos en un día. */
export function exposureDelta(
  minutes: number,
  affinity: number,
  cfg: SocialConfig,
): { familiarityDelta: number; affinityDelta: number } {
  if (minutes < cfg.exposureMinMinutes) return { familiarityDelta: 0, affinityDelta: 0 };
  const h = minutes / 60;
  const room = Math.max(0, cfg.exposureAffinityCap - affinity);
  return {
    familiarityDelta: cfg.exposureFamiliarityPerHour * h,
    affinityDelta: Math.min(room, cfg.exposureAffinityPerHour * h),
  };
}

/** Credibilidad (0..1) de lo que cuenta alguien: la confianza que se le tiene, menos si es chismoso. */
export function credibility(trust: number, gossip: boolean, cfg: SocialConfig): number {
  return Math.min(1, Math.max(0, trust * (gossip ? cfg.gossipCredibility : 1)));
}

const RELATION_LABEL: Record<RelationshipType, string> = {
  family: "tu familia",
  friendship: "amistad",
  neighbor: "vecino",
  work: "trabajo o estudios",
  rivalry: "rivalidad",
  romantic: "tu pareja",
};

/** "tu familia", "rivalidad"… para los prompts. */
export function relationshipLabel(t: RelationshipType): string {
  return RELATION_LABEL[t];
}
