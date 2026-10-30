import type { CompletionRequest, CompletionResult } from "@lethetown/agent-core";
import { describe, expect, it } from "vitest";
import { LimitedProvider } from "./llm-queue";

const req = (task: string) => ({ meta: { task } }) as CompletionRequest;
const result: CompletionResult = {
  text: "{}",
  model: "m",
  usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
};

describe("cola del LLM con prioridad", () => {
  it("con la cola llena, una decisión pasa delante de esencias y fichas sociales", async () => {
    const order: string[] = [];
    const gates: (() => void)[] = [];
    const inner = {
      name: "fake",
      complete: (r: CompletionRequest) =>
        new Promise<CompletionResult>((resolve) => {
          order.push(r.meta.task);
          gates.push(() => resolve(result));
        }),
    };
    let t = 0;
    const waited: string[] = [];
    const q = new LimitedProvider(
      inner,
      1,
      (task) => waited.push(task),
      () => t,
    );
    const all = ["gist", "social", "chronicle", "decide", "summarize", "importance"].map((x) =>
      q.complete(req(x)),
    );
    expect(q.activeCount).toBe(1);
    expect(q.pendingCount).toBe(5);
    t = 100;
    while (gates.length) {
      gates.shift()!();
      await new Promise((r) => setTimeout(r, 0));
    }
    await Promise.all(all);
    expect(order).toEqual(["gist", "decide", "importance", "social", "chronicle", "summarize"]);
    expect(q.waitStats().decide).toEqual({ calls: 1, totalMs: 100, maxMs: 100 });
    expect(q.waitStats().gist!.totalMs).toBe(0);
    expect(waited).toHaveLength(6);
  });

  it("respeta la concurrencia", async () => {
    let running = 0;
    let peak = 0;
    const inner = {
      name: "fake",
      complete: async () => {
        peak = Math.max(peak, ++running);
        await new Promise((r) => setTimeout(r, 1));
        running--;
        return result;
      },
    };
    const q = new LimitedProvider(inner, 3);
    await Promise.all(Array.from({ length: 10 }, () => q.complete(req("decide"))));
    expect(peak).toBe(3);
  });
});
