import { describe, expect, it } from "vitest";
import { emoteFor, emoteForMemoryEffect } from "../index";

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
