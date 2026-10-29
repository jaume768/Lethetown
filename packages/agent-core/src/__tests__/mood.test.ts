import { readFileSync } from "node:fs";
import { AgentSeed, BigFive, parseTiledMap } from "@lethetown/shared";
import { describe, expect, it } from "vitest";
import { Agent } from "../agent/agent";
import { agentMockResponder } from "../agent/mock-responder";
import {
  baselineMood,
  blendPerceptions,
  circumplexLabel,
  describeMood,
  makeMood,
  stepMood,
  stepNeeds,
} from "../agent/mood";
import { LLMClient } from "../llm/client";
import { CostTracker } from "../llm/cost-tracker";
import { MockProvider } from "../llm/mock";
import { ModelRouter } from "../llm/router";
import { MemoryConfig } from "../memory/config";
import { HashEmbedder } from "../memory/hash-embedder";
import { InMemoryStore } from "../memory/in-memory-store";
import { MemorySystem } from "../memory/memory-system";

const cfg = MemoryConfig.parse({});
const avg = BigFive.parse({});
const needs = { energy: 0.8, hunger: 0.3, social: 0.6 };

describe("ánimo circumplejo", () => {
  it("etiquetas por cuadrante", () => {
    expect(circumplexLabel(0.7, 0.8)).toBe("eufórico");
    expect(circumplexLabel(0.3, 0.5)).toBe("contento");
    expect(circumplexLabel(0.5, 0.2)).toBe("relajado");
    expect(circumplexLabel(-0.6, 0.8)).toBe("irritable");
    expect(circumplexLabel(-0.3, 0.7)).toBe("nervioso");
    expect(circumplexLabel(-0.6, 0.5)).toBe("triste");
    expect(circumplexLabel(-0.3, 0.1)).toBe("apagado");
    expect(circumplexLabel(0, 0.5)).toBe("neutral");
    expect(describeMood(makeMood(0.3, 0.5))).toBe("contento (activación media)");
  });

  it("nivel base según la personalidad", () => {
    const anxious = baselineMood({ ...avg, neuroticism: 0.9 }, cfg.mood);
    const calm = baselineMood({ ...avg, neuroticism: 0.1 }, cfg.mood);
    const extravert = baselineMood({ ...avg, extraversion: 0.9 }, cfg.mood);
    expect(anxious.valence).toBeLessThan(calm.valence);
    expect(extravert.arousal).toBeGreaterThan(baselineMood(avg, cfg.mood).arousal);
  });

  it("vuelve a su nivel base con la vida media configurada", () => {
    const baseline = { valence: 0.1, arousal: 0.4 };
    const after = stepMood(
      makeMood(-0.9, 0.4),
      { needs, sleeping: false, baseline, extraversion: 0.5 },
      cfg.mood.halfLifeMinutes,
      cfg.mood,
    );
    expect(after.valence).toBeCloseTo(-0.4);
    // Durmiendo vuelve antes y la activación baja.
    const slept = stepMood(
      makeMood(-0.9, 0.8),
      { needs, sleeping: true, baseline, extraversion: 0.5 },
      cfg.mood.halfLifeMinutes,
      cfg.mood,
    );
    expect(slept.valence).toBeGreaterThan(after.valence);
    expect(slept.arousal).toBeLessThan(0.5);
  });

  it("hambre → irritable; cansancio → apagado; soledad → triste (más en extravertidos)", () => {
    const baseline = { valence: 0.1, arousal: 0.4 };
    const run = (n: typeof needs, extraversion = 0.5) => {
      let mood = makeMood(0.1, 0.4);
      for (let i = 0; i < 18; i++) {
        mood = stepMood(mood, { needs: n, sleeping: false, baseline, extraversion }, 10, cfg.mood);
      }
      return mood;
    };
    const hungry = run({ ...needs, hunger: 1 });
    expect(hungry.valence).toBeLessThan(0);
    expect(hungry.arousal).toBeGreaterThan(0.4);
    const tired = run({ ...needs, energy: 0 });
    expect(tired.valence).toBeLessThan(0.1);
    expect(tired.arousal).toBeLessThan(0.4);
    const lonelyExtravert = run({ ...needs, social: 0 }, 0.9);
    const lonelyIntrovert = run({ ...needs, social: 0 }, 0.1);
    expect(lonelyExtravert.valence).toBeLessThan(lonelyIntrovert.valence);
  });

  it("lo percibido mueve la valencia y la activación", () => {
    const m = blendPerceptions(makeMood(0, 0.3), [{ importance: 9, valence: -0.8 }], 0.5);
    expect(m.valence).toBeCloseTo(-0.4);
    expect(m.arousal).toBeGreaterThan(0.6);
  });
});

