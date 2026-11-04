/** Tope de la estabilidad: evocar muchas veces seguidas no la hace crecer sin límite. */
import { describe, expect, it } from "vitest";
import { DEFAULT_DECAY, capStability, reinforce } from "../memory/decay";

describe("estabilidad con tope", () => {
  it("142 evocaciones seguidas (una meta en cada decisión) no pasan de maxStabilityHours", () => {
    // En la partida de la fase 3, así se llegó a 3,8e38 h y Postgres rechazó el UPDATE (real).
    let m = { strength: 1, stability: 40, lastAccessedAt: 0, accessCount: 0 };
    for (let i = 1; i <= 142; i++) m = reinforce(m, i * 10);
    expect(Number.isFinite(m.stability)).toBe(true);
    expect(m.stability).toBe(DEFAULT_DECAY.maxStabilityHours);
    expect(m.accessCount).toBe(142);
  });

  it("un valor ya desbordado vuelve al tope; uno normal no cambia", () => {
    expect(capStability(3.8e38)).toBe(87_600);
    expect(capStability(120)).toBe(120);
  });
});
