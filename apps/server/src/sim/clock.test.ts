import { describe, expect, it } from "vitest";
import { GameClock } from "./clock";

describe("GameClock", () => {
  it("runUntil ejecuta los eventos en orden de tiempo de juego", async () => {
    const clock = new GameClock(0, 10);
    const seen: string[] = [];
    clock.schedule(30, () => void seen.push("b"));
    clock.schedule(10, () => void seen.push("a"));
    clock.schedule(90, () => void seen.push("c"));
    await clock.runUntil(60);
    expect(seen).toEqual(["a", "b"]);
    expect(clock.now()).toBe(60);
    expect(clock.pending).toBe(1);
  });

  it("los eventos pueden programar otros eventos", async () => {
    const clock = new GameClock(0, 10);
    let ticks = 0;
    const tick = () => {
      ticks++;
      clock.schedule(clock.now() + 10, tick);
    };
    clock.schedule(0, tick);
    await clock.runUntil(100);
    expect(ticks).toBe(11);
  });

  it("el tiempo avanza según el multiplicador y se congela en pausa", () => {
    let real = 0;
    const clock = new GameClock(100, 60, undefined, () => real);
    clock.start();
    real = 60_000; // 1 minuto real a x60 = 60 minutos de juego
    expect(clock.now()).toBeCloseTo(160);
    clock.setSpeed(0);
    real = 120_000;
    expect(clock.now()).toBeCloseTo(160);
    clock.setSpeed(360);
    real = 130_000; // 10 s reales a x360 = 60 minutos
    expect(clock.now()).toBeCloseTo(220);
    clock.stop();
  });

  it("el tope frena el ritmo sin cambiar la velocidad elegida (conversaciones a x10)", () => {
    let real = 0;
    const clock = new GameClock(
      0,
      60,
      () => {},
      () => real,
    );
    clock.start();
    real = 60_000;
    expect(clock.now()).toBe(60);
    clock.setCap(10);
    expect(clock.speed).toBe(60);
    expect(clock.rate).toBe(10);
    real = 120_000;
    expect(clock.now()).toBe(70);
    clock.setCap(null);
    real = 180_000;
    expect(clock.now()).toBe(130);
    // Por debajo del tope no cambia nada.
    clock.setSpeed(1);
    clock.setCap(10);
    expect(clock.rate).toBe(1);
    clock.stop();
  });
});
