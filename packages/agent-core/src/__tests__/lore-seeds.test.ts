/**
 * Los saberes de las semillas al contarse (corrección 3.5): en la partida de una semana solo se
 * deformó 1 de 37 transmisiones (las variantes casi nunca estaban). Cada elemento tiene ahora
 * alguna variante y la probabilidad de cambio es algo mayor; el objetivo es un 10–20 % de
 * transmisiones con algún cambio, sin texto inventado.
 */
import { readFileSync } from "node:fs";
import { AgentSeed, type LoreElement } from "@lethetown/shared";
import { describe, expect, it } from "vitest";
import { LoreConfig, transmit } from "../lore/lore";
import { seededRng } from "../util/random";

const seeds = AgentSeed.array().parse(
  JSON.parse(readFileSync(new URL("../../../../seeds/agents.json", import.meta.url), "utf8")),
);
const cfg = LoreConfig.parse({});

/** Cada saber de partida, con quien lo sabe primero y su habilidad en eso. */
const lore = (() => {
  const seen = new Map<string, { elements: LoreElement[]; skill: number }>();
  for (const s of seeds) {
    for (const l of s.lore) {
      if (seen.has(l.title)) continue;
      seen.set(l.title, {
        elements: l.elements.map((e, i) => ({
          id: `e${i + 1}`,
          text: e.text,
          variants: e.variants,
        })),
        skill: l.skill ? (s.skills[l.skill] ?? 0) : 0,
      });
    }
  }
  return [...seen.values()];
})();

describe("saberes de las semillas", () => {
  it("cada elemento tiene al menos una variante", () => {
    for (const l of lore)
      for (const e of l.elements) expect(e.variants.length, e.text).toBeGreaterThan(0);
  });

  it("contados por quien los sabe (fidelidad de partida), un 10–20 % llega con algún cambio", () => {
    const rng = seededRng(7);
    let n = 0;
    let changed = 0;
    for (let round = 0; round < 40; round++) {
      for (const l of lore) {
        const held = l.elements.map((e) => ({ id: e.id, text: e.text, altered: false }));
        const r = transmit(
          { elements: held, fidelity: 0.9, skillLevel: l.skill },
          { forgetfulness: 1 },
          l.elements,
          rng,
          cfg,
        );
        n++;
        if (r.altered > 0) changed++;
        // Los cambios salen de las variantes (o de un número), nunca de texto nuevo.
        for (const e of r.elements.filter((x) => x.altered)) {
          const c = l.elements.find((x) => x.id === e.id)!;
          const fromVariant = c.variants.includes(e.text);
          expect(fromVariant || /\d/.test(e.text), e.text).toBe(true);
        }
      }
    }
    const rate = changed / n;
    expect(rate).toBeGreaterThanOrEqual(0.1);
    expect(rate).toBeLessThanOrEqual(0.2);
  });
});
