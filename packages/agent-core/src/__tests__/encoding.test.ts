import { readFileSync } from "node:fs";
import { AgentSeed, parseTiledMap } from "@lethetown/shared";
import { describe, expect, it } from "vitest";
import { Agent } from "../agent/agent";
import { agentMockResponder } from "../agent/mock-responder";
import { makeMood, stepNeeds } from "../agent/mood";
import { LLMClient } from "../llm/client";
import { CostTracker } from "../llm/cost-tracker";
import { MockProvider, type MockResponder } from "../llm/mock";
import { ModelRouter } from "../llm/router";
import { MemoryConfig } from "../memory/config";
import {
  encodingStrength,
  overwhelmed,
  reduceDetails,
  sleepDebt,
  sleepQuality,
  yerkesDodson,
} from "../memory/encoding";
import { HashEmbedder } from "../memory/hash-embedder";
import { LLMConsolidator, InMemorySocialProfileStore } from "../memory/human";
import { InMemoryStore } from "../memory/in-memory-store";
import { MemorySystem } from "../memory/memory-system";
import { recallText, scoreMemory } from "../memory/retrieval";

const cfg = MemoryConfig.parse({});
const calm = { arousal: 0.55, energy: 0.8, walking: false, distracted: false, sleepDebt: 0 };

describe("codificación (Yerkes-Dodson)", () => {
  it("se graba mejor con activación moderada que con poca o demasiada", () => {
    expect(yerkesDodson(0.55, cfg.encoding)).toBeCloseTo(1);
    expect(yerkesDodson(0.05, cfg.encoding)).toBeLessThan(0.85);
    expect(yerkesDodson(1, cfg.encoding)).toBeLessThan(0.85);
    expect(yerkesDodson(0, cfg.encoding)).toBeGreaterThanOrEqual(cfg.encoding.minArousalFactor);
  });

  it("cansado, de camino, distraído o sin dormir se graba peor", () => {
    const full = encodingStrength(calm, cfg.encoding);
    expect(full).toBeCloseTo(1);
    expect(encodingStrength({ ...calm, energy: 0 }, cfg.encoding)).toBeCloseTo(0.6);
    expect(encodingStrength({ ...calm, walking: true }, cfg.encoding)).toBeCloseTo(0.75);
    expect(encodingStrength({ ...calm, distracted: true }, cfg.encoding)).toBeCloseTo(0.7);
    expect(encodingStrength({ ...calm, sleepDebt: 1 }, cfg.encoding)).toBeCloseTo(0.6);
    const worst = { arousal: 1, energy: 0, walking: true, distracted: true, sleepDebt: 1 };
    expect(encodingStrength(worst, cfg.encoding)).toBe(cfg.encoding.minStrength);
  });

  it("con activación extrema solo queda la esencia", () => {
    expect(overwhelmed(0.95, cfg.encoding)).toBe(true);
    expect(overwhelmed(0.6, cfg.encoding)).toBe(false);
    expect(reduceDetails('Oí a Rafael decir "cierro la taberna el 3"')).toBe(
      "Oí a Rafael decir algo",
    );
  });
});

describe("sueño", () => {
  it("la tensión y la preocupación (más con neuroticismo) empeoran el sueño", () => {
    expect(sleepQuality(makeMood(0.3, 0.4), 0.5, cfg.sleep)).toBe(1);
    const worried = sleepQuality(makeMood(-0.6, 0.8), 0.9, cfg.sleep);
    const lessNeurotic = sleepQuality(makeMood(-0.6, 0.8), 0.1, cfg.sleep);
    expect(worried).toBeLessThan(lessNeurotic);
    expect(worried).toBeGreaterThanOrEqual(cfg.sleep.minQuality);
  });

  it("la calidad es el techo de la energía que se recupera durmiendo", () => {
    let n = { energy: 0.2, hunger: 0.3, social: 0.5 };
    for (let i = 0; i < 54; i++) {
      n = stepNeeds(
        n,
        { kind: "sleep", alone: true, extraversion: 0.5, sleepQuality: 0.6 },
        10,
        cfg.needs,
      );
    }
    expect(n.energy).toBeCloseTo(0.6);
    expect(sleepDebt(n.energy, cfg.sleep)).toBeCloseTo(1 - 0.6 / 0.85);
    expect(sleepDebt(0.9, cfg.sleep)).toBe(0);
  });
});

const places = parseTiledMap(
  JSON.parse(readFileSync(new URL("../../../../seeds/town.tmj", import.meta.url), "utf8")),
).places;

