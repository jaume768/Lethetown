/** Inventario y objetos: el libro de Carmen, prestar, devolver, plazos, menores, dejar y usar. */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { bootstrap, type App } from "../bootstrap";
import { loadConfig } from "../config";
import { runAction } from "./actions";
import { objectsTick } from "./actions/objects";
import type { SimContext } from "./context";
import { inventorySections, itemsState, itemsTick } from "./items";

let app: App;
let ctx: SimContext;
const NOW = 10 * 60;

beforeAll(async () => {
  app = await bootstrap(
    loadConfig({ LLM_PROVIDER: "mock", EMBEDDINGS: "hash", DATABASE_URL: "", SIM_SEED: "7" }),
    () => {},
  );
  ctx = (app.defaultWorld.sim as unknown as { ctx: SimContext }).ctx;
});
afterAll(() => app.close());

const agent = (id: string) => ctx.agents.get(id)!;
const itemNamed = (name: string) =>
  [...itemsState(ctx).items.values()].find((i) => i.name === name)!;
const act = (id: string, action: Parameters<typeof runAction>[1]) =>
  runAction({ ctx, agent: agent(id), now: NOW }, action);
const lastText = (id: string) => {
  const p = ctx.rt(id).pending.at(-1);
  return p && "text" in p ? p.text : "";
};
/** Pone a todos en un sitio, despiertos y quietos. */
function at(placeId: string, ...ids: string[]) {
  for (const id of ids) {
    const a = agent(id);
    a.state.locationId = placeId;
    a.state.activityKind = "idle";
    ctx.rt(id).travelling = false;
    ctx.rt(id).pending = [];
  }
}

beforeEach(() => {
  for (const id of ctx.agents.keys()) at(id === "leo" ? "escuela" : "casa_roja", id);
});

