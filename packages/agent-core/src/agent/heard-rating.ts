import { looksLikeRumor } from "@lethetown/shared";
import type { MemoryConfig } from "../memory/config";

/**
 * Importancia y valencia de lo que se oye en una conversación en curso, por reglas (sin
 * llamar al LLM): una frase normal es poco importante; un rumor, una confesión o algo muy
 * emotivo, más. La valencia sale de palabras con carga; los signos de exclamación la acentúan.
 * Las palabras clave son una aproximación barata: lo que no recogen se queda en lo normal.
 */

const POSITIVE =
  /(gracias|genial|estupend|me encanta|me alegr|qué bien|que bien|felicidades|enhorabuena|te quiero|guap|precios|bonit|me gusta|encantad|perfecto|fantástic|maravill|me apetece|claro que sí|qué ilusión)/iu;
const NEGATIVE =
  /(odio|mentir|harto|harta|triste|murió|muerto|enfad|lo siento|perdón|perdona|roto|rota|asco|idiota|imbécil|cállate|déjame|no te soporto|miedo|preocupad|fatal|horrible|vergüenza|me duele|llorar|culpa|robad|despedid)/iu;
/** Cosas que importan (confesiones, cambios de vida, secretos): suben la importancia. */
const WEIGHTY =
  /(secreto|no se lo digas|no se lo cuentes|embarazad|me caso|boda|divorci|separ|me voy del pueblo|me mudo|enferm|hospital|despid|dejo el trabajo|te quiero|estoy enamorad|murió|muerto|accidente|robo|robad|policía)/iu;

export function rateHeard(
  text: string,
  cfg: MemoryConfig["heardRating"],
): { importance: number; valence: number } {
  const pos = POSITIVE.test(text);
  const neg = NEGATIVE.test(text);
  const bangs = Math.min(2, (text.match(/!/g) ?? []).length);
  const sign = pos === neg ? 0 : pos ? 1 : -1;
  const valence = sign * Math.min(1, cfg.wordValence + bangs * cfg.exclamationValence);
  let importance = cfg.base;
  if (looksLikeRumor(text)) importance += cfg.rumorBonus;
  if (WEIGHTY.test(text)) importance += cfg.weightyBonus;
  if (sign !== 0) importance += 1;
  return { importance: Math.min(cfg.max, importance), valence };
}