function setup(overrides: Record<string, MockResponder> = {}) {
  const provider = new MockProvider(
    (req) => overrides[req.meta.task]?.(req) ?? agentMockResponder(req),
  );
  const llm = new LLMClient(
    provider,
    new ModelRouter({ fast: "mock-fast", reflection: "mock-reflection" }),
    new CostTracker({}),
  );
  const store = new InMemoryStore();
  const memory = new MemorySystem({ store, embedder: new HashEmbedder() });
  const seed = AgentSeed.parse({
    id: "sofia",
    name: "Sofía",
    age: 31,
    traits: [],
    description: "",
    homeId: "casa_azul",
    personality: { neuroticism: 0.8 },
  });
  return { llm, store, memory, agent: new Agent(seed, { llm, memory, places }) };
}

const speech = {
  kind: "speech" as const,
  fromId: "leo",
  fromName: "Leo",
  text: "hola",
  placeId: "plaza",
};

describe("codificación en el agente", () => {
  it("lo que oye de camino se graba con menos fuerza", async () => {
    const a = setup();
    a.agent.state.activityKind = "idle";
    a.agent.state.mood = makeMood(0.2, 0.55);
    await a.agent.perceive([speech], 0);
    const b = setup();
    b.agent.state.activityKind = "walk";
    b.agent.state.mood = makeMood(0.2, 0.55);
    await b.agent.perceive([speech], 0);
    const [ma] = await a.store.listByAgent("sofia");
    const [mb] = await b.store.listByAgent("sofia");
    expect(mb!.strength).toBeLessThan(ma!.strength);
  });

  it("algo vivido con activación extrema se guarda solo como esencia", async () => {
    const { agent, store } = setup({
      importance: () => JSON.stringify({ ratings: [{ importance: 10, valence: -1 }] }),
    });
    await agent.perceive([{ ...speech, text: "¡Se ha quemado la panadería a las 3!" }], 0);
    const [m] = await store.listByAgent("sofia");
    expect(m!.meta.gistOnly).toBe(true);
    expect(m!.text).toContain("panadería a las 3");
    const seen = recallText(scoreMemory(m!, { embedding: [], now: 0, moodValence: 0 }));
    expect(seen).toBe("Leo me dijo: algo");
  });

  it("dormir mal: deuda de sueño, peor ánimo y peor memoria al día siguiente", async () => {
    const { agent, store } = setup();
    agent.state.mood = makeMood(-0.7, 0.9);
    const quality = agent.fallAsleep();
    expect(quality).toBeLessThan(0.7);
    agent.state.activityKind = "sleep";
    agent.state.needs.energy = 0.2;
    for (let i = 0; i < 54; i++) agent.live(10, true);
    const before = agent.state.mood.valence;
    const debt = agent.wakeUp();
    expect(debt).toBeGreaterThan(0.1);
    expect(agent.state.mood.valence).toBeLessThan(before);
    expect(agent.moodBaseline.valence).toBeLessThan(setup().agent.moodBaseline.valence);
    agent.state.activityKind = "idle";
    agent.state.mood = makeMood(0.2, 0.55);
    agent.state.needs.energy = 0.8;
    await agent.perceive([speech], 0);
    const [m] = await store.listByAgent("sofia");
    expect(m!.strength).toBeLessThan(0.95);
  });
});

describe("el sueño consolida lo emocional", () => {
  it("refuerza lo emocional aunque no se cite y no lo debilita aunque sea trivial", async () => {
    const { llm, memory, store } = setup({
      consolidate: () => JSON.stringify({ insights: [], facts: [], people: [] }),
    });
    const emotional = await memory.remember(
      {
        agentId: "sofia",
        text: "Leo lloró en clase",
        type: "observation",
        importance: 2,
        emotionalValence: -0.8,
        strength: 0.5,
      },
      0,
    );
    const trivial = await memory.remember(
      { agentId: "sofia", text: "Vi una paloma", type: "observation", importance: 2 },
      0,
    );
    const consolidator = new LLMConsolidator(
      llm,
      memory,
      new InMemorySocialProfileStore(),
      () => [],
    );
    const r = await consolidator.consolidate(
      { agentId: "sofia", agentName: "Sofía", system: "x" },
      0,
      60,
    );
    expect(r.reinforced).toEqual([emotional.id]);
    expect(r.weakened).toEqual([trivial.id]);
    const after = await store.get(emotional.id);
    expect(after!.strength).toBeCloseTo(0.5 * 1.4);
    expect(after!.stability).toBeCloseTo(emotional.stability * 1.4);
  });
});
