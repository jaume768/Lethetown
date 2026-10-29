import { readFileSync } from "node:fs";
import { AgentSeed, parseTiledMap } from "@lethetown/shared";
import { describe, expect, it } from "vitest";
import { Agent } from "../agent/agent";
import { agentMockResponder } from "../agent/mock-responder";
import { LLMClient } from "../llm/client";
import { CostTracker } from "../llm/cost-tracker";
import { MockProvider } from "../llm/mock";
import { ModelRouter } from "../llm/router";
import { MemoryConfig } from "../memory/config";
import { HashEmbedder } from "../memory/hash-embedder";
import { InMemorySocialProfileStore, updateSocialAfterConversation } from "../memory/human";
import { InMemoryStore } from "../memory/in-memory-store";
import { MemorySystem } from "../memory/memory-system";
import { cuePresent, recallChance } from "../memory/prospective";
import { NEUTRAL_PROFILE } from "../memory/psychology";

const cfg = MemoryConfig.parse({}).prospective;
const world = parseTiledMap(
  JSON.parse(readFileSync(new URL("../../../../seeds/town.tmj", import.meta.url), "utf8")),
);
const seeds = AgentSeed.array().parse(
  JSON.parse(readFileSync(new URL("../../../../seeds/agents.json", import.meta.url), "utf8")),
);
const names = Object.fromEntries(seeds.map((s) => [s.id, s.name]));

function setup(rolls: number[] = [], intentionForgetting = 1) {
  let i = 0;
  const provider = new MockProvider(agentMockResponder);
  const llm = new LLMClient(
    provider,
    new ModelRouter({ fast: "mock-fast", reflection: "mock-reflection" }),
    new CostTracker({}),
  );
  const store = new InMemoryStore();
  const memory = new MemorySystem({
    store,
    embedder: new HashEmbedder(),
    rng: () => rolls[i++] ?? 0.99,
    profiles: { lucia: { ...NEUTRAL_PROFILE, intentionForgetting } },
  });
  const effects: { kind: string; outcome?: string }[] = [];
  memory.onEffect((e) => effects.push({ kind: e.kind, outcome: e.outcome }));
  const seed = seeds.find((s) => s.id === "lucia")!;
  const agent = new Agent(seed, { llm, memory, places: world.places, names });
  return { provider, llm, store, memory, agent, effects };
}

describe("memoria prospectiva (puro)", () => {
  it("la pista: la persona, el lugar o la hora", () => {
    const base = { personId: null, placeId: null, atMinute: null };
    const ctx = { placeId: "plaza", present: ["carmen"], minuteOfDay: 600 };
    expect(cuePresent({ ...base, personId: "carmen" }, ctx, 60)).toBe(true);
    expect(cuePresent({ ...base, personId: "mateo" }, ctx, 60)).toBe(false);
    expect(cuePresent({ ...base, placeId: "plaza" }, ctx, 60)).toBe(true);
    expect(cuePresent({ ...base, atMinute: 570 }, ctx, 60)).toBe(true);
    expect(cuePresent({ ...base, atMinute: 500 }, ctx, 60)).toBe(false);
  });

  it("se acuerda más quien es responsable y con el recuerdo nítido", () => {
    expect(recallChance(1, 1, cfg)).toBeCloseTo(0.7);
    expect(recallChance(0.5, 1, cfg)).toBe(1);
    expect(recallChance(1.5, 1, cfg)).toBeLessThan(0.5);
    expect(recallChance(1, 0, cfg)).toBeCloseTo(0.35);
  });

  it("las intenciones de las semillas nombran personas y lugares del pueblo", () => {
    const placeIds = new Set(world.places.map((p) => p.id));
    for (const s of seeds) {
      for (const i of s.initialIntentions) {
        if (i.personId) expect(names[i.personId], `${s.id}: ${i.personId}`).toBeDefined();
        if (i.placeId) expect(placeIds.has(i.placeId), `${s.id}: ${i.placeId}`).toBe(true);
      }
    }
    expect(seeds.filter((s) => s.initialIntentions.length).length).toBeGreaterThanOrEqual(8);
  });
});

