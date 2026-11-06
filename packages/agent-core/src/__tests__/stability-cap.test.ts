/**
 * Estabilidad de los recuerdos: crece con el espaciado de las evocaciones (corrección 3.5) y
 * nunca pasa del tope (`maxStabilityHours`).
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_DECAY, capStability, reinforce, spacingFactor } from "../memory/decay";

type Mem = { strength: number; stability: number; lastAccessedAt: number; accessCount: number };
const fresh = (stability = 40): Mem => ({
  strength: 1,
  stability,
  lastAccessedAt: 0,
  accessCount: 0,
});
/** Evoca `times` veces, cada `everyMin` minutos de juego. */
function evoke(m: Mem, times: number, everyMin: number): Mem {
  for (let i = 1; i <= times; i++) m = reinforce(m, m.lastAccessedAt + everyMin);
  return m;
}

describe("efecto de espaciado", () => {
  it("evocar 100 veces seguidas, con 1 minuto de separación, casi no sube τ", () => {
    const m = evoke(fresh(40), 100, 1);
    expect(m.accessCount).toBe(100);
    expect(m.stability).toBeLessThan(40 * 1.1);
  });

  it("evocar una vez al día sí lo sube (y más que evocarlo cada 10 minutos)", () => {
    const daily = evoke(fresh(40), 3, 24 * 60);
    expect(daily.stability).toBeGreaterThan(40 * 3);
    const often = evoke(fresh(40), 3 * 144, 10); // las mismas 72 h, cada 10 min
    expect(daily.stability).toBeGreaterThan(often.stability);
  });

  it("k(Δt) va de 1 (Δt = 0) a k_max (×1,8 a ×3,6, la regla de antes)", () => {
    const m = { strength: 1, stability: 40, lastAccessedAt: 0 };
    expect(spacingFactor(m, 0)).toBe(1);
    // Mucho después, casi olvidado: casi ×3,6.
    expect(spacingFactor(m, 40 * 60 * 20)).toBeCloseTo(3.6, 2);
    // Δt = τ: un 63 % del camino (con la dificultad de entonces).
    const s = Math.exp(-1);
    const kMax = DEFAULT_DECAY.recallStabilityGrowth * (2 - s);
    expect(spacingFactor(m, 40 * 60)).toBeCloseTo(1 + (kMax - 1) * (1 - Math.exp(-1)), 6);
  });

  it("la fuerza sube al recordar aunque sea seguido (lo espaciado es la estabilidad)", () => {
    const m = reinforce({ strength: 0.5, stability: 40, lastAccessedAt: 0, accessCount: 0 }, 1);
    expect(m.strength).toBeGreaterThan(0.5);
  });
});

describe("estabilidad con tope", () => {
  it("nada supera maxStabilityHours, ni evocándolo muy espaciado durante años", () => {
    // En la partida de la fase 3, sin tope ni espaciado, se llegó a 3,8e38 h (Postgres, real).
    const m = evoke(fresh(40), 60, 60 * 24 * 365);
    expect(Number.isFinite(m.stability)).toBe(true);
    expect(m.stability).toBe(DEFAULT_DECAY.maxStabilityHours);
    const seguido = evoke(fresh(DEFAULT_DECAY.maxStabilityHours), 142, 10);
    expect(seguido.stability).toBeLessThanOrEqual(DEFAULT_DECAY.maxStabilityHours);
  });

  it("un valor ya desbordado vuelve al tope; uno normal no cambia", () => {
    expect(capStability(3.8e38)).toBe(87_600);
    expect(capStability(120)).toBe(120);
  });
});
