import { describe, expect, it } from "vitest";
import type { SocialProfileChange } from "../schemas/memory";
import {
  affinityColor,
  affinityIcon,
  edgeWidth,
  filterEdges,
  isAsymmetric,
  layoutNetwork,
  networkAt,
  sparklinePath,
} from "../social/network";

const change = (
  ownerId: string,
  aboutId: string,
  at: number,
  affinity: number,
  relationshipType: SocialProfileChange["relationshipType"] = "neighbor",
): SocialProfileChange => ({
  ownerId,
  aboutId,
  at,
  affinity,
  trust: 0.5,
  familiarity: 0.5,
  relationshipType,
  reason: "x",
  eventId: null,
});

describe("red del pueblo", () => {
  const history = [
    change("a", "b", 0, 0.1),
    change("a", "b", 100, 0.6, "friendship"),
    change("b", "a", 50, -0.5, "rivalry"),
    change("c", "a", 200, 0.2),
  ];

  it("reconstruye la red en un instante con el último cambio de cada par", () => {
    expect(networkAt(history, 60)).toEqual([
      expect.objectContaining({ from: "a", to: "b", affinity: 0.1 }),
      expect.objectContaining({ from: "b", to: "a", affinity: -0.5, type: "rivalry" }),
    ]);
    expect(networkAt(history, 1000)).toHaveLength(3);
    expect(networkAt(history, 1000).find((e) => e.from === "a")?.type).toBe("friendship");
  });

  it("filtra por tipo de relación (vacío = todas)", () => {
    const edges = networkAt(history, 1000);
    expect(filterEdges(edges, new Set())).toHaveLength(3);
    expect(filterEdges(edges, new Set(["friendship"]))).toHaveLength(1);
  });

  it("colores, grosores, iconos y asimetría", () => {
    expect(affinityColor(0)).toBe("#969caa");
    expect(affinityColor(-1)).toBe("#d64550");
    expect(affinityColor(1)).toBe("#3ea868");
    expect(edgeWidth(0)).toBeLessThan(edgeWidth(1));
    expect([affinityIcon(0.5), affinityIcon(0), affinityIcon(-0.5)]).toEqual([
      "heart",
      "neutral",
      "anger",
    ]);
    expect(isAsymmetric(0.6, -0.5)).toBe(true);
    expect(isAsymmetric(0.6, 0.5)).toBe(false);
    expect(isAsymmetric(0.6, undefined)).toBe(false);
  });

  it("mini gráfica: trazado escalado", () => {
    const path = sparklinePath(
      [
        { at: 0, value: -1 },
        { at: 10, value: 1 },
      ],
      100,
      20,
    );
    expect(path).toBe("M 0.0 20.0 L 100.0 0.0");
    expect(sparklinePath([], 100, 20)).toBe("");
    expect(sparklinePath([{ at: 5, value: 0 }], 100, 20)).toBe("M 0 10.0 L 100.0 10.0");
  });

  it("layout determinista y dentro del lienzo; los que se tratan quedan más cerca", () => {
    const nodes = ["a", "b", "c", "d", "e", "f"];
    const edges = [
      {
        from: "a",
        to: "b",
        affinity: 0.9,
        trust: 0.5,
        familiarity: 1,
        type: "friendship" as const,
      },
    ];
    const p1 = layoutNetwork(nodes, edges, 400, 300);
    const p2 = layoutNetwork(nodes, edges, 400, 300);
    expect(p1).toEqual(p2);
    for (const { x, y } of Object.values(p1)) {
      expect(x).toBeGreaterThanOrEqual(40);
      expect(x).toBeLessThanOrEqual(360);
      expect(y).toBeGreaterThanOrEqual(40);
      expect(y).toBeLessThanOrEqual(260);
    }
    const d = (u: string, v: string) => Math.hypot(p1[u]!.x - p1[v]!.x, p1[u]!.y - p1[v]!.y);
    expect(d("a", "b")).toBeLessThan(d("a", "d"));
    // Ocupa todo el lienzo (de margen a margen).
    expect(Math.min(...Object.values(p1).map((p) => p.x))).toBeCloseTo(40);
    expect(Math.max(...Object.values(p1).map((p) => p.y))).toBeCloseTo(260);
  });
});
