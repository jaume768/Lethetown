/** Tope de turnos según el interés de la charla y muletillas una vez por charla. */
import { describe, expect, it } from "vitest";
import { conversationEnd, novelty, similarity } from "../agent/conversation-interest";
import { stripCatchphrases, usedCatchphrases } from "../agent/speech";
import { MemoryConfig } from "../memory/config";

const cfg = MemoryConfig.parse({});
const end = (lines: string[], turns: number, members = 2) =>
  conversationEnd(lines, turns, members, cfg.conversation, cfg.heardRating);

const WHO = ["Carmen", "Mateo", "Julián", "Elena", "Tomás", "Pilar", "Andrés", "Sofía"];
const WHAT = ["perro", "gato", "bici", "cesta", "libro", "carro", "huerto", "molino"];

/** Charla de relleno con `n` frases distintas (sin repetirse) de cosas corrientes. */
const filler = (n: number) =>
  Array.from({ length: n }, (_, i) => `He visto a ${WHO[i % 8]} con ${WHAT[(i * 3) % 8]} hoy.`);

/** Una frase sin nada nuevo: solo palabras que ya han salido (y que no repite ninguna). */
const NOTHING_NEW = `Visto ${WHO[0]}, visto ${WHAT[3]}.`;

describe("tope de turnos según el interés", () => {
  it("antes de lo normal no corta", () => {
    expect(end(filler(5), 4)).toBeNull();
  });

  it("pasado lo normal, sigue si hay algo nuevo, carga emocional o un acuerdo a medias", () => {
    expect(end([...filler(12), NOTHING_NEW], 12)).toMatch(/ya no aportaba nada/);
    expect(end([...filler(12), "Oye, que el molino del río se ha inundado esta noche"], 12)).toBe(
      null,
    );
    expect(end([...filler(12), "Me caso en junio, ¡no se lo digas a nadie!"], 12)).toBeNull();
    expect(end([...filler(11), "¿Quedamos mañana?", NOTHING_NEW], 12)).toBeNull();
  });

  it("nunca pasa del máximo absoluto (más con más gente)", () => {
    const lively = (n: number) => [...filler(n), "¡Ha llegado un circo enorme al pueblo!"];
    expect(end(lively(30), 30)).toMatch(/máximo absoluto \(30 turnos\)/);
    expect(end(lively(30), 30, 3)).toBeNull();
  });

  it("se corta si se están repitiendo", () => {
    const loop = [
      ...filler(4),
      "Ya te lo pago, de verdad, mañana sin falta.",
      "Que sí, que me lo pagas mañana.",
      "Ya te lo pago, de verdad, mañana sin falta.",
      "Que sí, que me lo pagas mañana.",
    ];
    expect(end(loop, 7)).toBe("se estaban repitiendo");
    expect(end(loop.slice(0, 6), 5)).toBeNull();
  });

  it("parecido y novedad por palabras con contenido (sin tildes)", () => {
    expect(similarity("¿Qué tal la panadería?", "que tal la panaderia")).toBe(1);
    expect(novelty("la panadería cierra", ["la panadería abre"])).toBe(0.5);
  });
});

describe("muletillas, una vez por charla", () => {
  const phrases = ["¡claro que sí!", "ya te lo pago, de verdad"];

  it("reconoce las que ya ha dicho, aunque cambie tildes o mayúsculas", () => {
    expect(usedCatchphrases(["Claro que si, mujer.", "Hola"], phrases)).toEqual(["¡claro que sí!"]);
    expect(usedCatchphrases(["Hola"], phrases)).toEqual([]);
  });

  it("la quita de la frase sin romperla", () => {
    expect(stripCatchphrases("¡Claro que sí! Mañana voy.", ["¡claro que sí!"])).toBe("Mañana voy.");
    expect(stripCatchphrases("Vale, ya te lo pago, de verdad.", ["ya te lo pago, de verdad"])).toBe(
      "Vale.",
    );
    expect(stripCatchphrases("Pues claro que sí, hombre.", ["¡claro que sí!"])).toBe(
      "Pues hombre.",
    );
  });

  it("si solo era la muletilla, se queda como estaba", () => {
    expect(stripCatchphrases("¡Claro que sí!", ["¡claro que sí!"])).toBe("¡Claro que sí!");
  });
});
