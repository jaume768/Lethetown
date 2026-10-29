import { untrusted, type Agent, type Perception } from "@lethetown/agent-core";
import type { Place } from "@lethetown/shared";
import type { Heard, SimContext } from "./context";
import { readNotes } from "./notes";

export interface Present {
  id: string;
  name: string;
  action: string;
}

/** Quién está en el mismo lugar, quieto y despierto. */
export function presentWith(ctx: SimContext, agent: Agent): Present[] {
  return [...ctx.agents.values()]
    .filter((o) => o.id !== agent.id)
    .filter((o) => !ctx.rt(o.id).travelling)
    .filter(
      (o) => o.state.locationId === agent.state.locationId && o.state.activityKind !== "sleep",
    )
    .map((o) => ({ id: o.id, name: o.seed.name, action: o.state.action }));
}

/**
 * Lo que percibe un agente en este tick: llegadas, frases dirigidas a él, cambios en los
 * objetos del lugar y percepciones pendientes (voz interior, rumores, clima). Vacía la bandeja.
 */
export function gatherPerceptions(
  ctx: SimContext,
  agent: Agent,
): { present: Present[]; heard: Heard[]; place: Place; perceptions: Perception[] } {
  const rt = ctx.rt(agent.id);
  const present = presentWith(ctx, agent);
  const arrivals = present.filter((p) => !rt.seenHere.has(p.id));
  rt.seenHere = new Set(present.map((p) => p.id));
  const heard = rt.inbox.splice(0);
  readNotes(ctx, agent);
  const place = ctx.world.place(agent.state.locationId);
  for (const o of place.objects) {
    const known = rt.knownStates.get(o.id) ?? "idle";
    if (o.state !== known) {
      rt.knownStates.set(o.id, o.state);
      if (o.state !== "idle") {
        rt.pending.push({
          kind: "world",
          text: `Noté que ${o.name} está: ${untrusted(o.state)}`,
          placeId: place.id,
        });
      }
    }
  }
  const perceptions: Perception[] = [
    ...arrivals.map((p) => ({
      kind: "arrived" as const,
      agentId: p.id,
      name: p.name,
      action: p.action,
      placeId: agent.state.locationId,
    })),
    ...heard.map((h) => ({ kind: "speech" as const, ...h, placeId: agent.state.locationId })),
    ...rt.pending.splice(0),
  ];
  return { present, heard, place, perceptions };
}
