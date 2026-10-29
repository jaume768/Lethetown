import { describe, expect, it } from "vitest";
import { WEATHER_LOOK, Weather, ambientAt, exposedTo } from "../index";

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

describe("WEATHER_LOOK", () => {
  it("cada tiempo tiene su aspecto: tormenta más oscura que lluvia, nieve con copos", () => {
    const rain = ambientAt(12 * 60, "rain");
    const storm = ambientAt(12 * 60, "storm");
    expect(storm.alpha).toBeGreaterThan(rain.alpha);
    expect(WEATHER_LOOK.storm.flashEvery).toBeGreaterThan(0);
    expect(WEATHER_LOOK.snow.particles.kind).toBe("flake");
    expect(WEATHER_LOOK.fog.fog).toBeGreaterThan(0);
    expect(ambientAt(12 * 60, "heat").tint).not.toBe(0xffffff);
    for (const w of Weather.options) expect(WEATHER_LOOK[w], w).toBeDefined();
  });
});

describe("exposedTo", () => {
  it("bajo techo nunca; a cubierto sirve para lluvia y calor pero no para tormenta o nieve", () => {
    expect(exposedTo("rain", true)).toBe(false);
    expect(exposedTo("rain", false)).toBe(true);
    expect(exposedTo("rain", false, true)).toBe(false);
    expect(exposedTo("heat", false, true)).toBe(false);
    expect(exposedTo("storm", false, true)).toBe(true);
    expect(exposedTo("snow", false, true)).toBe(true);
    expect(exposedTo("sunny", false)).toBe(false);
    expect(exposedTo("fog", false)).toBe(false);
  });
});
