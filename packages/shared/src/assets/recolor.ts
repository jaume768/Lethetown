import type { Appearance } from "../schemas/agent";

const rgb = (hex: string): [number, number, number] => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
];

/**
 * Sustituye en un buffer RGBA los colores marcador por los del aspecto del agente.
 * Pura (sin canvas) para poder testearla; el cliente la aplica sobre getImageData().
 */
export function recolorPixels(
  data: Uint8ClampedArray | Uint8Array,
  markers: Record<"skin" | "hair" | "shirt" | "pants", string>,
  appearance: Pick<Appearance, "skin" | "hair" | "shirt" | "pants">,
): number {
  const table = (["skin", "hair", "shirt", "pants"] as const).map(
    (k) => [rgb(markers[k]), rgb(appearance[k])] as const,
  );
  let changed = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    for (const [from, to] of table) {
      if (data[i] === from[0] && data[i + 1] === from[1] && data[i + 2] === from[2]) {
        data[i] = to[0];
        data[i + 1] = to[1];
        data[i + 2] = to[2];
        changed++;
        break;
      }
    }
  }
  return changed;
}
