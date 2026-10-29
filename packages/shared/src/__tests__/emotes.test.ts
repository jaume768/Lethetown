import { describe, expect, it } from "vitest";
import { agentBadge, emoteFor, emoteForMemoryEffect, type AgentState } from "../index";

const s = (activityKind: string, valence = 0) =>
  ({ activityKind, mood: { valence, label: "" } }) as Parameters<typeof emoteFor>[0];

describe("emotes", () => {
  it("pensando tiene prioridad sobre todo", () => {
    expect(emoteFor(s("sleep", 0.9), { thinking: true })).toBe("dots");
  });
  it("dormir > ánimo > actividad", () => {
    expect(emoteFor(s("sleep", -0.9), { thinking: false })).toBe("zzz");
    expect(emoteFor(s("eat", 0.8), { thinking: false })).toBe("heart");
    expect(emoteFor(s("eat", -0.6), { thinking: false })).toBe("anger");
    expect(emoteFor(s("eat"), { thinking: false })).toBe("cup");
    expect(emoteFor(s("walk"), { thinking: false })).toBeNull();
  });
  it("efectos de memoria", () => {
    expect(emoteForMemoryEffect("vague")).toBe("cloud");
    expect(emoteForMemoryEffect("consolidate")).toBe("idea");
    expect(emoteForMemoryEffect("forget")).toBeNull();
  });
});

describe("indicador del mapa", () => {
  const plan = [
    {
      startMinute: 600,
      durationMin: 80,
      activity: "cita con Mateo: café",
      activityKind: "eat",
      placeId: "cafe_ola",
      spotId: null,
    },
    {
      startMinute: 700,
      durationMin: 60,
      activity: "pasear",
      activityKind: "walk",
      placeId: "parque",
      spotId: null,
    },
  ] as AgentState["plan"];
  it("cita si toca un bloque de cita; si no, acompañando; si no, nada", () => {
    expect(agentBadge({ plan, companionId: "lucia" }, 1440 + 620)).toBe("meeting");
    expect(agentBadge({ plan, companionId: "lucia" }, 1440 + 690)).toBe("companion");
    expect(agentBadge({ plan, companionId: null }, 1440 + 690)).toBeNull();
  });
});
