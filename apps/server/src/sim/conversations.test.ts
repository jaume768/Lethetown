/** Conversaciones en grupo: unirse, oírlo todo, tamaño máximo, marcharse y cerrar. */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { bootstrap, type App } from "../bootstrap";
import { loadConfig } from "../config";
import { runAction } from "./actions";
import type { SimContext } from "./context";
import { activeConversationOf, leaveConversation, talk } from "./conversations";

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

const agent = (id: string) => ctx.agents.get(id)!;
const members = (id: string) => activeConversationOf(ctx, id)?.conv.members ?? [];

beforeEach(() => {
  ctx.conversations.clear();
  for (const id of ctx.agents.keys()) {
    const a = agent(id);
    a.state.locationId = id === "leo" ? "plaza" : "cafe_ola";
    a.state.activityKind = "idle";
    ctx.rt(id).travelling = false;
    ctx.rt(id).inbox = [];
    ctx.rt(id).pending = [];
  }
});

describe("conversaciones en grupo", () => {
  it("hablarle a alguien que ya está conversando es unirse; el grupo lo oye todo", () => {
    talk(ctx, agent("lucia"), "mateo", "¿Qué tal el día?");
    expect(members("lucia")).toEqual(["lucia", "mateo"]);
    const events: { kind: string; text: string; meta?: unknown; participants: string[] }[] = [];
    const off = app.defaultWorld.sim.onEvent((e) => events.push(e));
    talk(ctx, agent("carmen"), "mateo", "¡Hola a los dos!");
    off();
    expect(members("lucia")).toEqual(["lucia", "mateo", "carmen"]);
    expect(
      events.some((e) => /👥 Carmen .* se une a la conversación de Lucía y Mateo/.test(e.text)),
    ).toBe(true);
    // Lucía lo oye entero (no a escondidas) y sabe que iba para Mateo.
    expect(ctx.rt("lucia").inbox.at(-1)).toMatchObject({
      fromId: "carmen",
      text: "¡Hola a los dos!",
      toName: "Mateo Ruiz",
    });
    expect(ctx.rt("lucia").pending.some((p) => p.kind === "overheard")).toBe(false);
    const speech = events.find((e) => e.kind === "speech")!;
    expect(speech.meta).toMatchObject({ group: ["lucia"] });
    // Quien está en el café sin conversar sí puede oír a escondidas (no forma parte del grupo).
    expect(speech.participants.slice(0, 3)).toEqual(["carmen", "mateo", "lucia"]);
  });

  it("quien está en el grupo puede meter a otro", () => {
    talk(ctx, agent("lucia"), "mateo", "Hola");
    talk(ctx, agent("mateo"), "julian", "¡Julián, ven!");
    expect(members("julian")).toEqual(["lucia", "mateo", "julian"]);
  });

  it("como mucho maxMembers: el sexto no puede unirse (say lo rechaza)", async () => {
    const max = ctx.deps.memory.config.conversation.maxMembers;
    const ids = ["lucia", "mateo", "carmen", "julian", "ines", "elena"];
    talk(ctx, agent(ids[0]!), ids[1]!, "Hola");
    for (const id of ids.slice(2, max)) talk(ctx, agent(id), "lucia", "Hola");
    expect(members("lucia")).toHaveLength(max);
    const extra = ids[max]!;
    expect(
      await runAction(
        { ctx, agent: agent(extra), now: ctx.clock.now() },
        { type: "say", to: "lucia", text: "¿Puedo?" },
      ),
    ).toBe(false);
    expect(members(extra)).toEqual([]);
  });

  it("marcharse: el grupo sigue; con dos, la conversación se acaba", async () => {
    talk(ctx, agent("lucia"), "mateo", "Hola");
    talk(ctx, agent("carmen"), "lucia", "Hola, Lucía");
    await leaveConversation(ctx, "mateo", "tenía prisa");
    expect(members("lucia")).toEqual(["lucia", "carmen"]);
    expect(members("mateo")).toEqual([]);
    await leaveConversation(ctx, "carmen", "se hizo tarde");
    expect(ctx.conversations.size).toBe(0);
  });

  it("cambiarse de grupo: deja el suyo", () => {
    talk(ctx, agent("lucia"), "mateo", "Hola");
    talk(ctx, agent("carmen"), "julian", "Hola");
    talk(ctx, agent("carmen"), "lucia", "¡Lucía!");
    expect(members("carmen")).toEqual(["lucia", "mateo", "carmen"]);
    expect(members("julian")).toEqual([]);
  });
});
