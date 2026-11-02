/** Deriva lenta de la personalidad: unas centésimas por semana, con límites y su motivo. */
import type { BigFive } from "@lethetown/shared";
import { describe, expect, it } from "vitest";
import { DriftConfig, applyDrift, driftText, weeklyDrift } from "../agent/personality-drift";

const cfg = DriftConfig.parse({});
const mid: BigFive = {
  openness: 0.5,
  conscientiousness: 0.5,
  extraversion: 0.5,
  agreeableness: 0.5,
  neuroticism: 0.5,
};

describe("deriva de la personalidad", () => {
  it("conseguir metas da constancia y calma; abandonarlas, lo contrario", () => {
    const good = weeklyDrift({ goalAchieved: 2 }, 40, cfg);
    expect(good.conscientiousness).toBeGreaterThan(0);
    expect(good.neuroticism).toBeLessThan(0);
    const bad = weeklyDrift({ goalAbandoned: 2 }, 40, cfg);
    expect(bad.neuroticism).toBeGreaterThan(0);
  });

  it("aprender abre; enseñar, amabilidad; los conflictos, aspereza e inquietud; el apoyo, calma", () => {
    expect(weeklyDrift({ learned: 3 }, 40, cfg).openness).toBeGreaterThan(0);
    expect(weeklyDrift({ taught: 3 }, 40, cfg).agreeableness).toBeGreaterThan(0);
    const fights = weeklyDrift({ conflict: 3 }, 40, cfg);
    expect(fights.agreeableness).toBeLessThan(0);
    expect(fights.neuroticism).toBeGreaterThan(0);
    expect(weeklyDrift({ support: 4 }, 40, cfg).neuroticism).toBeLessThan(0);
  });

  it("como mucho unas centésimas por semana, por mucho que pase", () => {
    const lots = weeklyDrift({ goalAchieved: 50, learned: 50, support: 50 }, 20, cfg);
    for (const v of Object.values(lots)) expect(Math.abs(v)).toBeLessThanOrEqual(0.02 + 1e-9);
  });

  it("la edad: de joven se gana constancia y calma; de mayor, algo menos de apertura", () => {
    const young = weeklyDrift({}, 19, cfg);
    expect(young.conscientiousness).toBeGreaterThan(0);
    expect(young.neuroticism).toBeLessThan(0);
    expect(weeklyDrift({}, 80, cfg).openness).toBeLessThan(0);
  });

  it("con límites: nunca más de 0,15 desde la semilla ni fuera de [0,05, 0,95]", () => {
    let p = mid;
    for (let w = 0; w < 52; w++) p = applyDrift(p, mid, { conscientiousness: 0.02 }, cfg);
    expect(p.conscientiousness).toBeCloseTo(0.65);
    const high = { ...mid, neuroticism: 0.94 };
    expect(applyDrift(high, high, { neuroticism: 0.02 }, cfg).neuroticism).toBe(0.95);
  });

  it("con su motivo, sin género", () => {
    const after = applyDrift(mid, mid, { conscientiousness: 0.01, neuroticism: -0.008 }, cfg);
    expect(driftText(mid, after)).toBe("con más constancia (+0.010), con más calma (-0.008)");
  });
});
