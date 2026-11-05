/** Deriva lenta de la personalidad: unas centésimas por semana, con límites y su motivo. */
import type { BigFive } from "@lethetown/shared";
import { describe, expect, it } from "vitest";
import {
  DriftConfig,
  ageDrift,
  applyDrift,
  driftText,
  townWeeklyDrift,
  weeklyDrift,
} from "../agent/personality-drift";

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

describe("deriva respecto a la media del pueblo y con lo malo (corrección 3.5)", () => {
  it("lo malo también pesa: plantones, metas estancadas, soledad, préstamos sin devolver", () => {
    const d = weeklyDrift({ stoodUp: 2, goalStalled: 2, lonely: 2, unpaidLoan: 2 }, 40, cfg);
    expect(d.neuroticism).toBeGreaterThan(0);
    expect(d.agreeableness).toBeLessThan(0);
    expect(d.extraversion).toBeLessThan(0);
  });

  it("una semana con un vecino «bueno» y otro «malo»: deltas de signo distinto", () => {
    const town = [
      { id: "bueno", age: 40, lived: { goalAchieved: 3, learned: 3, support: 2 } },
      { id: "malo", age: 40, lived: { stoodUp: 3, conflict: 3, goalStalled: 2, lonely: 2 } },
      ...Array.from({ length: 18 }, (_, i) => ({ id: `v${i}`, age: 40, lived: { learned: 1 } })),
    ];
    const d = townWeeklyDrift(town, cfg);
    expect(d.bueno!.neuroticism).toBeLessThan(0);
    expect(d.malo!.neuroticism).toBeGreaterThan(0);
    for (const delta of Object.values(d)) {
      for (const v of Object.values(delta)) expect(Math.abs(v)).toBeLessThanOrEqual(0.02 + 1e-9);
    }
  });

  it("si todo el pueblo vive lo mismo, solo queda la edad", () => {
    const same = { learned: 3, goalAchieved: 2 };
    const d = townWeeklyDrift(
      [
        { id: "a", age: 40, lived: same },
        { id: "b", age: 20, lived: same },
      ],
      cfg,
    );
    const age40 = ageDrift(40, cfg);
    expect(d.a!.openness ?? 0).toBeCloseTo(0, 9);
    expect(d.a!.conscientiousness).toBeCloseTo(age40.conscientiousness!, 9);
    expect(d.b!.conscientiousness).toBeGreaterThan(d.a!.conscientiousness!);
  });

  it("sin restar la media (relativeToTown 0), como antes", () => {
    const abs = DriftConfig.parse({ relativeToTown: 0 });
    const lived = { goalAchieved: 2 };
    expect(townWeeklyDrift([{ id: "a", age: 40, lived }], abs).a).toEqual(
      weeklyDrift(lived, 40, abs),
    );
  });
});
