import { describe, expect, it } from "vitest";
import {
  CircuitOpenError,
  LLMTimeoutError,
  ResilientProvider,
  isTransient,
} from "../llm/resilience";
import type { CompletionRequest, CompletionResult, LLMProvider } from "../llm/types";
import { LLMRefusalError } from "../llm/types";

const OK: CompletionResult = {
  text: "{}",
  model: "m",
  usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
};
const req = {
  model: "m",
  system: "",
  prompt: "",
  maxTokens: 1,
  effort: "low",
  meta: { task: "t" },
} as CompletionRequest;
const httpError = (status: number) => Object.assign(new Error(`HTTP ${status}`), { status });

/** Proveedor que falla con los errores dados (uno por llamada) y luego responde. */
function flaky(errors: unknown[]): LLMProvider & { calls: number } {
  return {
    name: "fake",
    calls: 0,
    async complete() {
      const e = errors[this.calls++];
      if (e) throw e;
      return OK;
    },
  };
}

const opts = {
  timeoutMs: 50,
  retries: 3,
  baseDelayMs: 100,
  maxDelayMs: 1000,
  breakerThreshold: 3,
  breakerCooldownMs: 10_000,
};

describe("ResilientProvider", () => {
  it("reintenta 429 y 5xx con backoff exponencial y jitter, y acaba respondiendo", async () => {
    const inner = flaky([httpError(429), httpError(503)]);
    const delays: number[] = [];
    const p = new ResilientProvider(
      inner,
      opts,
      {},
      {
        sleep: async (ms) => void delays.push(ms),
        random: () => 0.5,
      },
    );
    await expect(p.complete(req)).resolves.toBe(OK);
    expect(inner.calls).toBe(3);
    expect(delays).toEqual([50, 100]); // jitter 0.5 × (100, 200)
  });

  it("no reintenta errores definitivos (400, rechazo del modelo)", async () => {
    expect(isTransient(httpError(400))).toBe(false);
    expect(isTransient(new LLMRefusalError("no", "m"))).toBe(false);
    const inner = flaky([httpError(400)]);
    const p = new ResilientProvider(inner, opts, {}, { sleep: async () => {} });
    await expect(p.complete(req)).rejects.toThrow("HTTP 400");
    expect(inner.calls).toBe(1);
  });

  it("corta por timeout y lo trata como transitorio", async () => {
    const slow: LLMProvider = {
      name: "slow",
      complete: (r) =>
        new Promise((resolve, reject) => {
          const t = setTimeout(() => resolve(OK), 1000);
          r.signal?.addEventListener("abort", () => {
            clearTimeout(t);
            reject(new Error("abortado"));
          });
        }),
    };
    const p = new ResilientProvider(slow, { ...opts, retries: 0 }, {}, { sleep: async () => {} });
    await expect(p.complete(req)).rejects.toBeInstanceOf(LLMTimeoutError);
  });

  it("abre el circuito tras N fallos, falla rápido y se cierra tras una prueba buena", async () => {
    let now = 0;
    const inner = flaky([httpError(500), httpError(500), httpError(500)]);
    const states: string[] = [];
    const p = new ResilientProvider(
      inner,
      { ...opts, retries: 5 },
      { onBreaker: (s) => states.push(s) },
      { now: () => now, sleep: async () => {}, random: () => 0 },
    );
    await expect(p.complete(req)).rejects.toThrow("HTTP 500");
    expect(p.breakerState).toBe("open");
    await expect(p.complete(req)).rejects.toBeInstanceOf(CircuitOpenError);
    expect(inner.calls).toBe(3);
    now = 10_001;
    await expect(p.complete(req)).resolves.toBe(OK);
    expect(p.breakerState).toBe("closed");
    expect(states).toEqual(["open", "half-open", "closed"]);
  });
});
