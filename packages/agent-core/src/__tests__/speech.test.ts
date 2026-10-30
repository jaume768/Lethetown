import { AgentSeed, parseTiledMap } from "@lethetown/shared";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { toDecision } from "../agent/agent-decision";
import { DecideResponse } from "../agent/parse";
import { identityPrompt, speechLine } from "../agent/prompts";
import { clipText, speechMax } from "../agent/speech";
import { DEFAULT_MEMORY_CONFIG } from "../memory/config";

const cfg = DEFAULT_MEMORY_CONFIG.speech;
const seed = (age: number, sentenceLength: "corta" | "media" | "larga") =>
  AgentSeed.parse({
    id: "x",
    name: "X",
    age,
    traits: [],
    description: "",
    homeId: "casa_azul",
    speechStyle: { register: "coloquial", sentenceLength },
  });

describe("tope del habla", () => {
  it("recorta en el último final de frase que cabe", () => {
    expect(clipText("Vale. Pues mañana te lo cuento todo con calma, que hoy no puedo.", 30)).toBe(
      "Vale.",
    );
    expect(clipText("¿Y eso? No me lo esperaba de ti, la verdad, ni de lejos.", 40)).toBe(
      "¿Y eso?",
    );
  });

  it("sin final de frase, recorta en una palabra con puntos suspensivos", () => {
    expect(clipText("pues mira yo creo que deberíamos ir todos juntos a la feria", 25)).toBe(
      "pues mira yo creo que…",
    );
  });

  it("lo que cabe no se toca", () => {
    expect(clipText("  Ni de broma.  ", 90)).toBe("Ni de broma.");
  });

  it("límite según sentenceLength y más corto para menores", () => {
    expect(speechMax(seed(40, "corta"), cfg)).toBe(90);
    expect(speechMax(seed(40, "media"), cfg)).toBe(160);
    expect(speechMax(seed(40, "larga"), cfg)).toBe(240);
    expect(speechMax(seed(12, "larga"), cfg)).toBe(cfg.minorMaxChars);
  });

  it("toDecision recorta lo que dice y el porqué", () => {
    const long = "Bueno. " + "bla ".repeat(100);
    const d = toDecision(
      DecideResponse.parse({
        choice: "act",
        action: { type: "say", to: "lucia", text: long },
        reason: long,
      }),
      { say: 90, reason: 120 },
    );
    expect(d.kind).toBe("act");
    if (d.kind !== "act" || d.action.type !== "say") return;
    expect(d.action.text).toBe("Bueno.");
    expect(d.reason).toBe("Bueno.");
  });
});

describe("habla natural en el prompt fijo", () => {
  const places = parseTiledMap(
    JSON.parse(readFileSync(new URL("../../../../seeds/town.tmj", import.meta.url), "utf8")),
  ).places;

  it("reglas de habla oral con réplicas cortas de ejemplo", () => {
    const p = identityPrompt(seed(40, "media"), places);
    expect(p).toMatch(/No saludes en cada turno/);
    expect(p).toMatch(/«Ni de broma\.»/);
    expect(p).toMatch(/say .*réplica corta/);
  });

  it("sentenceLength en frases y menores con frases de su edad", () => {
    expect(
      speechLine({ register: "r", sentenceLength: "corta", catchphrases: [], topics: [] }),
    ).toMatch(/una frase corta o menos/);
    expect(identityPrompt(seed(12, "media"), places)).toMatch(/Tienes 12 años: hablas como/);
    expect(identityPrompt(seed(40, "media"), places)).not.toMatch(/hablas como alguien de tu edad/);
  });
});
