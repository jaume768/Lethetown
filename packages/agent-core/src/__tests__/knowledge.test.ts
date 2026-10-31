/** Perfiles de conocimiento de las semillas: todos tienen uno y encaja con su vida en 1996. */
import { readFileSync } from "node:fs";
import { AgentSeed } from "@lethetown/shared";
import { describe, expect, it } from "vitest";
import { identityPrompt, knowledgeLine } from "../agent/prompts";

const seeds = AgentSeed.array().parse(
  JSON.parse(readFileSync(new URL("../../../../seeds/agents.json", import.meta.url), "utf8")),
);
const byId = Object.fromEntries(seeds.map((s) => [s.id, s]));

/** Raíces de palabras de 5+ letras (sin tildes), para ver si dos textos hablan de lo mismo. */
const stems = (text: string) =>
  new Set(
    text
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .toLowerCase()
      .split(/[^a-zñ]+/)
      .filter((w) => w.length >= 5)
      .map((w) => w.slice(0, 5)),
  );

describe("perfil de conocimiento", () => {
  it("cada agente tiene perfil, con al menos un idioma, y va al prompt fijo", () => {
    for (const s of seeds) {
      expect(s.knowledge, s.id).toBeDefined();
      expect(s.knowledge!.languages.length, s.id).toBeGreaterThan(0);
      expect(identityPrompt(s, [])).toContain(knowledgeLine(s.knowledge));
    }
  });

  it("el oficio encaja con la descripción (comparten alguna palabra)", () => {
    for (const s of seeds) {
      const k = s.knowledge!;
      // Sin trabajo ni oficio en la descripción (Aurora, 82): que no se invente uno de ahora.
      if (!s.workId && s.age >= 75) {
        expect(k.occupation, s.id).toMatch(/jubilad|ama de casa|campo/);
        continue;
      }
      const desc = stems(`${s.description} ${s.workId ?? ""}`);
      const own = [...stems(`${k.occupation} ${k.studies}`)];
      expect(
        own.some((w) => desc.has(w)),
        `${s.id}: «${k.occupation}» no sale de «${s.description}»`,
      ).toBe(true);
    }
  });

  it("los menores estudian y no tienen estudios superiores; los mayores, poca escuela", () => {
    for (const s of seeds) {
      const k = s.knowledge!;
      if (s.age < 18) {
        expect(k.studies, s.id).toMatch(/EGB|BUP/);
        expect(k.studies, s.id).not.toMatch(/universidad|Medicina|Derecho|Letras/i);
      }
      if (s.age >= 75) expect(k.studies, s.id).not.toMatch(/universidad|UIB|Magisterio/i);
    }
  });

  it("casos concretos: Leo, Aurora, Samuel, Andrés", () => {
    expect(byId.leo!.knowledge!).toMatchObject({ culture: "básico" });
    expect(byId.leo!.knowledge!.studies).toMatch(/EGB/);
    expect(byId.aurora!.knowledge!.interests.join(" ")).toMatch(/guerra|juventud/);
    expect(byId.samuel!.knowledge!.languages).toEqual(
      expect.arrayContaining(["inglés", "castellano"]),
    );
    expect(byId.samuel!.knowledge!.places.join(" ")).toMatch(/Lagos/);
    expect(byId.andres!.knowledge!.studies).toMatch(/Biblioteconomía/);
  });

  it("nada posterior a 1996 en los perfiles", () => {
    const text = JSON.stringify(seeds.map((s) => s.knowledge));
    expect(text).not.toMatch(/internet|móvil|ordenador|euro|digital|redes sociales/i);
  });
});
