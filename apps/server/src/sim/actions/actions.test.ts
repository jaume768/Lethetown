/** Motor de acciones: catálogo completo, disponibilidad, precondiciones y fallos como percepción. */
import { AgentAction, ACTION_SPECS } from "@lethetown/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootstrap, type App } from "../../bootstrap";
import { loadConfig } from "../../config";
import type { SimContext } from "../context";
import { availableActions, registeredActions, runAction } from ".";

let app: App;
let ctx: SimContext;

beforeAll(async () => {
  app = await bootstrap(
    loadConfig({ LLM_PROVIDER: "mock", EMBEDDINGS: "hash", DATABASE_URL: "", SIM_SEED: "7" }),
    () => {},
  );
  ctx = (app.defaultWorld.sim as unknown as { ctx: SimContext }).ctx;
});
afterAll(() => app.close());

const at = (id: string, placeId: string) => {
  const a = ctx.agents.get(id)!;
  a.state.locationId = placeId;
  a.state.activityKind = "idle";
  return a;
};

describe("catálogo de acciones", () => {
  it("cada acción del esquema tiene descripción para el prompt y manejador en el motor", () => {
    const types = AgentAction.options.map((o) => o.shape.type.value).sort();
    expect(Object.keys(ACTION_SPECS).sort()).toEqual(types);
    expect(registeredActions().sort()).toEqual(types);
  });

  it("solo se ofrece hablar si hay alguien despierto en el mismo sitio", () => {
    const lucia = at("lucia", "biblioteca");
    for (const a of ctx.agents.values()) if (a.id !== "lucia") at(a.id, "casa_roja");
    const now = app.defaultWorld.clock.now();
    expect(availableActions({ ctx, agent: lucia, now })).toEqual(["do_activity"]);
    at("mateo", "biblioteca");
    expect(availableActions({ ctx, agent: lucia, now })).toEqual([
      "do_activity",
      "say",
      "propose_meeting",
    ]);
  });

  it("si no es posible, el agente lo percibe con el motivo y queda un evento con el resultado", async () => {
    const lucia = at("lucia", "biblioteca");
    at("mateo", "cafe_ola");
    const events: { text: string; meta?: unknown }[] = [];
    const off = ctx.onEvent((e) => events.push(e));
    const ok = await runAction(
      { ctx, agent: lucia, now: app.defaultWorld.clock.now() },
      { type: "say", to: "mateo", text: "Hola" },
    );
    off();
    expect(ok).toBe(false);
    const pending = ctx.rt("lucia").pending.at(-1);
    expect(pending).toMatchObject({
      kind: "world",
      text: "No pude hablar con Mateo Ruiz: Mateo Ruiz no está aquí.",
    });
    expect(events.at(-1)).toMatchObject({ meta: { action: "say", ok: false } });
  });

  it("un lugar que no existe no se ejecuta; uno que sí, cambia el plan", async () => {
    const lucia = at("lucia", "biblioteca");
    const c = { ctx, agent: lucia, now: app.defaultWorld.clock.now() };
    const bad = await runAction(c, {
      type: "do_activity",
      activity: "ir a la luna",
      activityKind: undefined,
      placeId: "luna",
      spotId: null,
    });
    expect(bad).toBe(false);
    expect(ctx.rt("lucia").pending.at(-1)?.kind).toBe("world");
    const good = await runAction(c, {
      type: "do_activity",
      activity: "leer un rato",
      activityKind: undefined,
      placeId: "biblioteca",
      spotId: null,
    });
    expect(good).toBe(true);
    expect(lucia.state.plan.some((p) => p.activity === "leer un rato" && p.replanned)).toBe(true);
    // activityKind deducido del texto.
    expect(lucia.state.activityKind).toBe("read");
  });
});
