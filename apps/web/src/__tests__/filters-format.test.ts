import { SocialProfile, type RelationshipEntry, type ScoredMemoryView } from "@lethetown/shared";
import { describe, expect, it } from "vitest";
import { filterByName, filterMemories, filterRelationships, fold } from "../ui/filters";
import { formatGameTime, formatMinuteOfDay, formatUsd } from "../ui/format";

const mem = (id: string, over: Record<string, unknown> = {}, clarity = "clear") =>
  ({
    memory: { id, people: [], placeId: null, status: "active", ...over },
    scores: { clarity },
  }) as unknown as ScoredMemoryView;

const rel = (name: string, type: SocialProfile["relationshipType"]): RelationshipEntry => ({
  name,
  profile: SocialProfile.parse({
    ownerId: "a",
    aboutId: name,
    summary: "",
    affinity: 0,
    trust: 0.5,
    relationshipType: type,
    lastUpdated: 0,
  }),
  reciprocal: null,
  trend: [],
});

describe("filtros de los paneles", () => {
  it("búsqueda sin tildes ni mayúsculas", () => {
    expect(fold("Inés ORTEGA")).toBe("ines ortega");
    expect(filterByName([{ name: "Inés" }, { name: "Leo" }], " ines ")).toEqual([{ name: "Inés" }]);
  });

  it("jardín de recuerdos: activos, sin olvidados salvo que se pidan, por persona y lugar", () => {
    const list = [
      mem("a", { people: ["mateo"], placeId: "cafe" }),
      mem("b", { status: "archived" }),
      mem("c", {}, "forgotten"),
      mem("d", { placeId: "plaza" }),
    ];
    const ids = (f: Parameters<typeof filterMemories>[1]) =>
      filterMemories(list, f).map((m) => m.memory.id);
    expect(ids({ person: "", place: "", showForgotten: false })).toEqual(["a", "d"]);
    expect(ids({ person: "", place: "", showForgotten: true })).toEqual(["a", "c", "d"]);
    expect(ids({ person: "mateo", place: "", showForgotten: false })).toEqual(["a"]);
    expect(ids({ person: "", place: "plaza", showForgotten: false })).toEqual(["d"]);
  });

  it("relaciones por tipo y nombre", () => {
    const list = [
      rel("Marta Gil", "friendship"),
      rel("Mateo Ruiz", "rivalry"),
      rel("Leo Gil", "family"),
    ];
    expect(filterRelationships(list, "", "family").map((r) => r.name)).toEqual(["Leo Gil"]);
    expect(filterRelationships(list, "gil", "").map((r) => r.name)).toEqual([
      "Marta Gil",
      "Leo Gil",
    ]);
  });
});

describe("formatos", () => {
  it("horas, día de juego y costes", () => {
    expect(formatMinuteOfDay(7 * 60 + 5)).toBe("07:05");
    expect(formatGameTime(1440 + 9 * 60 + 30)).toMatch(/1 · 09:30$/);
    expect(formatUsd(0.004)).toBe("$0.00400");
    expect(formatUsd(1.5)).toBe("$1.500");
  });
});
