/** Generador de números aleatorios en [0, 1). Inyectable para que los tests sean deterministas. */
export type Rng = () => number;

/** mulberry32: pequeño PRNG con semilla. */
export function seededRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const estimateTextTokens = (text: string): number => Math.ceil(text.length / 4);
