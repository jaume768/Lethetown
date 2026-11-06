/**
 * Pensar andando (fase 3.6). Quien camina no tiene turno normal (simulation.ts se lo salta);
 * solo piensa si algo se lo pide: un encuentro saliente (encounters.ts) o que le hablen (charla
 * en el camino o yendo juntos). Sigue andando mientras espera al LLM; cuando llega la respuesta
 * se revalida: si la otra persona ya no está cerca, la decisión se descarta (sin «No pude…»,
 * con su cifra). Con la cognición apagada no hay turnos andando.
 */
import { SALIENCE_TEXT, type Agent, type Decision, type Perception } from "@lethetown/agent-core";
import type { ActionType } from "@lethetown/shared";
import type { Heard, SimContext } from "./context";
import { availableActions } from "./actions";
import {
  countStat,
  encountersState,
  moving,
  sighted,
  visibleOf,
  walkTurnAvailable,
  type WalkCue,
} from "./encounters";
import type { Present } from "./perception";
import { awake, inCallRange, reachable, walkingTogether } from "./presence";
import type { PromptSection } from "./systems/types";

/** Lo que se le puede ofrecer andando (del resto del catálogo, nada). */
const WALKING_ACTIONS: ReadonlySet<ActionType> = new Set([
  "say",
  "greet",
  "stop_to_chat",
  "do_activity",
]);

/** Orden de la sección DE CAMINO (antes de los lugares descubiertos y del resto). */
export const WALKING_SECTION_ORDER = 1;

export interface WalkingTurn {
  /** Lo que le dicen andando (va a la memoria como siempre). */
  perceptions: Perception[];
  heard: Heard[];
  /** Quién tiene cerca (lo que se le ve). */
  present: Present[];
  sections: PromptSection[];
  actions: ActionType[];
  cue: WalkCue | null;
  /** Al llegar la respuesta: ver `Revalidated`. */
  revalidate(decision: Decision): Revalidated;
}

/**
 * La decisión al llegar la respuesta: vale ya; vale pero aún no se han cruzado (se hace a
 * `at`, cuando se crucen); o llega tarde (`decision: null`, se descarta).
 */
export interface Revalidated {
  decision: Decision | null;
  at?: number;
}

/** Quién tiene al alcance de la voz (o ve venir) y se ve, en el formato de PRESENTES. */
export function nearbyPresent(ctx: SimContext, agent: Agent, now: number): Present[] {
  return [...ctx.agents.values()]
    .filter(
      (o) =>
        o.id !== agent.id &&
        awake(ctx, o) &&
        (inCallRange(ctx, agent, o) || sighted(ctx, agent.id, o.id, now)),
    )
    .map((o) => ({ id: o.id, name: o.seed.name, action: visibleOf(ctx, o) }));
}

