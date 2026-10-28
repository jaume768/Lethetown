import type { AgentSeed, Place } from "@lethetown/shared";
import { describe, expect, it } from "vitest";
import { Agent } from "../agent/agent";
import { agentMockResponder } from "../agent/mock-responder";
import { extractJson } from "../agent/parse";
import { LLMClient } from "../llm/client";
import { CostTracker } from "../llm/cost-tracker";
import { MockProvider } from "../llm/mock";
import { ModelRouter } from "../llm/router";
import { HashEmbedder } from "../memory/hash-embedder";
import { InMemoryStore } from "../memory/in-memory-store";
import { MemorySystem } from "../memory/memory-system";

const places: Place[] = [
  {
    id: "casa_ana",
    name: "Casa de Ana",
    kind: "home",
    rect: { x: 0, y: 0, w: 1, h: 1 },
    color: "#fff",
    objects: [],
  },
  {
    id: "cafe",
    name: "Café",
    kind: "cafe",
    rect: { x: 0, y: 0, w: 1, h: 1 },
    color: "#fff",
    objects: [],
  },
  {
    id: "parque",
    name: "Parque",
    kind: "park",
    rect: { x: 0, y: 0, w: 1, h: 1 },
    color: "#fff",
    objects: [],
  },
];
const seed: AgentSeed = {
  id: "ana",
  name: "Ana",
  age: 30,
  traits: ["curiosa"],
  description: "Ana es panadera.",
  homeId: "casa_ana",
  initialMemories: ["Me encanta el pan de centeno."],
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
  it("el prompt de identidad es estable (cacheable) y no depende del estado", () => {
    const { agent } = setup();
    const before = agent.system;
    agent.state.action = "otra cosa";
    expect(agent.system).toBe(before);
    expect(before).not.toMatch(/\d{2}:\d{2}/);
  });

  it("planifica el día con el modelo de reflexión y lugares válidos", async () => {
    const { agent, provider } = setup();
    const plan = await agent.planDay(6 * 60);
    expect(plan.length).toBeGreaterThan(3);
    expect(plan.every((p) => places.some((pl) => pl.id === p.placeId))).toBe(true);
    expect(provider.calls.at(-1)?.model).toBe("mock-reflection");
    expect(agent.currentPlanItem(7 * 60 + 30)?.activity).toBe("desayunar en casa");
  });

  it("sin nada saliente sigue el plan sin llamar al LLM", async () => {
    const { agent, provider } = setup();
    const n = provider.calls.length;
    const d = await agent.decide(8 * 60, { present: [], heard: [], salient: false });
    expect(d.kind).toBe("follow_plan");
    expect(provider.calls.length).toBe(n);
  });

  it("percibe, guarda recuerdos y llena la memoria de trabajo", async () => {
    const { agent, memory } = setup();
    await agent.perceive(
      [{ kind: "speech", fromId: "luis", fromName: "Luis", text: "¡Hola, Ana!", placeId: "cafe" }],
      8 * 60,
    );
    const all = await memory.store.listByAgent("ana");
    expect(all).toHaveLength(1);
    expect(all[0]?.people).toEqual(["luis"]);
    expect(all[0]?.importance).toBeGreaterThanOrEqual(4);
    expect(agent.workingMemory.contents).toHaveLength(1);
  });

  it("si alguien le habla puede responder a esa persona", async () => {
    const { agent } = setup();
    const kinds = new Set<string>();
    for (let t = 0; t < 12; t++) {
      const d = await agent.decide(8 * 60 + t, {
        present: [{ id: "luis", name: "Luis", action: "tomando café" }],
        heard: [{ fromId: "luis", fromName: "Luis", text: "¿Qué tal?" }],
        salient: true,
      });
      kinds.add(d.kind);
      if (d.kind === "talk") expect(d.to).toBe("luis");
    }
    expect(kinds.has("talk")).toBe(true);
  });
});

describe("extractJson", () => {
  it("tolera bloques de código y texto alrededor", () => {
    expect(extractJson('Claro:\n```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(() => extractJson("sin json")).toThrow();
  });
});