describe("intenciones en el agente", () => {
  it("se siembran (el libro de Lucía) como recuerdo de tipo intention", async () => {
    const { agent, store } = setup();
    await agent.seedMemories(0);
    const intention = (await store.listByAgent("lucia")).find((m) => m.type === "intention");
    expect(intention?.text).toBe("Quiero devolverle a Carmen su libro de poemas");
    expect(intention?.meta.intention).toMatchObject({ status: "pending", personId: "carmen" });
    expect(agent.mind.intentions).toHaveLength(1);
  });

  it("al ver a Carmen se acuerda (y lo hace) y queda como cumplida", async () => {
    const { agent, store, effects } = setup([0]);
    await agent.seedMemories(0);
    agent.state.locationId = "plaza";
    await agent.checkIntentions(50, 10, []);
    const [o] = await agent.checkIntentions(60, 10, ["carmen"]);
    expect(o).toMatchObject({ kind: "kept" });
    expect(o!.reminder).toMatch(/Te acuerdas de que querías devolverle.*\(ahí está Carmen Vidal\)/);
    expect(agent.mind.intentions).toEqual([]);
    const m = (await store.listByAgent("lucia")).find((x) => x.type === "intention")!;
    expect(m.meta.intention?.status).toBe("done");
    expect((await store.audit("lucia"))[0]).toMatchObject({ action: "intention_kept" });
    expect(effects).toContainEqual({ kind: "intention", outcome: "kept" });
  });

  it("solo cuenta cuando aparece la pista (no al nacer), y si se le pasa dos veces se le olvida", async () => {
    const { agent, store, effects } = setup([0.99, 0.99]);
    await agent.seedMemories(0);
    agent.state.locationId = "plaza";
    await agent.checkIntentions(50, 10, []);
    expect(await agent.checkIntentions(60, 10, ["carmen"])).toEqual([]); // fallo 1
    expect(await agent.checkIntentions(70, 10, ["carmen"])).toEqual([]); // sigue ahí: no cuenta
    await agent.checkIntentions(80, 10, []); // Carmen se va
    const [o] = await agent.checkIntentions(90, 10, ["carmen"]); // fallo 2
    expect(o).toMatchObject({ kind: "missed" });
    expect(agent.mind.intentions[0]!.status).toBe("forgotten");
    expect((await store.audit("lucia"))[0]).toMatchObject({ action: "intention_forgotten" });
    expect(effects).toContainEqual({ kind: "intention", outcome: "forgotten" });
  });

  it("más tarde puede caer en la cuenta: «¡vaya, se me olvidó!» y vuelve a tenerlo pendiente", async () => {
    const { agent, store } = setup([0.99, 0.99, 0]);
    await agent.seedMemories(0);
    await agent.checkIntentions(50, 10, []);
    await agent.checkIntentions(60, 10, ["carmen"]);
    await agent.checkIntentions(70, 10, []);
    await agent.checkIntentions(80, 10, ["carmen"]);
    const [o] = await agent.checkIntentions(90, 60, []);
    expect(o).toMatchObject({ kind: "late" });
    expect(agent.mind.intentions[0]).toMatchObject({ status: "pending", misses: 0 });
    const oops = (await store.listByAgent("lucia")).find((m) => m.text.startsWith("¡Vaya"));
    expect(oops?.emotionalValence).toBeLessThan(0);
  });

  it("caduca a los días", async () => {
    const { agent, store } = setup();
    await agent.seedMemories(0);
    const [o] = await agent.checkIntentions(8 * 24 * 60, 10, []);
    expect(o).toMatchObject({ kind: "expired" });
    expect((await store.audit("lucia"))[0]).toMatchObject({ action: "intention_expired" });
  });

  it("detecta intenciones en las conversaciones y en la voz interior (mock)", async () => {
    const { agent, llm, provider } = setup();
    await updateSocialAfterConversation(llm, new InMemorySocialProfileStore(), {
      owner: agent.owner,
      other: { id: "mateo", name: "Mateo Ruiz" },
      transcript: ['Mateo Ruiz: "¡Sí! Me encantó. Deberíamos venir juntos."'],
      now: 0,
      onIntentions: async (list) => {
        for (const i of list) await agent.intend(0, i);
      },
    });
    expect(agent.mind.intentions.map((i) => [i.text, i.personId])).toEqual([
      ["volver a quedar con Mateo", "mateo"],
    ]);
    agent.state.activityKind = "idle";
    await agent.decide(60, {
      present: [],
      heard: [],
      conversationWith: null,
      objectStates: [],
      weather: "sunny",
      socialNotes: [],
      innerVoice: ["Debería ir a ver a Pilar al huerto."],
      salient: true,
    });
    expect(provider.calls.at(-1)!.meta.task).toBe("decide");
    expect(agent.mind.intentions.map((i) => i.text)).toContain("ir a ver a Pilar al huerto");
  });
});