/** El turno andando de quien camina, si algo se lo pide (o null). */
export function walkingTurn(ctx: SimContext, agent: Agent, now: number): WalkingTurn | null {
  if (!ctx.cognition.enabled) return null;
  const rt = ctx.rt(agent.id);
  if (!rt.travelling) return null;
  const st = encountersState(ctx);
  const cue = st.cues.get(agent.id) ?? null;
  st.cues.delete(agent.id);
  const heard = rt.inbox.splice(0);
  if (!cue && !heard.length) return null;
  // Lo que le dicen siempre se atiende (el ritmo de la charla); un encuentro, si le quedan turnos.
  if (!heard.length && !walkTurnAvailable(ctx, agent.id, now, true)) return null;
  countStat(ctx, "walkDecisions");

  const trip = st.trips.get(agent.id);
  const goal = rt.arrival ?? trip;
  const dest = goal ? ctx.world.place(goal.destId).name : "tu destino";
  const why = goal?.thenAction;
  const lines = [
    rt.arrival
      ? `Vas de camino a ${dest}${why ? ` para ${why}` : ""}.`
      : `Te has parado a charlar en mitad del camino; ibas a ${dest}${why ? ` para ${why}` : ""}.`,
  ];
  const other = cue ? ctx.agents.get(cue.withId) : undefined;
  if (cue && other) {
    const reasons = cue.reasons.filter((r) => r !== "together").map((r) => SALIENCE_TEXT[r]);
    lines.push(
      cue.together
        ? `Vas con ${other.id}=${other.seed.name}.`
        : `${cue.meetAt > now + 0.5 ? "Ves venir a" : "Te cruzas con"} ${other.id}=${other.seed.name}, que ${visibleOf(ctx, other)}${reasons.length ? ` (${reasons.join("; ")})` : ""}.`,
    );
    if (cue.reminder) lines.push(cue.reminder);
  }
  const greeter = heard.find((h) => st.greeted.get(agent.id)?.from === h.fromId);
  if (greeter) lines.push(`${greeter.fromName} te ha saludado al pasar.`);
  lines.push(
    "Andando puedes seguir tu camino (continue), saludar al pasar (greet), pararte a charlar (stop_to_chat), hablar con quien va contigo (say) o cambiar de destino (do_activity).",
  );
  // Con quien va a su lado se habla andando: ni se para ni se saluda al pasar.
  const companion = (id: string | null | undefined) => {
    const o = id ? ctx.agents.get(id) : undefined;
    return Boolean(o && walkingTogether(ctx, agent, o));
  };
  const alongside = cue?.together || heard.some((h) => companion(h.fromId));
  const actions = availableActions({ ctx, agent, now }).filter(
    (t) => WALKING_ACTIONS.has(t) && !(alongside && (t === "stop_to_chat" || t === "greet")),
  );
  return {
    perceptions: heard.map((h) => ({
      kind: "speech" as const,
      ...h,
      placeId: agent.state.locationId,
    })),
    heard,
    present: nearbyPresent(ctx, agent, now),
    sections: [{ title: "DE CAMINO", lines, order: WALKING_SECTION_ORDER }],
    actions,
    cue,
    revalidate: (d) => revalidate(ctx, agent, d),
  };
}

/** A quién va dirigida una acción del camino (si va a alguien). */
function targetOf(d: Decision): string | null {
  if (d.kind !== "act") return null;
  const a = d.action;
  return a.type === "say" || a.type === "greet" || a.type === "stop_to_chat" ? a.to : null;
}

/**
 * La respuesta llegó mientras seguía andando. Si la otra persona está al alcance de la voz, vale.
 * Si aún no se han cruzado (la vio venir), se hará al cruzarse (`at`). Si ya se alejaron (o ya
 * llegó y no se ven), se descarta sin percepción «No pude…» (nadie lo intentó de verdad), con
 * su cifra y un evento en el log.
 */
export function revalidate(ctx: SimContext, agent: Agent, d: Decision, final = false): Revalidated {
  const to = targetOf(d);
  if (!to || d.kind !== "act") return { decision: d };
  const other = ctx.agents.get(to);
  const now = ctx.clock.now();
  const walking = moving(ctx, agent.id);
  const ok =
    other &&
    awake(ctx, other) &&
    (d.action.type === "say"
      ? reachable(ctx, agent, other)
      : inCallRange(ctx, agent, other) && (d.action.type !== "stop_to_chat" || walking));
  if (ok) return { decision: d };
  const meet = encountersState(ctx).sightings.get(agent.id);
  if (!final && other && walking && meet?.withId === to && meet.meetAt > now) {
    return { decision: d, at: meet.meetAt };
  }
  countStat(ctx, "lateDiscarded");
  ctx.emit(
    "action",
    agent.id,
    `⌛ ${agent.seed.name} iba a ${d.action.type === "greet" ? "saludar" : "hablar"} a ${other?.seed.name ?? to}, pero ya se habían alejado`,
    [agent.id, to],
    undefined,
    { action: d.action.type, ok: false, late: true },
  );
  return { decision: null };
}
