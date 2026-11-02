/** Metas en agent-core: psicología (motivación, frustración, abandono, cambio de rumbo) y criterios. */
import { readFileSync } from "node:fs";
import type { BigFive } from "@lethetown/shared";
import { describe, expect, it } from "vitest";
import {
  criterionText,
  measuredProgress,
  relationshipBaseline,
  relationshipProgress,
} from "../goals/criteria";
import {
  GoalsConfig,
  abandonProbability,
  frustrationMood,
  goalDay,
  lifeChangeProbability,
} from "../goals/psychology";

const cfg = GoalsConfig.parse({});
const mid: BigFive = {
  openness: 0.5,
  conscientiousness: 0.5,
  extraversion: 0.5,
  agreeableness: 0.5,
  neuroticism: 0.5,
};
const goal = { motivation: 0.5, frustration: 0.4 };

describe("psicología de las metas", () => {
  it("avanzar sube la motivación y el ánimo y alivia la frustración", () => {
    const r = goalDay(goal, 0.3, 0, mid, cfg);
    expect(r.motivation).toBeGreaterThan(goal.motivation);
    expect(r.frustration).toBeLessThan(goal.frustration);
    expect(r.moodDelta).toBeGreaterThan(0);
    expect(r.moodDelta).toBeLessThanOrEqual(cfg.moodMaxPerDay);
  });

  it("estancarse sube la frustración, más con neuroticismo; al principio, no", () => {
    expect(goalDay(goal, 0, 0.5, mid, cfg).frustration).toBe(goal.frustration);
    const calm = goalDay(goal, 0, 2, { ...mid, neuroticism: 0.2 }, cfg);
    const nervous = goalDay(goal, 0, 2, { ...mid, neuroticism: 0.9 }, cfg);
    expect(calm.frustration).toBeGreaterThan(goal.frustration);
    expect(nervous.frustration).toBeGreaterThan(calm.frustration);
    expect(nervous.motivation).toBeLessThan(goal.motivation);
    expect(nervous.reason).toMatch(/sin avanzar/);
  });

  it("la frustración sostenida baja el ánimo", () => {
    expect(frustrationMood([0.8, 0.7], cfg)).toBeLessThan(0);
    expect(frustrationMood([0.2, 0.3], cfg)).toBe(0);
    expect(frustrationMood([], cfg)).toBe(0);
  });

  it("abandonar: solo con frustración alta; menos si es constante, más si es neurótico", () => {
    expect(abandonProbability(0.5, mid, cfg)).toBe(0);
    const base = abandonProbability(0.9, mid, cfg);
    expect(base).toBeGreaterThan(0);
    expect(abandonProbability(0.9, { ...mid, conscientiousness: 0.9 }, cfg)).toBeLessThan(base);
    expect(abandonProbability(0.9, { ...mid, neuroticism: 0.9 }, cfg)).toBeGreaterThan(base);
  });

  it("cambiar de meta vital: más con apertura y juventud, mucho menos de mayor", () => {
    const at40 = lifeChangeProbability(0.95, mid, 40, cfg);
    expect(at40).toBeGreaterThan(0);
    expect(lifeChangeProbability(0.95, { ...mid, openness: 0.9 }, 40, cfg)).toBeGreaterThan(at40);
    expect(lifeChangeProbability(0.95, mid, 20, cfg)).toBeGreaterThan(at40);
    expect(lifeChangeProbability(0.95, mid, 80, cfg)).toBeLessThan(at40);
    expect(lifeChangeProbability(0.5, mid, 20, cfg)).toBe(0);
  });
});

describe("una semana de juego (frustración 0,2 al día)", () => {
  const seeds = (
    JSON.parse(readFileSync(new URL("../../../../seeds/agents.json", import.meta.url), "utf8")) as {
      id: string;
      personality: BigFive;
    }[]
  ).map((s) => ({ id: s.id, p: s.personality }));

  /** Probabilidad de abandonar un proyecto en `days` días; avanza cada `every` días (0 = nunca). */
  const weekly = (p: BigFive, every = 0, days = 7) => {
    let g = { motivation: cfg.initialMotivation, frustration: 0 };
    let stagnant = 0;
    let stay = 1;
    for (let d = 1; d <= days; d++) {
      const gained = every && d % every === 0 ? 0.1 : 0;
      stagnant = gained ? 0 : stagnant + 1;
      const r = goalDay(g, gained, stagnant, p, cfg);
      g = { motivation: r.motivation, frustration: r.frustration };
      stay *= 1 - abandonProbability(g.frustration, p, cfg);
    }
    return 1 - stay;
  };

  it("un proyecto parado toda la semana: abandonos plausibles, según cómo es cada uno", () => {
    const all = seeds.map((s) => weekly(s.p));
    const mean = all.reduce((a, b) => a + b, 0) / all.length;
    expect(mean).toBeGreaterThan(0.35);
    expect(mean).toBeLessThan(0.7);
    // Nadie lo deja seguro ni nadie aguanta siempre: depende de la personalidad.
    expect(Math.max(...all)).toBeLessThan(0.95);
    expect(Math.min(...all)).toBeGreaterThan(0.15);
  });

  it("si avanza aunque sea un poco cada dos días, casi nunca se abandona (no son masivos)", () => {
    for (const s of seeds) expect(weekly(s.p, 2), s.id).toBeLessThan(0.05);
  });
});

describe("criterios de las metas", () => {
  it("progreso de lo medido: minutos para las horas, veces para el resto", () => {
    expect(measuredProgress({ type: "place_time", placeId: "lago", hours: 2 }, 60)).toBe(0.5);
    expect(measuredProgress({ type: "notes", count: 4 }, 1)).toBe(0.25);
    expect(measuredProgress({ type: "notes", count: 4 }, 9)).toBe(1);
  });

  it("relación: de lo que había al crearla al objetivo; tipo de relación, todo o nada", () => {
    const c = { type: "relationship" as const, personId: "x", affinity: 0.6 };
    const base = relationshipBaseline(c, { affinity: 0.2, trust: 0.5 });
    expect(base).toBe(0.2);
    expect(
      relationshipProgress(c, { affinity: 0.4, trust: 0.5, relationshipType: "neighbor" }, base),
    ).toBeCloseTo(0.5);
    expect(
      relationshipProgress(c, { affinity: 0.7, trust: 0.5, relationshipType: "neighbor" }, base),
    ).toBe(1);
    const friends = {
      type: "relationship" as const,
      personId: "x",
      relationship: "friendship" as const,
    };
    expect(
      relationshipProgress(
        friends,
        { affinity: 0, trust: 0, relationshipType: "friendship" },
        null,
      ),
    ).toBe(1);
  });

  it("se dice en el prompt con lo que lleva", () => {
    const names = { person: () => "Valentina", place: () => "Lago Leteo" };
    expect(criterionText({ type: "activity_hours", keywords: ["foto"], hours: 8 }, 90, names)).toBe(
      "pasar 8 h en algo de «foto» (llevas 1,5 h)",
    );
    expect(
      criterionText({ type: "conversations", personId: "valentina", count: 5 }, 2, names),
    ).toBe("5 conversaciones con Valentina (llevas 2)");
  });
});
