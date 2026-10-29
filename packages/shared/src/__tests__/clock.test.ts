import { describe, expect, it } from "vitest";
import { ClockEstimator } from "../index";

/** x60: un minuto de juego por segundo real. */
const X60 = 60;

describe("ClockEstimator", () => {
  it("extrapola con la velocidad entre mensajes", () => {
    const c = new ClockEstimator();
    c.sync(100, X60, 0);
    expect(c.now(0)).toBe(100);
    expect(c.now(1500)).toBeCloseTo(101.5);
  });

  it("no retrocede cuando llega un tiempo atrasado (mensaje con retraso)", () => {
    const c = new ClockEstimator();
    c.sync(100, X60, 0);
    const before = c.now(1000); // 101
    // El servidor mandó 100.4 hace un rato: va por detrás de lo que ya se mostró.
    c.sync(100.4, X60, 1000);
    let prev = before;
    for (let t = 1000; t <= 4000; t += 16) {
      const v = c.now(t);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
    // Al final converge con el servidor (100.4 + 3 s a x60 = 103.4).
    expect(c.now(4000)).toBeCloseTo(103.4, 1);
  });

  it("al retrasarse avanza al menos a la mitad de la velocidad (no se queda parado)", () => {
    const c = new ClockEstimator();
    c.sync(100, X60, 0);
    c.now(1000);
    c.sync(100.5, X60, 1000);
    const a = c.now(1100);
    const b = c.now(1200);
    expect(b - a).toBeGreaterThanOrEqual((0.1 * X60) / 60 / 2 - 1e-9);
  });

  it("se adelanta poco a poco si va por detrás del servidor", () => {
    const c = new ClockEstimator();
    c.sync(100, X60, 0);
    c.sync(102, X60, 1000); // 1 min por delante de lo estimado (101)
    expect(c.now(1000)).toBeCloseTo(101);
    expect(c.now(1500)).toBeCloseTo(102); // 101 + 0.5 + la mitad de la corrección
    expect(c.now(2000)).toBeCloseTo(103);
  });

  it("al cambiar de velocidad mantiene la continuidad", () => {
    const c = new ClockEstimator();
    c.sync(100, 10, 0);
    const before = c.now(6000); // 101
    c.sync(101, 360, 6000);
    expect(c.now(6000)).toBeCloseTo(before);
    expect(c.now(7000)).toBeCloseTo(107);
  });

  it("en pausa se queda quieto y salta si la diferencia es muy grande", () => {
    const c = new ClockEstimator();
    c.sync(100, X60, 0);
    c.sync(100.2, 0, 1000); // pausa: el reloj ya iba por 101
    expect(c.now(5000)).toBeCloseTo(101);
    c.sync(10, X60, 6000); // otra instantánea, muy atrás
    expect(c.now(6000)).toBe(10);
  });
});
