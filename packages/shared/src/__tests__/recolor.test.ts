import { describe, expect, it } from "vitest";
import { recolorPixels } from "../index";

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
