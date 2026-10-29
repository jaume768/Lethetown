import { readFileSync } from "node:fs";
import { AgentSeed, parseTiledMap, type Place } from "@lethetown/shared";
import { describe, expect, it } from "vitest";
import { inferActivityKind } from "../agent/activity";
import { Agent, type DecideInput } from "../agent/agent";
import { agentMockResponder } from "../agent/mock-responder";
import { extractJson } from "../agent/parse";
import { LLMClient } from "../llm/client";
import { CostTracker } from "../llm/cost-tracker";
import { MockProvider } from "../llm/mock";
import { ModelRouter } from "../llm/router";
import { HashEmbedder } from "../memory/hash-embedder";
import { InMemoryStore } from "../memory/in-memory-store";
import { MemorySystem } from "../memory/memory-system";

const world = parseTiledMap(
  JSON.parse(readFileSync(new URL("../../../../seeds/town.tmj", import.meta.url), "utf8")),
);
const places: Place[] = world.places;
const seed = AgentSeed.parse({
  id: "lucia",
  name: "Lucía",
  age: 30,
  traits: ["curiosa"],
  description: "Lucía es ilustradora.",
  homeId: "casa_azul",
  initialMemories: ["Me encanta el pan de centeno."],
});

const EMPTY: Omit<DecideInput, "salient"> = {
  present: [],
  heard: [],
  conversationWith: null,
  objectStates: [],
  weather: "sunny",
  socialNotes: [],
};

function setup() {
  const provider = new MockProvider(agentMockResponder);
  const costs = new CostTracker({});
  const llm = new LLMClient(
    provider,
    new ModelRouter({ fast: "mock-fast", reflection: "mock-reflection" }),
    costs,
  );
  const memory = new MemorySystem({ store: new InMemoryStore(), embedder: new HashEmbedder() });
  return { provider, costs, memory, agent: new Agent(seed, { llm, memory, places }) };
}

describe("Agent con MockProvider", () => {
  it("el prompt de identidad es estable (cacheable) y lista los objetos", () => {
    const { agent } = setup();
    const before = agent.system;
    agent.state.action = "otra cosa";
    expect(agent.system).toBe(before);
    expect(before).not.toMatch(/\d{2}:\d{2}/);
    expect(before).toContain("barra[sit]");
  });

  it("empieza durmiendo en su cama", () => {
    const { agent } = setup();
    expect(agent.state).toMatchObject({
      spotId: "cama_azul",
      activityKind: "sleep",
      locationId: "casa_azul",
    });
  });

  it("planifica el día con el modelo de reflexión, lugares y spots válidos", async () => {
    const { agent, provider } = setup();
    const plan = await agent.planDay(6 * 60);
    expect(plan.length).toBeGreaterThan(3);
    expect(plan.every((p) => places.some((pl) => pl.id === p.placeId))).toBe(true);
    for (const p of plan.filter((x) => x.spotId)) {
      const place = places.find((pl) => pl.id === p.placeId);
      expect(place?.objects.some((o) => o.id === p.spotId)).toBe(true);
    }
    expect(plan[0]).toMatchObject({ activityKind: "cook", spotId: "cocina_azul" });
    expect(provider.calls.at(-1)?.model).toBe("mock-reflection");
    expect(agent.currentPlanItem(7 * 60 + 30)?.activity).toBe("preparar el desayuno");
  });

  it("sin nada saliente sigue el plan sin llamar al LLM", async () => {
    const { agent, provider } = setup();
    const n = provider.calls.length;
    const d = await agent.decide(8 * 60, { ...EMPTY, salient: false });
    expect(d.kind).toBe("follow_plan");
    expect(provider.calls.length).toBe(n);
  });

  it("percibe, guarda recuerdos con fuente y llena la memoria de trabajo", async () => {
    const { agent, memory } = setup();
    await agent.perceive(
      [
        {
          kind: "speech",
          fromId: "luis",
          fromName: "Luis",
          text: "¡Hola, Lucía!",
          placeId: "cafe_ola",
          eventId: "ev1",
        },
      ],
      8 * 60,
    );
    const all = await memory.store.listByAgent("lucia");
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ people: ["luis"], source: "contado por luis", eventId: "ev1" });
    expect(all[0]?.importance).toBeGreaterThanOrEqual(4);
    expect(agent.workingMemory.contents).toHaveLength(1);
  });

  it("si alguien le habla puede responder a esa persona", async () => {
    const { agent } = setup();
    const kinds = new Set<string>();
    for (let t = 0; t < 12; t++) {
      const d = await agent.decide(8 * 60 + t, {
        ...EMPTY,
        present: [{ id: "luis", name: "Luis", action: "tomando café" }],
        heard: [{ fromId: "luis", fromName: "Luis", text: "¿Qué tal?" }],
        conversationWith: "luis",
        salient: true,
      });
      kinds.add(d.kind);
      if (d.kind === "talk") expect(d.to).toBe("luis");
    }
    expect(kinds.has("talk")).toBe(true);
  });

  it("reacciona a un objeto roto del lugar", async () => {
    const { agent } = setup();
    const kinds = new Set<string>();
    for (let t = 0; t < 10; t++) {
      const d = await agent.decide(9 * 60 + t, {
        ...EMPTY,
        objectStates: [{ id: "cafetera", state: "rota" }],
        salient: true,
      });
      kinds.add(d.kind);
      if (d.kind === "react") expect(d.activityKind).toBe("work");
    }
    expect(kinds.has("react")).toBe(true);
  });
});

describe("activityKind", () => {
  it("se deduce del texto o de la pose", () => {
    expect(inferActivityKind("caminando a Café La Ola")).toBe("walk");
    expect(inferActivityKind("leyendo un libro")).toBe("read");
    expect(inferActivityKind("algo raro", "sleep")).toBe("sleep");
  });
});

describe("extractJson", () => {
  it("tolera bloques de código y texto alrededor", () => {
    expect(extractJson('Claro:\n```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(() => extractJson("sin json")).toThrow();
  });
});
