import type { AgentState } from "../schemas/agent";

export const EMOTES = [
  "dots",
  "zzz",
  "heart",
  "anger",
  "cup",
  "flame",
  "book",
  "gear",
  "idea",
  "question",
  "cloud",
  "exclaim",
  "sparkle",
  "storm",
] as const;
export type Emote = (typeof EMOTES)[number];

/**
 * Emote persistente encima de la cabeza según lo que hace y cómo se siente.
 * Prioridad: pensando (llamada al LLM en curso) > durmiendo > ánimo extremo > actividad.
 */
export function emoteFor(
  state: Pick<AgentState, "activityKind" | "mood">,
  opts: { thinking: boolean },
): Emote | null {
  if (opts.thinking) return "dots";
  if (state.activityKind === "sleep") return "zzz";
  if (state.mood.valence > 0.55) return "heart";
  if (state.mood.valence < -0.45) return "anger";
  switch (state.activityKind) {
    case "eat":
      return "cup";
    case "cook":
      return "flame";
    case "read":
      return "book";
    case "work":
      return "gear";
    default:
      return null;
  }
}

/** Emote breve asociado a un efecto de memoria (se superpone unos segundos). */
export function emoteForMemoryEffect(kind: string): Emote | null {
  switch (kind) {
    case "vague":
    case "gist":
      return "cloud";
    case "consolidate":
      return "idea";
    case "reconsolidate":
      return "question";
    case "recall":
      return "sparkle";
    case "intrusive":
      return "storm";
    case "false_memory":
      return "question";
    case "intention":
      return "exclaim";
    default:
      return null;
  }
}
