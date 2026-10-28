import { randomUUID } from "node:crypto";
import { untrusted } from "@lethetown/agent-core";
import type { Weather, WorldRunStatus } from "@lethetown/shared";
import type { SimContext } from "./context";

/** Intervención del jugador (voz interior, objetos, clima) y avisos de pausa. */

const WEATHER_TEXT: Record<Weather, string> = {
  sunny: "Salió el sol",
  cloudy: "Se nubló el cielo",
  rain: "Empezó a llover",
};

/** "Voz interior": un pensamiento que el agente percibe como propio. */
export function injectThought(ctx: SimContext, agentId: string, text: string): void {
  const agent = ctx.agents.get(agentId);
  if (!agent) throw new Error(`Agente desconocido: ${agentId}`);
  ctx.rt(agentId).pending.push({ kind: "thought", text });
  ctx.emit("thought", agentId, `💭 Voz interior de ${agent.seed.name}: "${text}"`, [agentId]);
}

/** Cambia el estado de un objeto; quien esté en el lugar lo percibe ya, el resto al llegar. */
export function setSpotState(ctx: SimContext, spotId: string, state: string): void {
  const spot = ctx.world.setSpotState(spotId, state);
  const place = ctx.world.place(spot.placeId);
  const witnesses = [...ctx.agents.values()].filter(
    (a) => a.state.locationId === place.id && !ctx.rt(a.id).travelling,
  );
  const eventId = randomUUID();
  for (const a of witnesses) {
    const rt = ctx.rt(a.id);
    rt.knownStates.set(spot.id, state);
    rt.pending.push({
      kind: "world",
      text: `Noté que ${spot.name} (${place.name}) está: ${untrusted(state)}`,
      placeId: place.id,
      eventId,
    });
  }
  ctx.emit(
    "world",
    null,
    `🔧 ${spot.name} de ${place.name}: ${state}`,
    witnesses.map((a) => a.id),
    eventId,
  );
  ctx.signalWorld();
}

export function setWeather(ctx: SimContext, weather: Weather): void {
  ctx.world.weather = weather;
  const eventId = randomUUID();
  for (const [id, rt] of ctx.runtime) {
    if (ctx.agents.get(id)!.state.activityKind === "sleep") continue;
    rt.pending.push({ kind: "world", text: WEATHER_TEXT[weather], placeId: null, eventId });
  }
  ctx.emit("world", null, `🌦 ${WEATHER_TEXT[weather]}`, [...ctx.agents.keys()], eventId);
  ctx.signalWorld();
}

/** Avisa de que el mundo se pausó o se reanudó (presupuesto, kill switch, manual...). */
export function notifyStatus(ctx: SimContext, status: WorldRunStatus): void {
  const text =
    status.state === "running"
      ? "▶ El mundo se reanuda"
      : `⏸ Mundo en pausa: ${status.detail ?? status.reason}`;
  ctx.emit("system", null, text);
  ctx.signal({ type: "status", status });
}
