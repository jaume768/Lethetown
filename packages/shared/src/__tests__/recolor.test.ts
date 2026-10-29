import { describe, expect, it } from "vitest";
import { paletteShift, recolorPalette, recolorPixels } from "../index";

describe("recolorPixels", () => {
  it("cambia solo los píxeles marcador visibles", () => {
    const data = new Uint8ClampedArray([
      255, 0, 0, 255, 0, 255, 0, 255, 255, 0, 0, 0, 10, 20, 30, 255,
    ]);
    const n = recolorPixels(
      data,
      { skin: "#ff00ff", hair: "#ff0000", shirt: "#00ff00", pants: "#0000ff" },
      { skin: "#f1c27d", hair: "#4a3020", shirt: "#3d6fb4", pants: "#2b2b3b" },
    );
    expect(n).toBe(2);
    expect([...data.slice(0, 4)]).toEqual([0x4a, 0x30, 0x20, 255]);
    expect([...data.slice(4, 8)]).toEqual([0x3d, 0x6f, 0xb4, 255]);
    expect([...data.slice(8, 12)]).toEqual([255, 0, 0, 0]);
    expect([...data.slice(12, 16)]).toEqual([10, 20, 30, 255]);
  });
});

describe("recolorPalette", () => {
  it("lleva el grupo al tono destino conservando el sombreado y respeta minY/maxY", () => {
    // Imagen de 1×4 con frames de 2 px de alto: y = 0, 1, 0, 1.
    const data = new Uint8ClampedArray([
      ...[0x80, 0x40, 0x40, 255], // pelo (referencia), y 0
      ...[0x40, 0x20, 0x20, 255], // pelo oscuro, y 1: fuera de maxY
      ...[0x40, 0x20, 0x20, 255], // y 0: sí cambia
      ...[0x10, 0x20, 0x30, 255], // no pertenece a ningún grupo
    ]);
    const n = recolorPalette(
      data,
      1,
      2,
      { hair: { colors: ["#804040", "#402020"], maxY: 0 } },
      { skin: "#f1c27d", hair: "#4060c0", shirt: "#3d6fb4", pants: "#2b2b3b" },
    );
    expect(n).toBe(2);
    const ref = [...data.slice(0, 3)];
    const dark = [...data.slice(8, 11)];
    // Azul (como el destino) y más oscuro el que ya lo era.
    expect(ref[2]!).toBeGreaterThan(ref[0]!);
    expect(dark[2]!).toBeGreaterThan(dark[0]!);
    expect(dark[2]!).toBeLessThan(ref[2]!);
    expect([...data.slice(4, 8)]).toEqual([0x40, 0x20, 0x20, 255]);
    expect([...data.slice(12, 16)]).toEqual([0x10, 0x20, 0x30, 255]);
  });

  it("paletteShift deja la referencia en el color destino", () => {
    const t = paletteShift(["#804040", "#402020"], "#3366cc");
    const [r, g, b] = t.get("#804040")!;
    expect(Math.abs(r - 0x33) + Math.abs(g - 0x66) + Math.abs(b - 0xcc)).toBeLessThanOrEqual(3);
  });
});
