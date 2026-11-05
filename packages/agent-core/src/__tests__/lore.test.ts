/** Saberes (lógica pura): deformación al contarse, refuerzo con el uso y olvido. */
import type { LoreElement } from "@lethetown/shared";
import { describe, expect, it } from "vitest";
import { LoreConfig, alterElement, forgetLore, knownByTown, transmit, useLore } from "../lore/lore";
import { seededRng } from "../util/random";

const cfg = LoreConfig.parse({});
const recipe: LoreElement[] = [
  {
    id: "e1",
    text: "harina de fuerza, cuatro huevos y un vaso de aceite",
    variants: ["harina normal, cuatro huevos y un vaso de aceite"],
  },
  { id: "e2", text: "la ralladura de un limón", variants: ["la ralladura de una naranja"] },
  { id: "e3", text: "batir los huevos con el azúcar hasta que blanqueen", variants: [] },
  { id: "e4", text: "reposar la masa una hora en la nevera", variants: [] },
  { id: "e5", text: "horno a 220 grados, doce minutos", variants: [] },
];
const full = recipe.map((e) => ({ id: e.id, text: e.text, altered: false }));

/** Media de lo que conserva quien escucha en muchas transmisiones. */
function meanKept(teller: { fidelity: number; skillLevel: number }, forgetfulness = 1, n = 400) {
  const rng = seededRng(3);
  let kept = 0;
  let fidelity = 0;
  for (let i = 0; i < n; i++) {
    const r = transmit({ elements: full, ...teller }, { forgetfulness }, recipe, rng, cfg);
    kept += r.elements.filter((e) => !e.altered).length;
    fidelity += r.fidelity;
  }
  return { kept: kept / n, fidelity: fidelity / n };
}

describe("al contarse se deforma", () => {
  it("quien lo sabe bien y tiene oficio casi no pierde nada; quien lo sabe a medias, mucho", () => {
    const julian = meanKept({ fidelity: 1, skillLevel: 0.85 });
    const vague = meanKept({ fidelity: 0.5, skillLevel: 0 });
    expect(julian.kept).toBeGreaterThan(4.8);
    expect(vague.kept).toBeLessThan(4.2);
    expect(vague.fidelity).toBeLessThan(julian.fidelity);
  });

  it("quien olvida más (su memoria) se queda con menos", () => {
    expect(meanKept({ fidelity: 0.7, skillLevel: 0 }, 2).kept).toBeLessThan(
      meanKept({ fidelity: 0.7, skillLevel: 0 }, 0.6).kept,
    );
  });

  it("de boca en boca, cinco veces sin oficio: la receta llega cambiada (teléfono roto)", () => {
    const rng = seededRng(11);
    let v = { elements: full, fidelity: 1, skillLevel: 0 };
    for (let i = 0; i < 5; i++) {
      const r = transmit(v, { forgetfulness: 1.2 }, recipe, rng, cfg);
      v = { elements: r.elements, fidelity: r.fidelity, skillLevel: 0 };
    }
    expect(v.fidelity).toBeLessThan(0.9);
    expect(v.elements.length < 5 || v.elements.some((e) => e.altered)).toBe(true);
  });

  it("los cambios salen de las variantes o de los números, sin inventar texto", () => {
    expect(alterElement("la ralladura de un limón", ["la ralladura de una naranja"], 0.2)).toBe(
      "la ralladura de una naranja",
    );
    expect(alterElement("horno a 220 grados, doce minutos", [], 0.9)).toBe(
      "horno a 275 grados, doce minutos",
    );
    expect(alterElement("cuatro huevos", [], 0.1)).toBe("cinco huevos");
    expect(alterElement("batir hasta que blanquee", [], 0.5)).toBeNull();
  });
});

describe("uso y olvido", () => {
  it("usarlo lo refuerza; sin usarlo, baja y se van elementos hasta no recordarlo", () => {
    expect(useLore(0.8, cfg)).toBeCloseTo(0.85);
    expect(useLore(0.98, cfg)).toBe(1);
    const rng = seededRng(5);
    let h = { fidelity: 0.9, elements: full };
    expect(forgetLore(h, 3, 1, 0, 5, rng, cfg).fidelity).toBe(0.9);
    let dropped = 0;
    for (let d = 0; d < 60; d++) {
      const r = forgetLore(h, 10 + d, 1, 0, 5, rng, cfg);
      if (r.dropped) dropped++;
      h = { fidelity: r.fidelity, elements: r.elements };
    }
    expect(dropped).toBeGreaterThan(1);
    expect(h.fidelity).toBeLessThan(cfg.minFidelity);
  });

  it("con oficio se olvida más despacio", () => {
    const rng = seededRng(1);
    const after = (skill: number) =>
      forgetLore({ fidelity: 0.9, elements: full }, 20, 30, skill, 5, rng, cfg).fidelity;
    expect(after(0.9)).toBeGreaterThan(after(0));
  });
});

describe("pérdida para el pueblo (corrección 3.5: no se ve en una semana)", () => {
  it("60–70 días sin que nadie lo use: ningún portador llega a 0,25 y se pierde", () => {
    const rng = seededRng(9);
    // Dos portadores (quien lo sabía y quien lo aprendió), algo de oficio, sin usarlo nunca.
    let holders = [
      { fidelity: 0.9, elements: full, skill: 0.3, forgotten: false },
      { fidelity: 0.8, elements: full.slice(0, 3), skill: 0, forgotten: false },
    ];
    const alive: Record<number, boolean> = {};
    for (let day = 1; day <= 70; day++) {
      holders = holders.map((h) => {
        if (h.forgotten) return h;
        const r = forgetLore(h, day, 1, h.skill, full.length, rng, cfg);
        return { ...h, ...r, forgotten: r.fidelity < cfg.minFidelity };
      });
      alive[day] = knownByTown(holders, cfg);
    }
    // En una semana (la partida de estudio) no se nota: sigue intacto.
    expect(alive[7]).toBe(true);
    expect(holders.every((h) => h.forgotten)).toBe(true);
    const lostOn = Number(Object.keys(alive).find((d) => !alive[Number(d)]));
    expect(lostOn).toBeGreaterThanOrEqual(55);
    expect(lostOn).toBeLessThanOrEqual(70);
  });
});
