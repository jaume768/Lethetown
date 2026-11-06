/**
 * Mayúsculas en los textos que compone el código a partir de una etiqueta («Desayunar en casa»)
 * metida a media frase: «Suelo desayunar…», no «Suelo Desayunar…». La mayúscula de en medio
 * engaña al registro de conocimiento y al PersonGuard (corrección 3.5).
 */

/**
 * La etiqueta con la primera letra en minúscula, salvo que su primera palabra sea una sigla
 * («BUP»), un nombre propio que se pasa en `keep` («Mateo», «Palma») o una sola letra.
 */
export function lowerFirst(text: string, keep: ReadonlySet<string> = new Set()): string {
  const m = /^(\s*)(\p{L}[\p{L}\p{M}'’·]*)/u.exec(text);
  if (!m) return text;
  const word = m[2]!;
  if (word.length < 2 || !/\p{Lu}/u.test(word[0]!)) return text;
  // Una sigla (dos mayúsculas seguidas) o un nombre propio se quedan como están.
  if (/^\p{Lu}\p{Lu}/u.test(word) || keep.has(word)) return text;
  const at = m[1]!.length;
  return text.slice(0, at) + word[0]!.toLocaleLowerCase("es") + text.slice(at + 1);
}
