/**
 * Pensamiento por asociación (fase 3.6, sistema `associations`), sin LLM: al pasar por un sitio,
 * al ver a alguien por el camino o al ponerse en un objeto, uno o dos recuerdos que tienen que
 * ver con eso le vienen a la cabeza (`Agent.associate`, la recuperación de siempre con refuerzo
 * y espaciado). Entran en la memoria de trabajo («te viene a la cabeza…») y aparecen en su
 * siguiente decisión y en el inspector. Tope por agente y hora; nunca llama al LLM por sí solo.
 */
import type { Agent } from "@lethetown/agent-core";
import type { SimContext } from "./context";
import { awake, tileNow } from "./presence";

export interface AssociationsState {
  /** Asociaciones por agente en la hora de juego en curso. */
  perHour: Map<string, { hour: number; n: number }>;
  /** El último sitio por el que pasó o en el que estaba (para notar uno nuevo). */
  lastPlace: Map<string, string>;
  /** El último objeto en el que estaba. */
  lastSpot: Map<string, string>;
  totals: Record<string, number>;
  byDay: Map<number, Record<string, number>>;
}

export const associationsState = (ctx: SimContext) =>
  ctx.state<AssociationsState>("associations", () => ({
    perHour: new Map(),
    lastPlace: new Map(),
    lastSpot: new Map(),
    totals: {},
    byDay: new Map(),
  }));

function count(ctx: SimContext, stat: string): void {
  const st = associationsState(ctx);
  st.totals[stat] = (st.totals[stat] ?? 0) + 1;
  const day = Math.floor(ctx.clock.now() / 1440);
  const today = st.byDay.get(day) ?? {};
  today[stat] = (today[stat] ?? 0) + 1;
  st.byDay.set(day, today);
}

/** Una pista: el sitio por el que pasa, la persona que ve o el objeto en el que se pone. */
export type AssociationCue =
  | { kind: "place"; id: string; name: string }
  | { kind: "person"; id: string; name: string }
  | { kind: "object"; id: string; name: string };

const CUE_TEXT: Record<AssociationCue["kind"], (name: string) => string> = {
  place: (name) => `al pasar por ${name}`,
  person: (name) => `al ver a ${name}`,
  object: (name) => `con «${name}» delante`,
};

/**
 * Le trae a la cabeza lo que tenga que ver con la pista (si el sistema está activo y le quedan
 * asociaciones esta hora). Solo gasta del tope si de verdad le viene algo.
 */
export async function associateCue(
  ctx: SimContext,
  agent: Agent,
  cue: AssociationCue,
  now: number,
): Promise<void> {
  if (!ctx.enabled("associations")) return;
  const st = associationsState(ctx);
  const p = ctx.cognition.params;
  const hour = Math.floor(now / 60);
  const used = st.perHour.get(agent.id);
  const n = used && used.hour === hour ? used.n : 0;
  if (n >= p.maxAssociationsPerHour) return;
  const hits = await agent.associate(
    now,
    {
      query: cue.name,
      ...(cue.kind === "place" ? { placeId: cue.id } : {}),
      ...(cue.kind === "person" ? { personId: cue.id } : {}),
    },
    p.associationRecall,
    { minImportance: p.associationMinImportance, minAgeMinutes: p.associationMinAgeMinutes },
  );
  if (!hits.length) return;
  st.perHour.set(agent.id, { hour, n: n + 1 });
  const first = hits[0]!;
  agent.state.cameToMind = { text: first.text, at: now, cue: cue.name };
  count(ctx, "associations");
  count(ctx, `by.${cue.kind}`);
  if (hits.some((h) => h.intrusive)) count(ctx, "intrusive");
  for (const h of hits) {
    ctx.emit(
      "memory",
      agent.id,
      `💭 A ${agent.seed.name}, ${CUE_TEXT[cue.kind](cue.name)}, le viene a la cabeza${h.intrusive ? ", sin querer" : ""}: «${h.text}»`,
      [agent.id, ...(cue.kind === "person" ? [cue.id] : [])],
      undefined,
      { action: "association", ok: true },
    );
  }
}

/**
 * Revisión periódica (sin LLM): quien camina y entra en un sitio nuevo de su ruta (no el de
 * salida), y quien se pone en un objeto, puede acordarse de algo.
 */
export async function associationsTick(ctx: SimContext, now: number): Promise<void> {
  const st = associationsState(ctx);
  for (const agent of ctx.agents.values()) {
    if (!awake(ctx, agent)) continue;
    const rt = ctx.rt(agent.id);
    if (rt.travelling) {
      const place = ctx.world.placeAt(tileNow(ctx, agent));
      if (!place || place.id === st.lastPlace.get(agent.id)) continue;
      st.lastPlace.set(agent.id, place.id);
      // El sitio del que sale y el de destino no son «pasar por» (ahí ya está o estará).
      if (place.id === agent.state.locationId || place.id === agent.state.targetId) continue;
      await associateCue(ctx, agent, { kind: "place", id: place.id, name: place.name }, now);
      continue;
    }
    st.lastPlace.set(agent.id, agent.state.locationId);
    const spotId = agent.state.spotId;
    if (!spotId || st.lastSpot.get(agent.id) === spotId) continue;
    st.lastSpot.set(agent.id, spotId);
    const spot = ctx.world.spot(spotId);
    if (spot && agent.state.activityKind !== "sleep") {
      await associateCue(ctx, agent, { kind: "object", id: spot.id, name: spot.name }, now);
    }
  }
}
