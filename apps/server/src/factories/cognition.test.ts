/** Cognición en movimiento por mundo (fase 3.6): lo que guarda el mundo manda sobre SIM_COGNITION. */
import { describe, expect, it } from "vitest";
import { createServices, openWorld } from "../bootstrap";
import { NewWorld } from "../api/rest";
import { loadConfig } from "../config";
import type { SimContext } from "../sim/context";

const ENV = { LLM_PROVIDER: "mock", EMBEDDINGS: "hash", DATABASE_URL: "", SIM_SEED: "7" };
const ctxOf = (w: { sim: unknown }) => (w.sim as { ctx: SimContext }).ctx;

describe("cognition por mundo", () => {
  it("un mundo de control (cognition.enabled = false) abre con todo apagado", async () => {
    const services = await createServices(loadConfig(ENV), () => {});
    const input = NewWorld.parse({
      id: "control",
      name: "Control",
      map: "seeds/town.tmj",
      seed: 7,
      cognition: { enabled: false },
    });
    const row = await services.worldRepo.create(input);
    expect(row.cognition).toEqual({ enabled: false });
    const ctx = ctxOf(await openWorld(services, row));
    expect(ctx.cognition.enabled).toBe(false);
    expect(ctx.enabled("encounters")).toBe(false);
  });

  it("SIM_COGNITION es lo de por defecto; el mundo puede encender o apagar una parte", async () => {
    const services = await createServices(
      loadConfig({ ...ENV, SIM_COGNITION: "walkingTalk=off,associations=off" }),
      () => {},
    );
    const row = await services.worldRepo.create(
      NewWorld.parse({
        id: "mixto",
        name: "Mixto",
        map: "seeds/town.tmj",
        cognition: { associations: true },
      }),
    );
    const ctx = ctxOf(await openWorld(services, row));
    expect(ctx.cognition.walkingTalk).toBe(false);
    expect(ctx.cognition.associations).toBe(true);
    expect(ctx.cognition.encounters).toBe(true);
  });

  it("la API no acepta partes que no existen", () => {
    expect(
      NewWorld.safeParse({ id: "x", name: "X", map: "seeds/town.tmj", cognition: { volar: true } })
        .success,
    ).toBe(false);
  });
});
