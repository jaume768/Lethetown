import { describe, expect, it } from "vitest";
import { ambientAt } from "../index";

describe("ambientAt", () => {
  it("de día no hay velo ni luces; de noche sí", () => {
    expect(ambientAt(12 * 60)).toEqual({ tint: 0xffffff, alpha: 0, lights: 0 });
    const night = ambientAt(2 * 60);
    expect(night.alpha).toBeGreaterThan(0.5);
    expect(night.lights).toBe(1);
  });
  it("interpola en el amanecer y es cíclico por días", () => {
    const dawn = ambientAt(7 * 60);
    expect(dawn.alpha).toBeGreaterThan(0);
    expect(dawn.alpha).toBeLessThan(0.3);
    expect(ambientAt(3 * 1440 + 12 * 60)).toEqual(ambientAt(12 * 60));
  });
  it("la lluvia oscurece y enciende luces", () => {
    const rain = ambientAt(12 * 60, "rain");
    expect(rain.alpha).toBeGreaterThan(0.2);
    expect(rain.lights).toBeGreaterThan(0);
  });
});
