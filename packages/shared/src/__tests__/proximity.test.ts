import { describe, expect, it } from "vitest";
import { CellIndex, isNear, tileAt, tileDistance } from "../map/proximity";
import { COGNITION_OFF, parseCognitionEnv, resolveCognition } from "../cognition/config";

const still = { tile: { x: 3, y: 4 }, facing: "down" as const, movement: null };
const walking = {
  tile: { x: 0, y: 0 },
  facing: "right" as const,
  // 10 baldosas a la derecha y luego 10 hacia abajo, en 20 minutos.
  movement: {
    waypoints: [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ],
    startTime: 100,
    endTime: 120,
  },
};

describe("tileAt", () => {
  it("quieto: su baldosa", () => {
    expect(tileAt(still, 999)).toEqual({ x: 3, y: 4 });
  });

  it("caminando: la baldosa de su ruta en ese instante", () => {
    expect(tileAt(walking, 100)).toEqual({ x: 0, y: 0 });
    expect(tileAt(walking, 105)).toEqual({ x: 5, y: 0 });
    expect(tileAt(walking, 115)).toEqual({ x: 10, y: 5 });
    // Antes de salir y después de llegar, los extremos.
    expect(tileAt(walking, 50)).toEqual({ x: 0, y: 0 });
    expect(tileAt(walking, 500)).toEqual({ x: 10, y: 10 });
  });

  it("redondea a la baldosa más cercana a mitad de tramo", () => {
    expect(tileAt(walking, 101.6)).toEqual({ x: 2, y: 0 });
  });
});

describe("distancia", () => {
  it("euclídea en baldosas", () => {
    expect(tileDistance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
    expect(isNear({ x: 0, y: 0 }, { x: 3, y: 4 }, 5)).toBe(true);
    expect(isNear({ x: 0, y: 0 }, { x: 3, y: 4 }, 4)).toBe(false);
  });
});

describe("CellIndex", () => {
  it("encuentra a los cercanos sin compararlos con todos, ordenados", () => {
    const idx = new CellIndex(4);
    idx.add("a", { x: 0, y: 0 });
    idx.add("b", { x: 3, y: 0 });
    idx.add("c", { x: 0, y: 4 });
    idx.add("d", { x: 9, y: 9 });
    idx.add("e", { x: -3, y: 0 });
    expect(idx.near({ x: 0, y: 0 }, 4, "a")).toEqual([
      { id: "b", distance: 3 },
      { id: "e", distance: 3 },
      { id: "c", distance: 4 },
    ]);
    expect(idx.near({ x: 9, y: 9 }, 4, "d")).toEqual([]);
  });

  it("con un radio mayor que la celda mira más celdas", () => {
    const idx = new CellIndex(2);
    idx.add("a", { x: 0, y: 0 });
    idx.add("b", { x: 5, y: 0 });
    expect(idx.near({ x: 0, y: 0 }, 5, "a").map((n) => n.id)).toEqual(["b"]);
  });

  it("da lo mismo que comparar todos con todos", () => {
    const idx = new CellIndex(4);
    const pts = Array.from({ length: 60 }, (_, i) => ({
      id: `p${i}`,
      x: (i * 37) % 41,
      y: (i * 17) % 29,
    }));
    for (const p of pts) idx.add(p.id, p);
    for (const p of pts) {
      const brute = pts
        .filter((q) => q.id !== p.id && tileDistance(p, q) <= 4)
        .map((q) => q.id)
        .sort();
      expect(
        idx
          .near(p, 4, p.id)
          .map((n) => n.id)
          .sort(),
      ).toEqual(brute);
    }
  });
});

describe("cognition (interruptores)", () => {
  it("todo encendido por defecto", () => {
    const c = resolveCognition();
    expect(c.enabled && c.encounters && c.associations && c.stopToChat).toBe(true);
    expect(c.walkingTalk && c.talkWhileActivity).toBe(true);
    expect(c.params.nearRadius).toBe(4);
  });

  it("el general apagado apaga todo, aunque una capa encienda una parte", () => {
    const c = resolveCognition({ enabled: false }, { encounters: true });
    expect(c.encounters).toBe(false);
    expect(c).toEqual(COGNITION_OFF);
  });

  it("capas: el mundo manda sobre el entorno; parámetros combinados", () => {
    const c = resolveCognition(
      { walkingTalk: false, params: { nearRadius: 6 } },
      { walkingTalk: true, params: { pairCooldownMinutes: 30 } },
    );
    expect(c.walkingTalk).toBe(true);
    expect(c.params.nearRadius).toBe(6);
    expect(c.params.pairCooldownMinutes).toBe(30);
  });

  it("SIM_COGNITION: on, off o lista de partes", () => {
    expect(parseCognitionEnv(undefined)).toEqual({});
    expect(parseCognitionEnv("on")).toEqual({});
    expect(parseCognitionEnv("off")).toEqual({ enabled: false });
    expect(parseCognitionEnv("encounters=off, walkingTalk=on")).toEqual({
      encounters: false,
      walkingTalk: true,
    });
    expect(() => parseCognitionEnv("andar=off")).toThrow(/SIM_COGNITION/);
  });
});
