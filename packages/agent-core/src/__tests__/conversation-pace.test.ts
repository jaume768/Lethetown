/** Ritmo de las conversaciones: importancia por reglas y reconsolidación después de decidir. */
import { readFileSync } from "node:fs";
import { AgentSeed, parseTiledMap } from "@lethetown/shared";
import { describe, expect, it } from "vitest";
import { Agent } from "../agent/agent";
import { rateHeard } from "../agent/heard-rating";
import { agentMockResponder } from "../agent/mock-responder";
import { LLMClient } from "../llm/client";
import { CostTracker } from "../llm/cost-tracker";
import { MockProvider } from "../llm/mock";
import { ModelRouter } from "../llm/router";
import { DEFAULT_MEMORY_CONFIG } from "../memory/config";
import { HashEmbedder } from "../memory/hash-embedder";
import { InMemoryStore } from "../memory/in-memory-store";
import { MemorySystem } from "../memory/memory-system";

const places = parseTiledMap(
  JSON.parse(readFileSync(new URL("../../../../seeds/town.tmj", import.meta.url), "utf8")),
).places;
const seed = AgentSeed.parse({
  id: "lucia",
  name: "Lucía",
  age: 30,
  traits: ["curiosa"],
  description: "Lucía es ilustradora.",
  homeId: "casa_azul",
});
const cfg = DEFAULT_MEMORY_CONFIG.heardRating;

function setup(reconsolidationProbability = 0) {
  const tasks: string[] = [];
  const provider = new MockProvider((req) => {
    tasks.push(req.meta.task);
    return agentMockResponder(req);
  });
  const llm = new LLMClient(
    provider,
    new ModelRouter({ fast: "f", reflection: "r" }),
    new CostTracker({}),
  );
  const memory = new MemorySystem({
    store: new InMemoryStore(),
    embedder: new HashEmbedder(),
    config: {
      ...DEFAULT_MEMORY_CONFIG,
      reconsolidation: {
        ...DEFAULT_MEMORY_CONFIG.reconsolidation,
        probability: reconsolidationProbability,
        minImportance: 1,
      },
    },
    reconsolidator: {
      reconsolidate: async (m) => {
        tasks.push("reconsolidate");
        return { text: `${m.text} (con otro color)`, emotionalValence: 0 };
      },
    },
  });
  return { tasks, memory, agent: new Agent(seed, { llm, memory, places }) };
}

describe("importancia por reglas", () => {
  it("lo normal es poco importante; rumores, confesiones y emociones, más", () => {
    expect(rateHeard("Vale, ahora voy.", cfg)).toEqual({ importance: 3, valence: 0 });
    expect(rateHeard("Dicen que Mateo cierra el café.", cfg).importance).toBe(5);
    const secret = rateHeard("No se lo digas a nadie: estoy embarazada.", cfg);
    expect(secret.importance).toBeGreaterThanOrEqual(6);
    expect(rateHeard("¡Qué bien, me encanta!", cfg).valence).toBeGreaterThan(0.5);
    expect(rateHeard("Eres un idiota.", cfg).valence).toBeLessThan(0);
    expect(rateHeard("Dicen que hay un secreto: me caso y estoy harta!!", cfg).importance).toBe(
      cfg.max,
    );
  });

  it("en una conversación en curso lo que se oye no llama a la tarea importance", async () => {
    const { agent, tasks, memory } = setup();
    const heard = {
      kind: "speech" as const,
      fromId: "mateo",
      fromName: "Mateo",
      text: "Dicen que va a llover.",
      placeId: "cafe_ola",
    };
    await agent.perceive([heard], 600, { inConversation: true });
    expect(tasks).not.toContain("importance");
    const [m] = await memory.store.listByAgent("lucia");
    expect(m!.importance).toBe(5);
    // Fuera de una conversación (o con algo que no se oye), sí.
    await agent.perceive([heard], 601);
    expect(tasks).toContain("importance");
  });
});

describe("reconsolidación en segundo plano", () => {
  it("se reescribe después de decidir, no antes", async () => {
    const { agent, tasks, memory } = setup(1);
    await memory.remember(
      { agentId: "lucia", text: "Mateo me regaló un café.", type: "observation", importance: 6 },
      0,
    );
    await agent.decide(600, {
      present: [{ id: "mateo", name: "Mateo", action: "trabajar" }],
      heard: [{ fromId: "mateo", fromName: "Mateo", text: "¿Otro café?" }],
      conversationWith: "mateo",
      objectStates: [],
      weather: "sunny",
      socialNotes: [],
      salient: true,
    });
    // Al volver de decide aún no se ha reescrito; justo después, sí.
    expect(tasks).toContain("decide");
    expect(tasks).not.toContain("reconsolidate");
    await new Promise((r) => setTimeout(r, 0));
    expect(tasks.indexOf("reconsolidate")).toBeGreaterThan(tasks.indexOf("decide"));
    const [m] = await memory.store.listByAgent("lucia");
    expect(m!.text).toMatch(/con otro color/);
  });
});
