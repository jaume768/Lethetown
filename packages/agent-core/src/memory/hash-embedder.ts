import type { Embedder } from "./types";

/**
 * Embedding determinista sin red ("hashing trick" sobre palabras y trigramas).
 * No entiende sinónimos, pero textos con palabras en común quedan cerca: suficiente
 * para tests y como respaldo cuando no se puede descargar el modelo local.
 */
export class HashEmbedder implements Embedder {
  readonly name = "hash";

  constructor(readonly dim = 384) {}

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((t) => this.embedOne(t));
  }

  private embedOne(text: string): number[] {
    const v = new Array<number>(this.dim).fill(0);
    const words = text
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .split(/[^a-z0-9ñ]+/)
      .filter((w) => w.length > 2);
    for (const word of words) {
      v[fnv1a(word) % this.dim]! += 1;
      for (let i = 0; i + 3 <= word.length; i++) {
        v[fnv1a(word.slice(i, i + 3)) % this.dim]! += 0.3;
      }
    }
    const norm = Math.hypot(...v) || 1;
    return v.map((x) => x / norm);
  }
}

function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
