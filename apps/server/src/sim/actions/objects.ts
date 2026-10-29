/**
 * Usar objetos del mapa (`use_object`) con su máquina de estados (shared/objects/machines.ts):
 * el motor comprueba que el verbo vale en el estado actual, cambia el estado y, si dura, lo
 * devuelve solo pasado el rato (`objectsTick`). Arreglar algo roto puede no salir a la primera.
 */
import { verbsFor, type UseObjectAction } from "@lethetown/shared";
import type { z } from "zod";
import type { SimContext } from "../context";
import { goOrDo } from "../routines";
import { registerAction } from "./registry";

/** Probabilidad de arreglar algo roto en un intento. */
const REPAIR_SUCCESS = 0.7;

/** Cambia el estado de un objeto sin avisos (quien está delante ya lo ve cambiar). */
function setState(ctx: SimContext, spotId: string, state: string): void {
  const spot = ctx.world.setSpotState(spotId, state);
  for (const a of ctx.agents.values()) {
    if (a.state.locationId === spot.placeId) ctx.rt(a.id).knownStates.set(spotId, state);
  }
  ctx.signalWorld();
}

/** Devuelve a su estado los objetos cuyo rato ha pasado (si nadie los ha cambiado entretanto). */
export function objectsTick(ctx: SimContext, now: number): void {
  for (const [spotId, t] of [...ctx.objectTimers]) {
    if (now < t.at) continue;
    ctx.objectTimers.delete(spotId);
    if (ctx.world.spot(spotId)?.state === t.from) setState(ctx, spotId, t.state);
  }
}

registerAction<z.infer<typeof UseObjectAction>>({
  type: "use_object",
  available: ({ ctx, agent }) =>
    ctx.world.place(agent.state.locationId).objects.some((o) => verbsFor(o.id, o.state).length > 0),
  check: ({ ctx, agent }, a) => {
    const spot = ctx.world.spot(a.objectId);
    if (!spot || spot.placeId !== agent.state.locationId)
      return `aquí no hay ningún "${a.objectId}"`;
    if (!verbsFor(spot.id, spot.state).some((v) => v.verb === a.verb)) {
      return `no se puede "${a.verb}" con ${spot.name} ahora (está ${spot.state})`;
    }
    return null;
  },
  describe: ({ ctx }, a) => `${a.verb} ${ctx.world.spot(a.objectId)?.name ?? a.objectId}`,
  execute: ({ ctx, agent, now }, a) => {
    const spot = ctx.world.spot(a.objectId)!;
    const verb = verbsFor(spot.id, spot.state).find((v) => v.verb === a.verb)!;
    const rt = ctx.rt(agent.id);
    rt.overrideUntil = now + (verb.minutes ?? 15);
    goOrDo(ctx, agent, spot.placeId, spot.id, verb.activity, verb.activityKind);
    if (verb.verb === "arreglar" && ctx.deps.rng() >= REPAIR_SUCCESS) {
      ctx.rt(agent.id).pending.push({
        kind: "world",
        text: `Intenté arreglar ${spot.name}, pero sigue ${spot.state}.`,
        placeId: spot.placeId,
      });
      ctx.emit(
        "action",
        agent.id,
        `🔧 ${agent.seed.name} intenta arreglar ${spot.name}, sin suerte`,
        [agent.id],
        undefined,
        { action: "use_object", ok: false },
      );
      return;
    }
    const before = spot.state;
    setState(ctx, spot.id, verb.to);
    if (verb.minutes && verb.after) {
      ctx.objectTimers.set(spot.id, { at: now + verb.minutes, state: verb.after, from: verb.to });
    } else {
      ctx.objectTimers.delete(spot.id);
    }
    const icon = verb.verb === "arreglar" ? "🔧" : "🛠";
    const text =
      verb.verb === "arreglar"
        ? `${icon} ${agent.seed.name} arregla ${spot.name} (estaba ${before})`
        : `${icon} ${agent.seed.name}: ${verb.label} (${spot.name})`;
    ctx.emit("action", agent.id, text, [agent.id], undefined, { action: "use_object", ok: true });
  },
});
