import { describe, expect, it } from "vitest";
import { CharacterSheet, bubbleSeconds, pickFrame } from "../index";

const sheet = CharacterSheet.parse({
  image: "x.png",
  frameWidth: 16,
  frameHeight: 32,
  columns: 24,
  animations: {
    idle_right: { row: 1, start: 0, count: 6 },
    idle_down: { row: 1, start: 18, count: 6 },
    walk_right: { row: 2, start: 0, count: 6 },
    walk_down: { row: 2, start: 18, count: 6 },
    sit_right: { row: 5, start: 0, count: 6 },
    sit_left: { row: 5, start: 6, count: 6 },
  },
});
const base = {
  moving: false,
  distance: 0,
  facing: "down" as const,
  activityKind: "idle" as const,
  realSeconds: 0,
};

describe("pickFrame", () => {
  it("andando elige el frame por distancia recorrida (salta frames a alta velocidad)", () => {
    const a = pickFrame(sheet, { ...base, moving: true, facing: "right", distance: 0 });
    const b = pickFrame(sheet, { ...base, moving: true, facing: "right", distance: 0.5 });
    const c = pickFrame(sheet, { ...base, moving: true, facing: "right", distance: 2.6 });
    expect(a).toMatchObject({ key: "walk_right", frame: 2 * 24 + 0 });
    expect(b.frame).toBe(2 * 24 + 1);
    expect(c.frame).toBe(2 * 24 + 5);
  });

  it("si falta la dirección cae en otra animación", () => {
    expect(pickFrame(sheet, { ...base, moving: true, facing: "up" }).key).toBe("walk_down");
  });

  it("sentado usa sit_left/right según el lado", () => {
    expect(pickFrame(sheet, { ...base, activityKind: "sit", facing: "left" }).key).toBe("sit_left");
    expect(pickFrame(sheet, { ...base, activityKind: "sit", facing: "up" }).key).toBe("sit_right");
  });

  it("sin animación de dormir, tumba el primer frame de idle_down", () => {
    expect(pickFrame(sheet, { ...base, activityKind: "sleep", realSeconds: 9 })).toEqual({
      key: "idle_down",
      frame: 1 * 24 + 18,
      lying: true,
    });
  });

  it("quieto anima por tiempo real", () => {
    const f0 = pickFrame(sheet, { ...base, realSeconds: 0 }).frame;
    const f1 = pickFrame(sheet, { ...base, realSeconds: 1 / 8 }).frame;
    expect(f1).toBe(f0 + 1);
  });
});

describe("bubbleSeconds", () => {
  it("da tiempo a leer, con un mínimo y un máximo", () => {
    expect(bubbleSeconds("¡Hola!")).toBe(4);
    expect(bubbleSeconds("x".repeat(100))).toBeCloseTo(6.5);
    expect(bubbleSeconds("x".repeat(400))).toBe(9);
  });
});