describe("necesidades según la personalidad", () => {
  it("en la media, los ritmos de siempre", () => {
    const n = stepNeeds(needs, { kind: "work", alone: false, extraversion: 0.5 }, 60, cfg.needs);
    expect(n.energy).toBeCloseTo(0.75);
    expect(n.hunger).toBeCloseTo(0.37);
    expect(n.social).toBeCloseTo(0.56);
  });

  it("la social baja antes en los extravertidos", () => {
    const e = stepNeeds(needs, { kind: "work", alone: false, extraversion: 1 }, 60, cfg.needs);
    const i = stepNeeds(needs, { kind: "work", alone: false, extraversion: 0 }, 60, cfg.needs);
    expect(e.social).toBeLessThan(i.social);
  });

  it("un introvertido solo y tranquilo recupera energía y social", () => {
    const alone = stepNeeds(needs, { kind: "read", alone: true, extraversion: 0.1 }, 60, cfg.needs);
    const busy = stepNeeds(needs, { kind: "read", alone: false, extraversion: 0.1 }, 60, cfg.needs);
    expect(alone.energy).toBeGreaterThan(busy.energy);
    expect(alone.social).toBeGreaterThan(busy.social);
    const extravert = stepNeeds(
      needs,
      { kind: "read", alone: true, extraversion: 0.9 },
      60,
      cfg.needs,
    );
    expect(extravert.energy).toBeCloseTo(0.75);
  });
});

describe("el ánimo en el agente", () => {
  const places = parseTiledMap(
    JSON.parse(readFileSync(new URL("../../../../seeds/town.tmj", import.meta.url), "utf8")),
  ).places;
  const make = (personality: Partial<BigFive>) => {
    const provider = new MockProvider(agentMockResponder);
    const llm = new LLMClient(
      provider,
      new ModelRouter({ fast: "mock-fast", reflection: "mock-reflection" }),
      new CostTracker({}),
    );
    const memory = new MemorySystem({ store: new InMemoryStore(), embedder: new HashEmbedder() });
    const seed = AgentSeed.parse({
      id: "x",
      name: "X",
      age: 40,
      traits: [],
      description: "",
      homeId: "casa_azul",
      personality,
    });
    return { provider, agent: new Agent(seed, { llm, memory, places }) };
  };

  it("empieza en su nivel base y el prompt lleva la etiqueta y la activación", async () => {
    const gloomy = make({ neuroticism: 0.95, extraversion: 0.1 });
    const cheerful = make({ neuroticism: 0.1, extraversion: 0.9 });
    expect(gloomy.agent.state.mood.valence).toBeLessThan(cheerful.agent.state.mood.valence);
    cheerful.agent.state.activityKind = "work";
    await cheerful.agent.decide(9 * 60, {
      present: [],
      heard: [],
      conversationWith: null,
      objectStates: [],
      weather: "sunny",
      socialNotes: [],
      salient: true,
    });
    expect(cheerful.provider.calls.at(-1)!.prompt).toMatch(
      /Ánimo: \S+ \(activación (baja|media|alta)\)/,
    );
  });

  it("live() actualiza necesidades y ánimo", () => {
    const { agent } = make({});
    agent.state.activityKind = "work";
    agent.state.needs = { energy: 0.8, hunger: 0.95, social: 0.6 };
    for (let i = 0; i < 12; i++) agent.live(10, false);
    expect(agent.state.needs.hunger).toBeCloseTo(1);
    expect(agent.state.mood.valence).toBeLessThan(0);
  });
});
