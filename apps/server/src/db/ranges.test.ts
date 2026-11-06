/** Rangos antes de guardar (corrección 3.5): nada se sale del `real` de Postgres. */
import { getTableColumns } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { bounded, inRange, RANGES } from "./ranges";
import * as schema from "./schema";

/** Mayor valor finito de un `real` (float4) de Postgres. */
const REAL_MAX = 3.4028234e38;

describe("rangos de las columnas numéricas", () => {
  it("valores extremos (los de la partida: 3,8e38 h), NaN e infinitos se quedan en su rango", () => {
    const m = bounded(
      { id: "m1", strength: Number.NaN, stability: 3.8e38, emotionalValence: -Infinity },
      RANGES.memory,
    );
    expect(m).toEqual({ id: "m1", strength: 0, stability: 1e9, emotionalValence: -1 });
    expect(
      bounded({ affinity: -5, trust: 2, familiarity: Infinity, grudge: NaN }, RANGES.social),
    ).toEqual({ affinity: -1, trust: 1, familiarity: 1, grudge: 0 });
    expect(
      bounded(
        {
          progress: 1.0000001,
          motivation: -1,
          frustration: NaN,
          measured: Infinity,
          baseline: null,
        },
        RANGES.goal,
      ),
    ).toEqual({ progress: 1, motivation: 0, frustration: 0, measured: 1e12, baseline: null });
    expect(bounded({ level: Infinity, peak: 1e40, practiceMinutes: -3 }, RANGES.skill)).toEqual({
      level: 1,
      peak: 1,
      practiceMinutes: 0,
    });
    expect(bounded({ fidelity: 7 }, RANGES.loreHolder)).toEqual({ fidelity: 1 });
    expect(bounded({ score: Infinity }, RANGES.drama)).toEqual({ score: 100 });
    // Un parche parcial no gana columnas.
    expect(bounded({ strength: 0.5 }, RANGES.memory)).toEqual({ strength: 0.5 });
    expect(inRange(0.42, [0, 1])).toBe(0.42);
  });

  it("toda columna `real` de la simulación tiene su rango, y ninguno pasa del límite de `real`", () => {
    const covered: Record<string, Readonly<Record<string, readonly [number, number]>>> = {
      memories: RANGES.memory,
      memory_versions: RANGES.memoryVersion,
      social_profiles: RANGES.social,
      social_profile_history: RANGES.socialHistory,
      goals: RANGES.goal,
      skills: RANGES.skill,
      lore_holders: RANGES.loreHolder,
      dramas: RANGES.drama,
    };
    const tables = Object.values(schema).filter(
      (t): t is typeof schema.memories =>
        typeof t === "object" && t !== null && Symbol.for("drizzle:Name") in t,
    );
    let checked = 0;
    for (const table of tables) {
      const name = (table as unknown as Record<symbol, string>)[Symbol.for("drizzle:Name")]!;
      for (const [key, col] of Object.entries(getTableColumns(table))) {
        if (col.columnType !== "PgReal") continue;
        checked++;
        const range = covered[name]?.[key];
        expect(range, `${name}.${key}`).toBeDefined();
        expect(Math.abs(range![0])).toBeLessThan(REAL_MAX);
        expect(Math.abs(range![1])).toBeLessThan(REAL_MAX);
      }
    }
    expect(checked).toBeGreaterThan(10);
  });
});
