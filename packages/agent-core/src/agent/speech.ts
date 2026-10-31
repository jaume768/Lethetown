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

/** Sin tildes ni mayúsculas (para reconocer una muletilla dicha de otra manera). */
const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

/**
 * La muletilla sin signos de los extremos («¡claro que sí!» → «claro que sí»). Con bucles y no
 * con `[…]+$`: esa expresión es cuadrática con muchos espacios seguidos (CodeQL, ReDoS).
 */
function core(phrase: string): string {
  let start = 0;
  let end = phrase.length;
  while (start < end && /[\s¡¿"«]/u.test(phrase[start]!)) start++;
  while (end > start && /[\s.!?…,"»]/u.test(phrase[end - 1]!)) end--;
  return phrase.slice(start, end);
}

/** Muletillas de la semilla que aparecen en algo de lo que ha dicho (en esta charla). */
export function usedCatchphrases(said: string[], catchphrases: string[]): string[] {
  const text = fold(said.join(" \n "));
  return catchphrases.filter((c) => core(c) && text.includes(fold(core(c))));
}

/**
 * Quita de una frase las muletillas que ya ha dicho en esta charla, sin romperla: se va la
 * muletilla con su puntuación y la frase empieza en mayúscula. Si no queda nada, se queda como
 * estaba (mejor repetirse que callarse). En la partida real, «¡claro que sí!» salió 24 veces.
 */
export function stripCatchphrases(text: string, used: string[]): string {
  let out = text;
  for (const phrase of used) {
    const target = fold(core(phrase));
    if (!target) continue;
    // Se busca sobre el texto sin tildes (misma longitud por carácter en español) y se corta
    // en el original.
    for (let i = fold(out).indexOf(target); i >= 0; i = fold(out).indexOf(target)) {
      let start = i;
      let end = i + target.length;
      while (start > 0 && /[¡¿"«\s]/u.test(out[start - 1]!)) start--;
      while (end < out.length && /[!?.,…"»]/u.test(out[end]!)) end++;
      out = `${out.slice(0, start)} ${out.slice(end)}`;
    }
  }
  // Primero un solo espacio entre palabras; luego, sin espacio antes de la puntuación (con `\s+`
  // delante de un signo la expresión sería cuadrática).
  const tidy = out
    .replace(/\s{2,}/g, " ")
    .replace(/ ([,.!?…])/gu, "$1")
    .replace(/^[\s,.;:…]+/u, "")
    .trim()
    .replace(/[,;:]$/u, ".");
  if (tidy.replace(/[\p{P}\s]/gu, "").length < 2) return text;
  return tidy.charAt(0).toLocaleUpperCase("es") + tidy.slice(1);
}

/** Máximo de caracteres de lo que dice este agente (los menores, como mucho el de media). */
export function speechMax(seed: AgentSeed, cfg: MemoryConfig["speech"]): number {
  const length = seed.speechStyle?.sentenceLength ?? "media";
  const max = cfg.maxChars[length];
  return seed.age < 18 ? Math.min(max, cfg.minorMaxChars) : max;
}
