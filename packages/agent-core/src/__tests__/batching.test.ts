import { describe, expect, it } from "vitest";
import { BatchingProvider } from "../llm/batching";
import type { BatchCapableProvider, CompletionRequest, CompletionResult } from "../llm/types";

const result = (text: string, priceMultiplier?: number): CompletionResult => ({
  text,
  model: "m",
  usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
  priceMultiplier,
});
const req = (task: string, prompt: string) =>
  ({
    model: "m",
    system: "",
    prompt,
    maxTokens: 1,
    effort: "low",
    meta: { task },
  }) as CompletionRequest;

function fakes(batchImpl: BatchCapableProvider["submitBatch"]) {
  const direct = {
    name: "d",
    calls: [] as string[],
    async complete(r: CompletionRequest) {
      this.calls.push(r.prompt);
      return result(`directo:${r.prompt}`);
    },
  };
  const batcher: BatchCapableProvider & { batches: number } = {
    name: "b",
    batches: 0,
    complete: direct.complete.bind(direct),
    submitBatch(reqs, opts) {
      this.batches++;
      return batchImpl(reqs, opts);
    },
  };
  return { direct, batcher };
}

const base = { tasks: ["consolidate", "chronicle"], windowMs: 5, pollMs: 1, maxWaitMs: 200 };

describe("BatchingProvider", () => {
  it("junta las tareas elegidas en un lote y deja pasar las demás", async () => {
    const { direct, batcher } = fakes(async (reqs) =>
      reqs.map((r) => result(`lote:${r.prompt}`, 0.5)),
    );
    const p = new BatchingProvider(direct, batcher, { ...base, enabled: () => true });
    const [a, b, c] = await Promise.all([
      p.complete(req("consolidate", "a")),
      p.complete(req("chronicle", "b")),
      p.complete(req("decide", "c")),
    ]);
    expect([a.text, b.text, c.text]).toEqual(["lote:a", "lote:b", "directo:c"]);
    expect(a.priceMultiplier).toBe(0.5);
    expect(batcher.batches).toBe(1);
  });

  it("si el lote falla o una petición falla, la repite por la vía normal", async () => {
    const { direct, batcher } = fakes(async (reqs) => [
      result("lote:a"),
      new Error("x"),
      ...reqs.slice(2).map(() => result("?")),
    ]);
    const p = new BatchingProvider(direct, batcher, { ...base, enabled: () => true });
    const [a, b] = await Promise.all([
      p.complete(req("consolidate", "a")),
      p.complete(req("consolidate", "b")),
    ]);
    expect([a.text, b.text]).toEqual(["lote:a", "directo:b"]);
  });

  it("si el lote tarda más de maxWaitMs, se cancela y va por la vía normal", async () => {
    const { direct, batcher } = fakes(
      (_reqs, { signal }) =>
        new Promise((_, reject) =>
          signal.addEventListener("abort", () => reject(new Error("cancelado"))),
        ),
    );
    const reasons: string[] = [];
    const p = new BatchingProvider(
      direct,
      batcher,
      { ...base, maxWaitMs: 20, enabled: () => true },
      (r) => reasons.push(r),
    );
    expect((await p.complete(req("chronicle", "z"))).text).toBe("directo:z");
    expect(reasons).toEqual(["cancelado"]);
  });

  it("desactivado (simulación rápida), todo va directo", async () => {
    const { direct, batcher } = fakes(async () => []);
    const p = new BatchingProvider(direct, batcher, { ...base, enabled: () => false });
    expect((await p.complete(req("consolidate", "a"))).text).toBe("directo:a");
    expect(batcher.batches).toBe(0);
  });
});
