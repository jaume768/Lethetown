/** Sistema `lore`: saberes de partida, contarlos, deformarse, usarlos, olvidarlos y perderlos. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootstrap, type App } from "../../bootstrap";
import { buildApi, type Api } from "../../api/server";
import { loadConfig } from "../../config";
import { localContext } from "../../worlds/local";
import { runAction } from "../actions";
import { applyAgreements } from "../agreements";
import type { SimContext } from "../context";
import { heldBy, holderOf, loreState, loreTick } from "../lore";
import { restoreSystems, snapshotSystems } from ".";

let app: App;
let ctx: SimContext;
const agent = (id: string) => ctx.agents.get(id)!;
const now = () => ctx.clock.now();
const byTitle = (t: string) => [...loreState(ctx).lore.values()].find((l) => l.title === t)!;

beforeAll(async () => {
  app = await bootstrap(
    loadConfig({ LLM_PROVIDER: "mock", EMBEDDINGS: "hash", DATABASE_URL: "", SIM_SEED: "7" }),
    () => {},
  );
  ctx = (app.defaultWorld.sim as unknown as { ctx: SimContext }).ctx;
});
afterAll(() => app.close());

function at(id: string, placeId: string) {
  const a = agent(id);
  a.state.locationId = placeId;
  a.state.activityKind = "idle";
  ctx.rt(id).travelling = false;
}

describe("saberes de partida", () => {
  it("cada vecino sabe 1–3 cosas de su vida, y se guardan", async () => {
    for (const a of ctx.agents.values()) {
      const n = heldBy(ctx, a.id).length;
      expect(n, a.id).toBeGreaterThanOrEqual(1);
      expect(n, a.id).toBeLessThanOrEqual(3);
    }
    expect((await app.defaultWorld.lore.lore()).length).toBe(loreState(ctx).lore.size);
  });

  it("su origen es un vecino o alguien de fuera que existe (sin personas inventadas)", () => {
    const magdalenas = byTitle("Las magdalenas de Francisca");
    expect(magdalenas.origin).toEqual({ agentId: null, person: "Francisca" });
    expect(byTitle("El compost del huerto").origin).toEqual({ agentId: "pilar", person: null });
    expect(byTitle("El sitio de pesca de Tomás").origin).toEqual({
      agentId: "tomas",
      person: null,
    });
    for (const l of loreState(ctx).lore.values()) {
      if (l.origin.agentId) expect(ctx.agents.has(l.origin.agentId), l.title).toBe(true);
      if (l.origin.person) {
        const known = [...ctx.agents.values()].some((a) =>
          a.seed.offstagePeople.some((p) => p.name === l.origin.person),
        );
        expect(known, l.title).toBe(true);
      }
    }
  });
});

describe("contarlo", () => {
  it("Julián le cuenta la receta a Inés: se queda con su versión y la recuerda", async () => {
    at("julian", "panaderia");
    at("ines", "panaderia");
    const l = byTitle("Las magdalenas de Francisca");
    expect(
      await runAction(
        { ctx, agent: agent("julian"), now: now() },
        { type: "share_lore", who: "ines", loreId: l.id },
      ),
    ).toBe(true);
    const h = holderOf(ctx, l.id, "ines")!;
    expect(h.learnedFrom).toBe("julian");
    expect(h.elements.length).toBeGreaterThanOrEqual(3);
    expect(h.fidelity).toBeLessThanOrEqual(holderOf(ctx, l.id, "julian")!.fidelity);
    await new Promise((r) => setTimeout(r, 30));
    const mem = await ctx.deps.memory.store.listByAgent("ines");
    expect(
      mem.some((m) => m.text.startsWith("Julián Ortega me contó Las magdalenas de Francisca:")),
    ).toBe(true);
    const audit = await ctx.deps.memory.store.audit("ines", 50);
    expect(
      audit.some((a) => a.action === "lore" && a.reason.startsWith("lo aprendió de Julián")),
    ).toBe(true);
  });

  it("de boca en boca (Inés a Leo, Leo a Hugo…) se va deformando", async () => {
    const l = byTitle("Las magdalenas de Francisca");
    const chain = ["ines", "leo", "hugo", "lucia", "sofia", "andres"];
    for (let i = 0; i + 1 < chain.length; i++) {
      at(chain[i]!, "plaza");
      at(chain[i + 1]!, "plaza");
      await runAction(
        { ctx, agent: agent(chain[i]!), now: now() },
        { type: "share_lore", who: chain[i + 1]!, loreId: l.id },
      );
      if (!holderOf(ctx, l.id, chain[i + 1]!)) break;
    }
    const versions = chain.map((id) => holderOf(ctx, l.id, id)).filter((h) => h !== undefined);
    expect(versions.at(-1)!.fidelity).toBeLessThan(versions[0]!.fidelity);
  });

  it("acordado hablando: «Te cuento lo del sitio de pesca»", async () => {
    at("tomas", "lago");
    at("samuel", "lago");
    const l = byTitle("El sitio de pesca de Tomás");
    await applyAgreements(ctx, { id: "conv-l", people: ["tomas", "samuel"] }, "tomas", [
      {
        type: "share_lore",
        from: "tomas",
        to: ["samuel"],
        itemId: null,
        placeId: null,
        skill: null,
        loreId: l.id,
        at: null,
        day: "hoy",
        what: "",
        quote: "Te digo dónde pican.",
      },
    ]);
    expect(holderOf(ctx, l.id, "samuel")).toBeDefined();
  });
});

describe("usarlo, olvidarlo y perderlo", () => {
  it("sin usarlo se olvida; si nadie lo sabe ya, se pierde para el pueblo (evento)", () => {
    const l = byTitle("La libreta del fiado");
    const h = holderOf(ctx, l.id, "marta")!;
    agent("marta").state.locationId = "casa_roja";
    loreTick(ctx, now());
    h.lastUsedAt = now();
    const events: string[] = [];
    const off = ctx.onEvent((e) => events.push(e.text));
    // Cuatro meses sin abrir la libreta.
    loreTick(ctx, now() + 120 * 1440);
    off();
    expect(h.forgottenAt).not.toBeNull();
    expect(byTitle("La libreta del fiado").lostAt).not.toBeNull();
    expect(events.some((t) => t.startsWith("🕸 Marta Gil ya no recuerda cómo era"))).toBe(true);
    expect(
      events.some((t) => t.startsWith("🕯 Se ha perdido para el pueblo: «La libreta del fiado»")),
    ).toBe(true);
  });

  it("estar en su sitio lo refuerza (el sitio de pesca, en el lago)", () => {
    const l = byTitle("El sitio de pesca de Tomás");
    const h = holderOf(ctx, l.id, "tomas")!;
    h.fidelity = 0.6;
    h.lastUsedAt = now() - 120;
    at("tomas", "lago");
    loreTick(ctx, now());
    expect(h.fidelity).toBeGreaterThan(0.6);
  });
});

describe("vista Rashomon y la instantánea", () => {
  it("/lore da cada saber con la versión de cada uno", async () => {
    const api: Api = await buildApi(localContext(app), app);
    const res = await api.server.inject({ method: "GET", url: "/api/lore" });
    api.ws.close();
    await api.server.close();
    const body = res.json() as {
      items: { lore: { title: string }; holders: { agentId: string }[] }[];
    };
    const m = body.items.find((x) => x.lore.title === "Las magdalenas de Francisca")!;
    expect(m.holders.map((h) => h.agentId)).toEqual(expect.arrayContaining(["julian", "ines"]));
  });

  it("la instantánea guarda saberes y versiones", () => {
    const snap = structuredClone(snapshotSystems(ctx));
    const n = loreState(ctx).holders.size;
    loreState(ctx).holders.clear();
    restoreSystems(ctx, snap);
    expect(loreState(ctx).holders.size).toBe(n);
  });
});
