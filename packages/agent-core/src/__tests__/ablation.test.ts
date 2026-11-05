/** Ablación de la memoria (corrección 3.5): un mundo de control sin olvido ni vaguedad. */
import { describe, expect, it } from "vitest";
import { MemoryConfig, withAblation } from "../memory/config";
import { clarityFor } from "../memory/retrieval";

describe("ablación de la memoria", () => {
  it("por defecto, apagada: la config no cambia", () => {
    const cfg = MemoryConfig.parse({});
    expect(withAblation(cfg)).toEqual(cfg);
  });

  it("sin olvido: nada se olvida ni se borra o resume por presupuesto; sin vaguedad: nada es vago", () => {
    const cfg = withAblation(
      MemoryConfig.parse({ ablation: { noForgetting: true, noVagueness: true } }),
    );
    expect(cfg.retrieval.forgetThreshold).toBe(0);
    expect(cfg.retrieval.vagueThreshold).toBe(0);
    expect(cfg.budget.tokensPerAgent).toBe(Number.MAX_SAFE_INTEGER);
    expect(clarityFor(0.001, cfg.retrieval)).toBe("clear");
    // Solo sin vaguedad: se sigue olvidando.
    const vague = withAblation(MemoryConfig.parse({ ablation: { noVagueness: true } }));
    expect(clarityFor(0.01, vague.retrieval)).toBe("forgotten");
    expect(clarityFor(0.1, vague.retrieval)).toBe("clear");
  });
});
