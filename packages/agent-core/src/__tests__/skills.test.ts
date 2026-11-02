/** Habilidades (lógica pura): práctica, maestro, olvido, éxito, calidad y qué se practica. */
import { describe, expect, it } from "vitest";
import {
  SkillsConfig,
  practiceGain,
  qualityEffect,
  qualityLabel,
  resultQuality,
  skillAfterIdle,
  skillFloor,
  skillForActivity,
  successChance,
} from "../skills/skills";

const cfg = SkillsConfig.parse({});
const adult = { age: 40, openness: 0.5 };

/** Horas de práctica (de una en una) para pasar de `from` a `to`. */
function hoursTo(from: number, to: number, who = adult): number {
  let l = from;
  let h = 0;
  while (l < to && h < 1000) {
    l += practiceGain(l, 60, who, cfg);
    h++;
  }
  return h;
}

describe("práctica", () => {
  it("rendimientos decrecientes: cuanto más sabe, menos sube por hora", () => {
    expect(practiceGain(0, 60, adult, cfg)).toBeGreaterThan(practiceGain(0.5, 60, adult, cfg));
    expect(practiceGain(0.5, 60, adult, cfg)).toBeGreaterThan(practiceGain(0.9, 60, adult, cfg));
    // De 0 a 0,5, unas 35 h; de 0,5 a 0,75, otras tantas: no se llega a experto en una semana.
    expect(hoursTo(0, 0.5)).toBeGreaterThan(30);
    expect(hoursTo(0, 0.5)).toBeLessThan(40);
    expect(hoursTo(0.5, 0.75)).toBeGreaterThan(30);
  });

  it("no depende de cada cuánto se mida (5 min o una hora)", () => {
    let a = 0.2;
    for (let i = 0; i < 12; i++) a += practiceGain(a, 5, adult, cfg);
    const b = 0.2 + practiceGain(0.2, 60, adult, cfg);
    expect(a).toBeCloseTo(b, 6);
  });

  it("con un maestro que le saca ventaja, el doble; de joven, más; de mayor, menos", () => {
    const alone = practiceGain(0.1, 60, adult, cfg);
    expect(practiceGain(0.1, 60, { ...adult, masterLevel: 0.8 }, cfg)).toBeGreaterThan(1.9 * alone);
    // Un «maestro» que sabe casi lo mismo no ayuda.
    expect(practiceGain(0.1, 60, { ...adult, masterLevel: 0.2 }, cfg)).toBeCloseTo(alone);
    expect(practiceGain(0.1, 60, { age: 12, openness: 0.5 }, cfg)).toBeGreaterThan(alone);
    expect(practiceGain(0.1, 60, { age: 75, openness: 0.5 }, cfg)).toBeLessThan(alone);
    expect(practiceGain(0.1, 60, { age: 40, openness: 0.9 }, cfg)).toBeGreaterThan(alone);
  });
});

describe("olvido de habilidades", () => {
  it("con días de gracia, y luego despacio hacia un suelo", () => {
    expect(skillAfterIdle(0.6, 0.6, 2, 1, cfg)).toBe(0.6);
    const month = skillAfterIdle(0.6, 0.6, 33, 30, cfg);
    expect(month).toBeLessThan(0.6);
    expect(month).toBeGreaterThan(skillFloor(0.6, cfg));
    // Un mes sin practicar: pierde en torno a un cuarto de lo que tenía sobre el suelo.
    const lost = (0.6 - month) / (0.6 - skillFloor(0.6, cfg));
    expect(lost).toBeGreaterThan(0.2);
    expect(lost).toBeLessThan(0.3);
  });

  it("lo aprendido a fondo se pierde menos (suelo más alto en proporción)", () => {
    expect(skillFloor(0.9, cfg) / 0.9).toBeGreaterThan(skillFloor(0.3, cfg) / 0.3);
    const years = (x: number) => skillAfterIdle(x, x, 1000, 1000, cfg);
    expect(years(0.9)).toBeGreaterThan(0.6);
    expect(years(0.3)).toBeLessThan(0.15);
  });
});

describe("que importe", () => {
  it("arreglar: con nivel medio, como el 70 % de antes; sin saber, mucho menos", () => {
    expect(successChance(0, cfg)).toBeCloseTo(0.35);
    expect(successChance(0.6, cfg)).toBeCloseTo(0.71);
    expect(successChance(1, cfg)).toBeCloseTo(0.95);
  });

  it("calidad: sobre todo el nivel, algo de suerte; y lo que nota quien lo recibe", () => {
    expect(qualityLabel(resultQuality(0.9, 0.5, cfg))).toBe("muy bueno");
    expect(qualityLabel(resultQuality(0.1, 0.5, cfg))).toBe("regular");
    expect(resultQuality(0.5, 1, cfg)).toBeGreaterThan(resultQuality(0.5, 0, cfg));
    expect(qualityEffect(0.8, cfg).affinity).toBeGreaterThan(0);
    expect(qualityEffect(0.2, cfg).affinity).toBeLessThan(0);
  });
});

describe("qué se practica", () => {
  it("por el objeto que se usa y, si no, por las palabras de la actividad", () => {
    const of = (action: string, spotId?: string) => skillForActivity({ action, spotId }, cfg);
    expect(of("preparando un café", "cafetera")).toBe("hospitality");
    expect(of("horneando pan", "horno")).toBe("baking");
    expect(of("haciendo magdalenas")).toBe("baking");
    expect(of("haciendo fotos con carrete en la plaza")).toBe("photography");
    expect(of("pescando en el lago")).toBe("fishing");
    expect(of("regando los bancales")).toBe("gardening");
    expect(of("tocando la guitarra")).toBe("music");
    expect(of("dar clase")).toBe("teaching");
    expect(of("ir a clase")).toBeNull();
    expect(of("comprarse un pantalón")).toBeNull();
    expect(of("durmiendo")).toBeNull();
  });
});
