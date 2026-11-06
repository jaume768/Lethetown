import { describe, expect, it } from "vitest";
import { EncounterConfig, encounterSalience, type EncounterFactors } from "../cognition/salience";
import { DEFAULT_MEMORY_CONFIG } from "../memory/config";

const cfg = EncounterConfig.parse({});
const none: EncounterFactors = {
  affinity: null,
  familiarity: null,
  family: false,
  rivalry: false,
  intention: false,
  meeting: false,
  loan: false,
  goalConflict: false,
  otherMood: null,
  daysApart: null,
};

describe("saliencia de un encuentro", () => {
  it("un desconocido sin nada pendiente es trivial", () => {
    const s = encounterSalience(none, cfg);
    expect(s).toMatchObject({ score: 0, salient: false, trivial: true, reasons: [] });
  });

  it("un vecino con algo de trato no basta para pararse a pensar", () => {
    const s = encounterSalience({ ...none, affinity: 0.3, familiarity: 0.4 }, cfg);
    expect(s.salient).toBe(false);
    expect(s.trivial).toBe(false);
    expect(s.reasons).toEqual(["affinity"]);
  });

  it("algo pendiente con esa persona (el libro de Carmen) sí", () => {
    const s = encounterSalience({ ...none, affinity: 0.4, familiarity: 0.5, intention: true }, cfg);
    expect(s.salient).toBe(true);
    expect(s.reasons[0]).toBe("intention");
  });

  it("el préstamo, la deuda y la rivalidad suman", () => {
    const s = encounterSalience({ ...none, affinity: -0.5, rivalry: true, loan: true }, cfg);
    expect(s.salient).toBe(true);
    expect(s.reasons).toEqual(["loan", "rivalry", "dislike"]);
  });

  it("el ánimo solo cuenta si se le nota mucho", () => {
    expect(encounterSalience({ ...none, otherMood: -0.4 }, cfg).reasons).toEqual([]);
    expect(encounterSalience({ ...none, otherMood: -0.8 }, cfg).reasons).toEqual(["mood_low"]);
    expect(encounterSalience({ ...none, otherMood: 0.7 }, cfg).reasons).toEqual(["mood_high"]);
  });

  it("reencuentro: días sin verse, solo si se conocen", () => {
    const known = { ...none, affinity: 0.4, familiarity: 0.6, daysApart: 3 };
    const s = encounterSalience(known, cfg);
    expect(s.reasons).toContain("reunion");
    expect(s.salient).toBe(true);
    expect(encounterSalience({ ...known, familiarity: 0.1 }, cfg).reasons).not.toContain("reunion");
    expect(encounterSalience({ ...known, daysApart: 1 }, cfg).reasons).not.toContain("reunion");
  });

  it("con tope en 1 y razones de más a menos peso", () => {
    const s = encounterSalience(
      {
        ...none,
        affinity: 1,
        familiarity: 1,
        family: true,
        intention: true,
        meeting: true,
        loan: true,
      },
      cfg,
    );
    expect(s.score).toBe(1);
    expect(s.reasons.slice(0, 2)).toEqual(["intention", "loan"]);
  });

  it("forma parte de MemoryConfig con sus valores por defecto", () => {
    expect(DEFAULT_MEMORY_CONFIG.encounter.threshold).toBe(0.5);
  });
});
