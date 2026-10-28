import { describe, expect, it } from "vitest";
import { LLMClient } from "../llm/client";
import { CostTracker } from "../llm/cost-tracker";
import { MockProvider } from "../llm/mock";
import { ModelRouter } from "../llm/router";

const pricing = {
  "m-fast": { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 1.25 },
  "m-refl": { input: 10, output: 20, cacheRead: 1, cacheWrite: 12.5 },
};

describe("ModelRouter", () => {
  it("elige el modelo según el tipo de tarea", () => {
    const router = new ModelRouter({ fast: "m-fast", reflection: "m-refl" });
    expect(router.modelFor("fast")).toBe("m-fast");
    expect(router.modelFor("reflection")).toBe("m-refl");
  });

  it("falla si falta algún modelo", () => {
    expect(() => new ModelRouter({ fast: "", reflection: "x" })).toThrow();
  });

  it("LLMClient envía cada tarea al modelo correcto", async () => {
    const provider = new MockProvider();
    const client = new LLMClient(
      provider,
      new ModelRouter({ fast: "m-fast", reflection: "m-refl" }),
      new CostTracker(pricing),
    );
    await client.run({ kind: "fast", task: "decide", system: "s", prompt: "p" });
    await client.run({ kind: "reflection", task: "plan", system: "s", prompt: "p" });
    expect(provider.calls.map((c) => c.model)).toEqual(["m-fast", "m-refl"]);
    expect(provider.calls[0]?.effort).toBe("low");
    expect(provider.calls[1]?.effort).toBe("medium");
  });
});

describe("CostTracker", () => {
  it("calcula el coste con la tabla de precios (USD por millón)", () => {
    const tracker = new CostTracker(pricing);
    const rec = tracker.record({
      model: "m-fast",
      task: "decide",
      agentId: "a",
      usage: {
        inputTokens: 1_000_000,
        outputTokens: 500_000,
        cacheReadTokens: 1_000_000,
        cacheWriteTokens: 0,
      },
    });
    expect(rec.usd).toBeCloseTo(1 + 1 + 0.1);
  });

  it("agrega por agente, tarea y modelo", () => {
    const tracker = new CostTracker(pricing);
    const usage = { inputTokens: 100, outputTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0 };
    tracker.record({ model: "m-fast", task: "decide", agentId: "a", usage });
    tracker.record({ model: "m-fast", task: "decide", agentId: "b", usage });
    tracker.record({ model: "m-refl", task: "plan", agentId: "a", usage });
    const s = tracker.summary();
    expect(s.total.calls).toBe(3);
    expect(s.total.inputTokens).toBe(300);
    expect(s.byAgent.a?.calls).toBe(2);
    expect(s.byTask.decide?.calls).toBe(2);
    expect(s.byModel["m-refl"]?.calls).toBe(1);
  });

  it("cuenta a 0 $ los modelos sin precio y los anota", () => {
    const tracker = new CostTracker(pricing);
    const rec = tracker.record({
      model: "desconocido",
      task: "t",
      usage: { inputTokens: 5, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0 },
    });
    expect(rec.usd).toBe(0);
    expect(tracker.unpricedModels.has("desconocido")).toBe(true);
  });

  it("registra el uso del MockProvider (incluida la caché simulada) a través del LLMClient", async () => {
    const tracker = new CostTracker(pricing);
    const client = new LLMClient(
      new MockProvider(() => "respuesta"),
      new ModelRouter({ fast: "m-fast", reflection: "m-refl" }),
      tracker,
    );
    const system = "identidad estable ".repeat(20);
    await client.run({ kind: "fast", task: "decide", agentId: "a", system, prompt: "hola" });
    await client.run({ kind: "fast", task: "decide", agentId: "a", system, prompt: "hola" });
    const s = tracker.summary();
    expect(s.byAgent.a?.calls).toBe(2);
    expect(s.total.cacheReadTokens).toBeGreaterThan(0);
    expect(s.total.usd).toBeGreaterThan(0);
  });
});
