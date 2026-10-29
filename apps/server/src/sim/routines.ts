import { inferActivityKind, type Agent } from "@lethetown/agent-core";
import { facingOf, pathLength, type ActivityKind } from "@lethetown/shared";
import type { Arrival, SimContext } from "./context";
import { discoverAlong } from "./places";
import { tileKey } from "./world";

/** Rutinas sin LLM: desplazarse, hacer la actividad, necesidades. */

/** Acciones de relleno que no van al diario del día. */
const IDLE = new Set(["pensando en el día", "tiempo libre", "durmiendo"]);

/** Si ya está en el sitio, hace la actividad; si no, se pone en camino. */
export function goOrDo(
  ctx: SimContext,
  agent: Agent,
  placeId: string,
  spotId: string | null,
  action: string,
  kind: ActivityKind,
): void {
  const there = agent.state.locationId === placeId && (!spotId || agent.state.spotId === spotId);
  if (!there) return travel(ctx, agent, placeId, spotId, action, kind);
  setAction(ctx, agent, action, kind);
}

/** Ruta A* hasta el spot (o una baldosa libre del lugar) con llegada programada. */
export function travel(
  ctx: SimContext,
  agent: Agent,
  destId: string,
  spotId: string | null,
  thenAction: string,
  thenKind: ActivityKind,
): void {
  const rt = ctx.rt(agent.id);
  const now = ctx.clock.now();
  const world = ctx.world;
  const spot = spotId ? world.spot(spotId) : undefined;
  const goal = world.restingTile(destId, spot?.tile ?? null, occupiedTiles(ctx, agent.id));
  const waypoints = world.route(agent.state.tile, goal) ?? [agent.state.tile, goal];
  const minutes = Math.max(1, Math.round(pathLength(waypoints) / ctx.deps.walkSpeed));
  const dest = world.place(destId);

  rt.travelling = true;
  rt.seenHere.clear();
  agent.state.targetId = destId;
  agent.state.spotId = spot && spot.tile.x === goal.x && spot.tile.y === goal.y ? spot.id : null;
  agent.state.movement = { waypoints, startTime: now, endTime: now + minutes };
  if (waypoints.length > 1) agent.state.facing = facingOf(waypoints[0]!, waypoints[1]!);
  setAction(ctx, agent, `caminando a ${dest.name}`, "walk");
  rt.arrival = { destId, goal, thenAction, thenKind, at: now + minutes };
  scheduleArrival(ctx, agent, rt.arrival);
}

/**
 * Ir juntos: el primero calcula la ruta y los demás la comparten (mismos puntos y mismos
 * tiempos; cada uno acaba en una baldosa libre del destino).
 */
export function travelTogether(
  ctx: SimContext,
  leader: Agent,
  others: Agent[],
  destId: string,
  thenAction: string,
  thenKind: ActivityKind,
): void {
  travel(ctx, leader, destId, null, thenAction, thenKind);
  const lead = leader.state.movement;
  const leadArrival = ctx.rt(leader.id).arrival;
  for (const other of others) {
    travel(ctx, other, destId, null, thenAction, thenKind);
    const mine = other.state.movement;
    const arrival = ctx.rt(other.id).arrival;
    if (!lead || !mine || !arrival || !leadArrival) continue;
    // La ruta del primero (sin su baldosa final) y la suya propia al llegar.
    mine.waypoints = [other.state.tile, ...lead.waypoints.slice(1, -1), arrival.goal];
    mine.startTime = lead.startTime;
    mine.endTime = lead.endTime;
    // La llegada que programó travel() no hará nada (ya no es la vigente a esa hora).
    arrival.at = leadArrival.at;
    scheduleArrival(ctx, other, arrival);
  }
}

export function scheduleArrival(ctx: SimContext, agent: Agent, arrival: Arrival): void {
  const rt = ctx.rt(agent.id);
  ctx.clock.schedule(arrival.at, () => {
    // Solo la llegada vigente: si cambió de rumbo o de hora por el camino, esta ya no vale.
    if (rt.arrival !== arrival || ctx.clock.now() < arrival.at) return;
    // Lo que ha visto por el camino (y el sitio al que llega, si no lo conocía).
    const path = agent.state.movement?.waypoints ?? [arrival.goal];
    const source = arrival.thenAction.startsWith("explorando") ? "explored" : "seen";
    discoverAlong(ctx, agent, path, arrival.destId, arrival.at, source);
    const prev = agent.state.movement?.waypoints.at(-2);
    if (prev) agent.state.facing = facingOf(prev, arrival.goal);
    agent.state.tile = arrival.goal;
    agent.state.locationId = arrival.destId;
    agent.state.targetId = null;
    agent.state.movement = null;
    rt.travelling = false;
    rt.arrival = null;
    setAction(ctx, agent, arrival.thenAction, arrival.thenKind);
  });
}

/** Baldosas ocupadas por agentes quietos o reservadas como destino de un viaje. */
function occupiedTiles(ctx: SimContext, exceptId: string): Set<string> {
  const occupied = new Set<string>();
  for (const a of ctx.agents.values()) {
    if (a.id === exceptId) continue;
    occupied.add(tileKey(a.state.movement?.waypoints.at(-1) ?? a.state.tile));
  }
  return occupied;
}

export function setAction(
  ctx: SimContext,
  agent: Agent,
  action: string,
  kind?: ActivityKind,
): void {
  const spot = agent.spot(agent.state.spotId);
  agent.state.activityKind = kind ?? inferActivityKind(action, spot?.pose);
  if (agent.state.action === action) return;
  agent.state.action = action;
  ctx.emit("action", agent.id, `${agent.seed.name}: ${action}`, [agent.id]);
  // Diario del día: lo que de verdad hace (caminar, dormir y charlar ya se recuerdan aparte).
  const kindNow = agent.state.activityKind;
  if (kindNow !== "walk" && kindNow !== "sleep" && kindNow !== "talk" && !IDLE.has(action)) {
    agent.noteActivity(ctx.clock.now(), action, agent.state.locationId);
  }
}
