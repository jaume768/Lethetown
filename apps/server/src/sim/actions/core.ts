/** Acciones básicas: cambiar de actividad (`do_activity`) y hablar (`say`). */
import { inferActivityKind } from "@lethetown/agent-core";
import type { DoActivityAction, SayAction } from "@lethetown/shared";
import type { z } from "zod";
import { talk } from "../conversations";
import { goOrDo } from "../routines";
import { registerAction } from "./registry";

/** Lo que dura un cambio de planes antes de volver al plan del día (minutos de juego). */
export const REPLAN_MINUTES = 60;

registerAction<z.infer<typeof DoActivityAction>>({
  type: "do_activity",
  available: () => true,
  check: ({ ctx }, a) =>
    ctx.world.places.some((p) => p.id === a.placeId)
      ? null
      : `no conozco ningún sitio llamado "${a.placeId}"`,
  describe: ({ ctx }, a) =>
    `${a.activity} en ${ctx.world.places.find((p) => p.id === a.placeId)?.name ?? a.placeId}`,
  execute: ({ ctx, agent, now }, a) => {
    const rt = ctx.rt(agent.id);
    const spot = agent.spot(a.spotId);
    const spotId = spot && spot.placeId === a.placeId ? spot.id : null;
    const activityKind = a.activityKind ?? inferActivityKind(a.activity, spot?.pose);
    rt.overrideUntil = now + REPLAN_MINUTES;
    // El cambio entra en el plan del día: el inspector muestra lo que hace de verdad.
    agent.replan(
      now,
      { activity: a.activity, activityKind, placeId: a.placeId, spotId },
      REPLAN_MINUTES,
    );
    ctx.emit(
      "action",
      agent.id,
      `${agent.seed.name} cambia de planes: ${a.activity}`,
      [agent.id],
      undefined,
      { action: "do_activity", ok: true },
    );
    goOrDo(ctx, agent, a.placeId, spotId, a.activity, activityKind);
  },
});

registerAction<z.infer<typeof SayAction>>({
  type: "say",
  available: ({ ctx, agent }) =>
    [...ctx.agents.values()].some(
      (o) =>
        o.id !== agent.id &&
        o.state.locationId === agent.state.locationId &&
        o.state.activityKind !== "sleep" &&
        !ctx.rt(o.id).travelling,
    ),
  check: ({ ctx, agent }, a) => {
    const target = ctx.agents.get(a.to);
    if (!target) return `no conozco a "${a.to}"`;
    if (target.state.locationId !== agent.state.locationId || ctx.rt(a.to).travelling) {
      return `${target.seed.name} no está aquí`;
    }
    if (target.state.activityKind === "sleep") return `${target.seed.name} está durmiendo`;
    return null;
  },
  describe: ({ ctx }, a) => `hablar con ${ctx.agents.get(a.to)?.seed.name ?? a.to}`,
  execute: ({ ctx, agent }, a) => talk(ctx, agent, a.to, a.text),
});
