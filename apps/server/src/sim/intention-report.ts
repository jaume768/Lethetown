/** Lo que pasa con la memoria prospectiva en un turno, en el log y en sus percepciones. */
import type { Agent, IntentionOutcome } from "@lethetown/agent-core";
import type { SimContext } from "./context";

/**
 * Emite los eventos de las intenciones de este turno (✅ se acuerda, 🫥 se le pasa, 😳 cae en la
 * cuenta tarde) y le pasa el recordatorio como percepción. `handled` (fase 3.6): un recordatorio
 * que ya usa quien llama (p. ej. el encuentro por el camino) no va a sus percepciones.
 */
export function reportIntentions(
  ctx: SimContext,
  agent: Agent,
  outcomes: IntentionOutcome[],
  handled: (o: IntentionOutcome) => boolean = () => false,
): void {
  const rt = ctx.rt(agent.id);
  for (const o of outcomes) {
    const who = o.intention.personId ? ctx.agents.get(o.intention.personId)?.seed.name : null;
    const name = agent.seed.name;
    if (o.kind === "kept") {
      if (!handled(o)) rt.pending.push({ kind: "world", text: o.reminder!, placeId: null });
      ctx.emit("memory", agent.id, `✅ ${name} se acuerda de ${o.intention.text}`, [agent.id]);
    } else if (o.kind === "missed") {
      ctx.emit(
        "memory",
        agent.id,
        `🫥 A ${name} se le pasa ${o.intention.text}${who ? ` (y eso que estaba con ${who})` : ""}`,
        [agent.id],
      );
    } else if (o.kind === "late") {
      ctx.emit("memory", agent.id, `😳 ¡Vaya! A ${name} se le olvidó ${o.intention.text}`, [
        agent.id,
      ]);
    }
  }
}
