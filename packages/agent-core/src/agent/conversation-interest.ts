import type { MemoryConfig } from "../memory/config";
import { rateHeard } from "./heard-rating";

/**
 * ¿Sigue la charla? El máximo de seguridad de turnos ya no es fijo: pasado el normal
 * (`safetyMaxTurns`), sigue mientras aporte (algo nuevo, carga emocional o un acuerdo a medio
 * cerrar) hasta un máximo absoluto, y se corta antes si se están repitiendo. En la partida real
 * el tope fijo (12) cortó 16 de 204 charlas, algunas en pleno interés. Por reglas, sin LLM.
 */

/** Palabras de un acuerdo que se está cerrando («quedamos», «a las cinco», «te lo dejo»). */
const AGREEING =
  /(qued(amos|ar)|a las \w+|mañana|el (lunes|martes|miércoles|jueves|viernes|sábado|domingo)|te (lo |la )?(dejo|presto|devuelvo|regalo)|¿te vienes|¿vienes|nos vemos|¿a qué hora|¿dónde)/iu;

/** Palabras con contenido (sin tildes, en minúsculas, de 4 letras o más). */
function words(text: string): Set<string> {
  const folded = text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
  return new Set(folded.match(/\p{L}{4,}/gu) ?? []);
}

/** Parecido entre dos frases (Jaccard de sus palabras con contenido). */
export function similarity(a: string, b: string): number {
  const wa = words(a);
  const wb = words(b);
  if (!wa.size || !wb.size) return a.trim().toLowerCase() === b.trim().toLowerCase() ? 1 : 0;
  const shared = [...wa].filter((w) => wb.has(w)).length;
  return shared / (wa.size + wb.size - shared);
}

/** Qué parte de lo último son palabras que no habían salido en la charla. */
export function novelty(last: string, earlier: string[]): number {
  const seen = new Set(earlier.flatMap((l) => [...words(l)]));
  const mine = [...words(last)];
  return mine.length ? mine.filter((w) => !seen.has(w)).length / mine.length : 0;
}

/**
 * Motivo para acabar la charla antes de decir `lines.at(-1)` (la frase nueva), o null si sigue.
 * `lines`: lo dicho en orden (solo el texto); `turns`: turnos ya hechos; `members`: cuántos son.
 */
export function conversationEnd(
  lines: string[],
  turns: number,
  members: number,
  cfg: MemoryConfig["conversation"],
  heard: MemoryConfig["heardRating"],
): string | null {
  const extra = cfg.turnsPerExtraMember * Math.max(0, members - 2);
  const soft = cfg.safetyMaxTurns + extra;
  const hard = Math.max(soft, cfg.absoluteMaxTurns + extra);
  const last = lines.at(-1) ?? "";
  const earlier = lines.slice(0, -1);
  // Se repiten: las dos últimas frases se parecen mucho a algo ya dicho.
  const repeats = (i: number) =>
    lines.slice(0, i).some((l) => similarity(l, lines[i]!) >= cfg.repeatSimilarity);
  const n = lines.length;
  if (turns >= cfg.minTurnsBeforeRepeat && n >= 3 && repeats(n - 1) && repeats(n - 2)) {
    return "se estaban repitiendo";
  }
  if (turns >= hard) return `máximo absoluto (${hard} turnos)`;
  if (turns < soft) return null;
  const interesting =
    novelty(last, earlier) >= cfg.noveltyMin ||
    rateHeard(last, heard).importance >= cfg.interestImportance ||
    lines.slice(-2).some((l) => AGREEING.test(l));
  return interesting ? null : `ya no aportaba nada (${turns} turnos)`;
}
