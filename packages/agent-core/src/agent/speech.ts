import type { AgentSeed } from "@lethetown/shared";
import type { MemoryConfig } from "../memory/config";

/**
 * Tope en código de lo que se dice: aunque el prompt pida frases cortas, el modelo a veces se
 * enrolla. Se recorta en el último final de frase que quepa; si no hay, en una palabra (con
 * "…"). Los límites (caracteres) según `sentenceLength`, en `MemoryConfig.speech`.
 */
export function clipText(text: string, max: number): string {
  const t = text.trim();
  if (t.length <= max) return t;
  const head = t.slice(0, max);
  // Último final de frase (., !, ?, …), con las comillas o paréntesis que lo cierren.
  const ends = [...head.matchAll(/[.!?…]+["»”)]*(?=\s|$)/gu)];
  const last = ends.at(-1);
  if (last && last.index + last[0].length >= 2) return head.slice(0, last.index + last[0].length);
  const space = head.lastIndexOf(" ");
  const cut = (space > 0 ? head.slice(0, space) : head).replace(/[\s,;:¿¡-]+$/u, "");
  return `${cut}…`;
}

/** Máximo de caracteres de lo que dice este agente (los menores, como mucho el de media). */
export function speechMax(seed: AgentSeed, cfg: MemoryConfig["speech"]): number {
  const length = seed.speechStyle?.sentenceLength ?? "media";
  const max = cfg.maxChars[length];
  return seed.age < 18 ? Math.min(max, cfg.minorMaxChars) : max;
}
