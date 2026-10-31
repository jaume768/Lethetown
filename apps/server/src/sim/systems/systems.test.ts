/** Registro de sistemas: orden, acciones de cada uno, desactivar por mundo, instantánea y retención. */
import { ACTION_SPECS, type ActionType } from "@lethetown/shared";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { bootstrap, type App } from "../../bootstrap";
import { loadConfig } from "../../config";
import { RetentionConfig } from "../../retention";
import { availableActions, runAction } from "../actions";
import type { SimContext } from "../context";
import { itemsState } from "../items";
import {
  registeredSystems,
  restoreSystems,
  snapshotSystems,
  systemOfAction,
  systemSections,
} from ".";

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
afterEach(() => {
  (ctx.deps as { systems?: Record<string, boolean> }).systems = {};
});

describe("registro de sistemas", () => {
  it("se registran en el orden de sus revisiones (el del dorado)", () => {
    expect(registeredSystems().map((s) => s.id)).toEqual([
      "meetings",
      "items",
      "objects",
      "company",
      "notes",
      "norms",
      "places",
      "agreements",
      "world",
      "knowledge",
      "goals",
    ]);
  });

  it("cada acción del catálogo es de un sistema, salvo las del núcleo", () => {
    const orphans = (Object.keys(ACTION_SPECS) as ActionType[]).filter((t) => !systemOfAction(t));
    expect(orphans).toEqual(["do_activity", "say"]);
  });

  it("toda tabla de un sistema tiene política de retención (o dice por qué no)", () => {
    const policies = Object.keys(RetentionConfig.shape);
    for (const s of registeredSystems()) {
      const r = s.retention;
      if (r && "policy" in r) expect(policies).toContain(r.policy);
      if (r && "keep" in r) expect(r.keep.length).toBeGreaterThan(10);
    }
  });

  it("las secciones del prompt van por su orden: agenda, invitaciones, inventario", () => {
    const lucia = ctx.agents.get("lucia")!;
    const titles = systemSections(ctx, lucia, ctx.clock.now()).map((s) => s.title);
    expect(titles).toEqual([
      "AGENDA",
      "INVITACIONES",
      "LLEVAS",
      "HAS PRESTADO",
      "AQUÍ HAY",
      "PUEDES USAR",
      "TU PROYECTO",
    ]);
  });
});

describe("sistemas desactivados en un mundo", () => {
  it("sus acciones no se ofrecen y, si se piden, no se pueden hacer", async () => {
    const nuria = ctx.agents.get("nuria")!;
    nuria.state.locationId = "plaza";
    const c = { ctx, agent: nuria, now: ctx.clock.now() };
    expect(availableActions(c)).toContain("post_note");
    (ctx.deps as { systems?: Record<string, boolean> }).systems = { notes: false };
    expect(availableActions(c)).not.toContain("post_note");
    expect(await runAction(c, { type: "post_note", text: "Hola" })).toBe(false);
    const last = ctx.rt("nuria").pending.at(-1);
    expect(last && "text" in last ? last.text : "").toContain("no se puede hacer en este pueblo");
  });

  it("sus secciones no salen en el prompt", () => {
    (ctx.deps as { systems?: Record<string, boolean> }).systems = { items: false };
    const titles = systemSections(ctx, ctx.agents.get("lucia")!, ctx.clock.now()).map(
      (s) => s.title,
    );
    expect(titles).toEqual(["AGENDA", "INVITACIONES"]);
  });
});

describe("instantánea por sistema", () => {
  it("cada sistema guarda su parte con su versión", () => {
    const snap = snapshotSystems(ctx);
    expect(Object.keys(snap)).toEqual([
      "meetings",
      "items",
      "objects",
      "company",
      "notes",
      "norms",
      "knowledge",
      "goals",
    ]);
    expect(snap.items!.version).toBe(1);
  });

  it("si un sistema cambió de versión, solo ese empieza de cero", () => {
    const snap = structuredClone(snapshotSystems(ctx));
    const items = itemsState(ctx).items.size;
    snap.items!.version = 99;
    snap.notes!.data = { notes: "roto" };
    const { restored, skipped } = restoreSystems(ctx, snap);
    expect(skipped).toEqual(["items", "notes"]);
    expect(restored).toContain("meetings");
    expect(itemsState(ctx).items.size).toBe(items);
  });
});
