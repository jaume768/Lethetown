import { describe, expect, it } from "vitest";
import { createServices, openWorld } from "../bootstrap";
import { loadConfig } from "../config";
import { tileAt } from "@lethetown/shared";
import { runAction } from "./actions";
import type { SimContext } from "./context";
import { activeConversationOf, endConversation } from "./conversations";
import { encountersState, moving, resumeTrips, stopped } from "./encounters";
import { travel } from "./routines";
import { parseSnapshot } from "./snapshot";

const ENV = {
  LLM_PROVIDER: "mock",
  EMBEDDINGS: "hash",
  DATABASE_URL: "",
  SIM_SEED: "11",
};

async function freshWorld() {
  const services = await createServices(loadConfig(ENV), () => {});
  const row = await services.worldRepo.ensureDefault("seeds/town.tmj", 11);
  return { services, row };
}

describe("instantáneas de simulación", () => {
  it("ida y vuelta: guardar, restaurar en un mundo nuevo y volver a guardar da lo mismo", async () => {
    const a = await freshWorld();
    const wa = await openWorld(a.services, a.row);
    wa.start();
    // 30 h y pico: hay planes hechos, conversaciones, viajes y percepciones pendientes.
    await wa.clock.runUntil(wa.clock.now() + 30 * 60 + 13);
    const saved = JSON.parse(JSON.stringify(wa.sim.snapshot()));
    const parsed = parseSnapshot(saved);
    expect(parsed).not.toBeNull();

    const b = await freshWorld();
    await b.services.snapshots.save(b.row.id, parsed!.time, "test", saved);
    const wb = await openWorld(b.services, b.row);
    expect(wb.restoredFrom).toBe(parsed!.time);
    expect(wb.clock.now()).toBe(parsed!.time);
    expect(JSON.parse(JSON.stringify(wb.sim.snapshot()))).toEqual(saved);
    expect(wb.sim.agentStates().map((s) => s.tile)).toEqual(
      wa.sim.agentStates().map((s) => s.tile),
    );
  }, 30_000);

  it("al restaurar a mitad de un viaje, el agente llega a su destino", async () => {
    const a = await freshWorld();
    const wa = await openWorld(a.services, a.row);
    wa.start();
    // Avanza hasta que alguien esté caminando.
    let snap = wa.sim.snapshot();
    for (let i = 0; i < 200 && !snap.agents.some((s) => s.runtime.arrival); i++) {
      await wa.clock.runUntil(wa.clock.now() + 1);
      snap = wa.sim.snapshot();
    }
    const walker = snap.agents.find((s) => s.runtime.arrival)!;
    expect(walker).toBeDefined();

    const b = await freshWorld();
    await b.services.snapshots.save(b.row.id, snap.time, "test", JSON.parse(JSON.stringify(snap)));
    const wb = await openWorld(b.services, b.row);
    wb.start();
    await wb.clock.runUntil(walker.runtime.arrival!.at + 0.5);
    const after = wb.sim.snapshot().agents.find((s) => s.id === walker.id)!;
    expect(after.state.locationId).toBe(walker.runtime.arrival!.destId);
  }, 30_000);
});

describe("instantáneas: cognición en movimiento (fase 3.6)", () => {
  it("una charla en el camino y el viaje a medias sobreviven y luego se retoma", async () => {
    const ctxOf = (w: { sim: unknown }) => (w.sim as { ctx: SimContext }).ctx;

    const a = await freshWorld();
    const wa = await openWorld(a.services, a.row);
    const ca = ctxOf(wa);
    for (const id of ["lucia", "carmen"]) ca.agents.get(id)!.state.activityKind = "idle";
    const lucia = ca.agents.get("lucia")!;
    travel(ca, lucia, "plaza", null, "dar una vuelta", "idle");
    const carmen = ca.agents.get("carmen")!;
    carmen.state.tile = tileAt(lucia.state, ca.clock.now());
    carmen.state.locationId = ca.world.publicPlaceNear(carmen.state.tile).id;
    expect(
      await runAction(
        { ctx: ca, agent: lucia, now: ca.clock.now() },
        { type: "stop_to_chat", to: "carmen", text: "¡Carmen! ¿Qué tal?" },
      ),
    ).toBe(true);
    const saved = JSON.parse(JSON.stringify(wa.sim.snapshot()));

    const b = await freshWorld();
    await b.services.snapshots.save(b.row.id, saved.time, "test", saved);
    const wb = await openWorld(b.services, b.row);
    const cb = ctxOf(wb);
    expect(stopped(cb, "lucia")).toBe(true);
    expect(encountersState(cb).trips.get("lucia")?.destId).toBe("plaza");
    const conv = activeConversationOf(cb, "lucia")!.conv;
    expect(conv.road).toBe(true);
    await endConversation(cb, conv.id, "fin");
    resumeTrips(cb, cb.clock.now());
    expect(moving(cb, "lucia")).toBe(true);
  }, 30_000);
});