describe("inventario", () => {
  it("el libro de poemas de Carmen lo tiene Lucía, prestado (y lo ve en su prompt)", () => {
    const book = itemNamed("el libro de poemas");
    expect(book).toMatchObject({ ownerId: "carmen", holderId: "lucia" });
    expect(book.loan).toMatchObject({ from: "carmen", to: "lucia" });
    const lucia = inventorySections(ctx, agent("lucia")).find((s) => s.title === "LLEVAS")!;
    expect(lucia.lines[0]).toMatch(/libro de poemas \(de Carmen; te lo prestó/);
    const carmen = inventorySections(ctx, agent("carmen")).find((s) => s.title === "HAS PRESTADO")!;
    expect(carmen.lines[0]).toMatch(/lo tiene Lucía/);
  });

  it("si vence el plazo, Carmen lo nota una vez (y le sienta mal)", async () => {
    const book = itemNamed("el libro de poemas");
    const before = (await ctx.deps.social.get("carmen", "lucia"))?.affinity ?? 0;
    const events: string[] = [];
    const off = app.defaultWorld.sim.onEvent((e) => events.push(e.text));
    await itemsTick(ctx, book.loan!.dueAt + 1);
    await itemsTick(ctx, book.loan!.dueAt + 2);
    off();
    expect(events.filter((e) => e.startsWith("📕"))).toHaveLength(1);
    expect(lastText("carmen")).toMatch(/todavía no me ha devuelto el libro de poemas/);
    expect((await ctx.deps.social.get("carmen", "lucia"))!.affinity).toBeLessThan(before);
  });

  it("devolver: solo con la dueña delante; cumple la intención de Lucía", async () => {
    const book = itemNamed("el libro de poemas");
    at("cafe_ola", "lucia");
    expect(await act("lucia", { type: "return_item", itemId: book.id })).toBe(false);
    expect(lastText("lucia")).toMatch(/Carmen .* no está aquí/);
    at("cafe_ola", "carmen");
    expect(await act("lucia", { type: "return_item", itemId: book.id })).toBe(true);
    expect(book).toMatchObject({ holderId: "carmen", loan: null });
    expect(agent("lucia").mind.intentions.find((i) => /libro de poemas/.test(i.text))?.status).toBe(
      "done",
    );
    expect(lastText("carmen")).toMatch(/me ha devuelto el libro de poemas/);
    expect((await app.defaultWorld.items.listFor("carmen")).map((i) => i.id)).toContain(book.id);
  });

  it("prestar: quien lo recibe se propone devolverlo", async () => {
    const camera = itemNamed("la cámara de fotos");
    at("plaza", "valentina", "lucia");
    expect(
      await act("valentina", { type: "lend_item", itemId: camera.id, to: "lucia", days: 2 }),
    ).toBe(true);
    expect(camera).toMatchObject({ holderId: "lucia", loan: { from: "valentina", to: "lucia" } });
    expect(
      agent("lucia").mind.intentions.some(
        (i) => i.status === "pending" && i.personId === "valentina" && /cámara/.test(i.text),
      ),
    ).toBe(true);
    // Lo prestado no se presta ni se regala.
    at("plaza", "mateo");
    expect(await act("lucia", { type: "give_item", itemId: camera.id, to: "mateo" })).toBe(false);
    expect(lastText("lucia")).toMatch(/no es mío/);
  });

  it("un adulto y un menor: solo en un sitio público", async () => {
    const guitar = itemNamed("la guitarra");
    at("casa_rio", "hugo", "leo");
    expect(await act("hugo", { type: "lend_item", itemId: guitar.id, to: "leo", days: 1 })).toBe(
      false,
    );
    expect(lastText("hugo")).toMatch(/solo se puede quedar en un sitio público/);
    at("plaza", "hugo", "leo");
    expect(await act("hugo", { type: "lend_item", itemId: guitar.id, to: "leo", days: 1 })).toBe(
      true,
    );
  });

  it("dejar y coger: lo de otro no se coge", async () => {
    const umbrella = itemNamed("el paraguas negro");
    at("cafe_ola", "samuel", "mateo");
    expect(await act("samuel", { type: "leave_item", itemId: umbrella.id })).toBe(true);
    expect(umbrella).toMatchObject({ holderId: null, placeId: "cafe_ola" });
    const here = inventorySections(ctx, agent("mateo")).find((s) => s.title === "AQUÍ HAY")!;
    expect(here.lines).toContain(`${umbrella.id} el paraguas negro (de Samuel)`);
    expect(await act("mateo", { type: "take_item", itemId: umbrella.id })).toBe(false);
    expect(await act("samuel", { type: "take_item", itemId: umbrella.id })).toBe(true);
    expect(umbrella.holderId).toBe("samuel");
  });
});

describe("objetos con estados", () => {
  it("la cafetera: en uso un rato y vuelve sola; no se puede usar mientras", async () => {
    at("cafe_ola", "mateo", "lucia");
    expect(
      await act("mateo", { type: "use_object", objectId: "cafetera", verb: "preparar_cafe" }),
    ).toBe(true);
    expect(ctx.world.spot("cafetera")!.state).toBe("en uso");
    expect(
      await act("lucia", { type: "use_object", objectId: "cafetera", verb: "preparar_cafe" }),
    ).toBe(false);
    objectsTick(ctx, NOW + 10);
    expect(ctx.world.spot("cafetera")!.state).toBe("idle");
  });

  it("lo roto se puede intentar arreglar (no siempre a la primera)", async () => {
    at("panaderia", "julian");
    ctx.world.setSpotState("horno", "roto");
    const sections = inventorySections(ctx, agent("julian"));
    expect(sections.find((s) => s.title === "PUEDES USAR")!.lines).toContain(
      "horno: arreglar (intentar arreglarlo)",
    );
    for (let i = 0; i < 20 && ctx.world.spot("horno")!.state !== "idle"; i++) {
      expect(await act("julian", { type: "use_object", objectId: "horno", verb: "arreglar" })).toBe(
        true,
      );
    }
    expect(ctx.world.spot("horno")!.state).toBe("idle");
  });
});
