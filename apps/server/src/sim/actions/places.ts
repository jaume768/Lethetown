/** Explorar el pueblo: la IA decide salir a explorar; el motor elige la ruta (ver sim/places.ts). */
import type { ExploreAction } from "@lethetown/shared";
import type { z } from "zod";
import { nextToExplore } from "../places";
import { travel } from "../routines";
import { REPLAN_MINUTES } from "./core";
import { registerAction, type ActionContext } from "./registry";

/** Las casas no son destino de una exploración (se ven al pasar, no se entra). */
const target = (c: ActionContext, zone?: string | null) => {
  const homes = new Set(c.ctx.world.places.filter((p) => p.kind === "home").map((p) => p.id));
  const next = nextToExplore(c.ctx, c.agent, zone);
  return next && !homes.has(next.id) ? next : undefined;
};

registerAction<z.infer<typeof ExploreAction>>({
  type: "explore",
  available: (c) => Boolean(target(c)),
  check: (c, a) => (target(c, a.zone) ? null : "ya conozco todos los sitios del pueblo"),
  describe: (_c, a) => `explorar el pueblo${a.zone ? ` hacia el ${a.zone}` : ""}`,
  execute: ({ ctx, agent, now }, a) => {
    const dest = target({ ctx, agent, now }, a.zone)!;
    const rt = ctx.rt(agent.id);
    rt.overrideUntil = now + REPLAN_MINUTES;
    agent.replan(
      now,
      { activity: "explorar el pueblo", activityKind: "walk", placeId: dest.id, spotId: null },
      REPLAN_MINUTES,
    );
    ctx.emit(
      "action",
      agent.id,
      `🧭 ${agent.seed.name} sale a explorar${a.zone ? ` hacia el ${a.zone}` : ""}`,
      [agent.id],
      undefined,
      { action: "explore", ok: true },
    );
    travel(ctx, agent, dest.id, null, `explorando ${dest.name}`, "idle");
  },
});
