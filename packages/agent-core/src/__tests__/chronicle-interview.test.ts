import { readFileSync } from "node:fs";
import { AgentSeed, parseTiledMap } from "@lethetown/shared";
import { describe, expect, it } from "vitest";
import { Agent } from "../agent/agent";
import { writeChronicle } from "../agent/chronicle";
import { INTERVIEW_QUESTIONS, interviewAgent } from "../agent/interview";
import { agentMockResponder } from "../agent/mock-responder";
import { LLMClient, type CallEvent } from "../llm/client";
import { CostTracker } from "../llm/cost-tracker";
import { MockProvider } from "../llm/mock";
import { ModelRouter } from "../llm/router";
import { HashEmbedder } from "../memory/hash-embedder";
import { InMemoryStore } from "../memory/in-memory-store";
import { MemorySystem } from "../memory/memory-system";

const world = parseTiledMap(
  JSON.parse(readFileSync(new URL("../../../../seeds/town.tmj", import.meta.url), "utf8")),
);

function setup() {
  const llm = new LLMClient(
    new MockProvider(agentMockResponder),
    new ModelRouter({ fast: "mock-fast", reflection: "mock-reflection" }),
    new CostTracker({}),
  );
  const memory = new MemorySystem({ store: new InMemoryStore(), embedder: new HashEmbedder() });
  const seed = AgentSeed.parse({
    id: "lucia",
    name: "Lucía Ferrer",
    age: 28,
    traits: ["creativa"],
    description: "Ilustradora.",
    homeId: "casa_azul",
    initialMemories: ["Soy ilustradora y estoy terminando un cuento infantil."],
  });
  return { llm, memory, agent: new Agent(seed, { llm, memory, places: world.places }) };
}

describe("crónica del día", () => {
  it("usa el modelo de reflexión y devuelve título y texto", async () => {
    const { llm } = setup();
    const calls: CallEvent[] = [];
    llm.onCall((e) => calls.push(e));
    const c = await writeChronicle(llm, 2, ['Mateo → Lucía: "Hola"', "Lucía: tomar un café"]);
    expect(c.day).toBe(2);
    expect(c.title.length).toBeGreaterThan(0);
    expect(c.text).toMatch(/conversaci/);
    expect(calls.map((x) => x.phase)).toEqual(["start", "end"]);
    expect(calls[0]!.model).toBe("mock-reflection");
  });
});

describe("entrevistas", () => {
  it("contesta todas las preguntas basándose en sus recuerdos sin alterar la memoria", async () => {
    const { llm, memory, agent } = setup();
    await agent.seedMemories(0);
    const before = await memory.store.listByAgent("lucia");
    const answers = await interviewAgent(agent, memory, llm, 60);
    expect(answers).toHaveLength(INTERVIEW_QUESTIONS.length);
    expect(answers[0]!.answer).toMatch(/Lucía Ferrer/);
    expect(answers[0]!.memories[0]).toMatch(/ilustradora/);
    const after = await memory.store.listByAgent("lucia");
    expect(after.map((m) => m.accessCount)).toEqual(before.map((m) => m.accessCount));
  });
});
