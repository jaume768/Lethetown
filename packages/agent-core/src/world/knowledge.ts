/**
 * Detector de conocimiento externo (lógica pura, sin LLM): anacronismos (léxico posterior a la
 * época, lista de la biblia) y nombres propios de fuera que no están en el glosario, ni son
 * vecinos ni lugares del pueblo, ni referencias comunes de la época, ni encajan con el perfil de
 * quien habla. Es una heurística para registrar y revisar, no para bloquear. Sin expresiones
 * regulares sobre el texto entero (todo por palabras: lineal).
 */
import type { AgentSeed } from "@lethetown/shared";
import type { WorldBible } from "./bible";

/** Minúsculas, sin tildes (salvo la ñ) y solo letras y cifras separadas por espacios. */
export function normalizeText(text: string): string {
  // La ñ se aparta antes de quitar las tildes (con NFD sería n + virgulilla).
  return text
    .toLowerCase()
    .split("ñ")
    .map((part) => part.normalize("NFD").replace(/\p{M}/gu, ""))
    .join("ñ")
    .replace(/[^a-z0-9ñ]+/g, " ")
    .trim();
}

const words = (text: string) => normalizeText(text).split(" ").filter(Boolean);

/** Palabras que van en mayúscula a media frase sin ser un nombre de fuera. */
const CAPITALIZED_COMMON = new Set(
  words(
    "Don Doña Señor Señora Señorita Sr Sra San Santa Sant Santo Dios Virgen Usted Ustedes Doctor Doctora Alcaldesa Alcalde Padre Madre Tío Tía Abuela Abuelo Ayuntamiento Plaza Mayor Calle Casa Navidad Nochebuena Reyes Pascua Semana Santa Carnaval Lunes Martes Miércoles Jueves Viernes Sábado Domingo OK Vale Ah Oh Eh Ay Uy Bah Jo Hola Buenas Bueno Pues Claro Mira Oye Venga Gracias Perdón",
  ),
);
/**
 * Palabras corrientes que suelen abrir una frase (y a veces van detrás de un id o de otra frase
 * sin punto): con mayúscula no son un nombre. El resto lo aprende el detector de lo que lee.
 */
const COMMON_WORDS = words(
  "Tienes Tengo Tiene Tenemos Bastante Buenos Buenas Entre Por Para Según Deberíamos Debería Hija Hijo Hombre Mujer Vaya Pero Porque Aunque Cuando Donde Como Cómo Qué Quién Cuál Cuánto Esto Eso Aquello Este Esta Ese Esa Aquí Allí Ahora Luego Después Antes Hoy Ayer Mañana Siempre Nunca Ya Muy Mucho Poco Nada Todo Algo Alguien Nadie Sí No Yo Tú Él Ella Nosotros Vosotros Ellos Mi Tu Su Me Te Se Lo La Le Los Las Les Un Una Unos Unas El En Con Sin Sobre Tras Hasta Desde Hacia Al Del Es Son Era Fue Está Están Estoy Estaba Hay Había Voy Vas Va Vamos Hace Hacía Hago Puedo Puedes Quiero Quieres Creo Sé Sabes Dime Cuéntame Mira Oye Escucha Perdona Disculpa Gracias Vale Venga Anda Ojalá Quizá Quizás Igual Menos Más También Tampoco Entonces Además Bien Mal Claro Pues Bueno Total Encima Otra Otro Cada Ninguno Ninguna Cualquier Demasiado Seguro Verdad Mentira Juntos Solo Sola Casi Justo Hola Adiós Buen Gran Nuevo Nueva Viejo Vieja Primero Último Lo Mejor Peor Ni Ay Uy Oh Ah Eh Jo Bah Ole Ojo",
);

/** Conectores dentro de un nombre ("Diario de Mallorca", "Son Sant Joan"). */
const CONNECTORS = new Set(["de", "del", "la", "las", "los", "el", "y", "i", "les", "d"]);
/** Signos tras los que empieza una frase (la mayúscula no indica nombre propio). */
const SENTENCE_START = new Set([
  ".",
  "!",
  "?",
  "¡",
  "¿",
  "«",
  '"',
  "“",
  ":",
  ";",
  "—",
  "-",
  "…",
  "(",
  "\n",
]);

export interface Anachronism {
  term: string;
  label: string;
}

export interface KnowledgeDetectorOptions {
  /** Vecinos (sus nombres y apellidos no son de fuera). */
  neighbors: Pick<AgentSeed, "name">[];
  /** Nombres de los lugares del pueblo. */
  places: string[];
  /** Textos de los que aprender el vocabulario corriente (descripciones, recuerdos iniciales). */
  vocabulary?: string[];
}

/** Palabras que empiezan en minúscula (palabras corrientes, no nombres). */
function lowercaseWords(text: string): string[] {
  const out: string[] = [];
  for (const w of text.split(/[^\p{L}\p{M}]+/u)) {
    if (w.length >= 2 && /\p{Ll}/u.test(w[0]!)) out.push(normalizeText(w));
  }
  return out;
}

/** Lo que sabe un agente, como conjunto de palabras (para comparar nombres propios). */
function profileWords(seed: Pick<AgentSeed, "knowledge">): Set<string> {
  const k = seed.knowledge;
  if (!k) return new Set();
  return new Set(
    words([k.studies, k.occupation, ...k.languages, ...k.places, ...k.interests].join(" ")),
  );
}

export class KnowledgeDetector {
  private readonly terms: { words: string[]; prefix: boolean; label: string; term: string }[];
  /** Palabras de lo que existe en la simulación o lo sabe cualquiera en la época. */
  private readonly known: Set<string>;
  private readonly profiles = new WeakMap<object, Set<string>>();
  /** Vocabulario corriente: lo que se ha visto en minúscula (con mayúscula, abre una frase). */
  private readonly lower = new Set<string>(COMMON_WORDS);

  constructor(bible: WorldBible, opts: KnowledgeDetectorOptions) {
    for (const t of opts.vocabulary ?? []) this.observe(t);
    this.terms = bible.anachronisms.map((a) => {
      const prefix = a.term.endsWith("*");
      return { words: words(a.term), prefix, label: a.label, term: a.term.replace(/\*$/, "") };
    });
    this.known = new Set(
      words(
        [
          bible.town,
          bible.city.name,
          ...bible.glossary.map((g) => g.term),
          ...bible.commonReferences,
          ...opts.places,
          ...opts.neighbors.map((n) => n.name),
        ].join(" "),
      ),
    );
  }

  /** Anacronismos del texto (cada término, una vez). */
  anachronisms(text: string): Anachronism[] {
    const ws = words(text);
    const found = new Map<string, Anachronism>();
    for (const t of this.terms) {
      const n = t.words.length;
      for (let i = 0; i + n <= ws.length; i++) {
        let ok = true;
        for (let j = 0; j < n && ok; j++) {
          const w = ws[i + j]!;
          const last = j === n - 1;
          ok = last && t.prefix ? w.startsWith(t.words[j]!) : w === t.words[j];
        }
        if (ok) {
          found.set(t.term, { term: t.term, label: t.label });
          break;
        }
      }
    }
    return [...found.values()];
  }

  /**
   * Nombres propios del texto (palabras en mayúscula que no empiezan frase, con sus conectores):
   * "Lagos", "Son Dureta", "Miguel Induráin".
   */
  properNames(text: string): string[] {
    const out: string[] = [];
    let current: string[] = [];
    let pendingConnectors: string[] = [];
    let atStart = true;
    const flush = () => {
      if (current.length) out.push(current.join(" "));
      current = [];
      pendingConnectors = [];
    };
    // Recorre el texto por palabras, recordando si la anterior cerraba una frase.
    let i = 0;
    while (i < text.length) {
      const ch = text[i]!;
      if (/\p{L}/u.test(ch)) {
        let j = i;
        while (j < text.length && /[\p{L}\p{M}'’·]/u.test(text[j]!)) j++;
        const word = text.slice(i, j);
        const capital = /\p{Lu}/u.test(word[0]!) && word.length > 1;
        const common = CAPITALIZED_COMMON.has(normalizeText(word));
        if (capital && !atStart && !common) {
          current.push(...pendingConnectors, word);
          pendingConnectors = [];
        } else if (current.length && CONNECTORS.has(word.toLowerCase())) {
          pendingConnectors.push(word);
        } else {
          flush();
        }
        atStart = false;
        i = j;
        continue;
      }
      if (SENTENCE_START.has(ch)) {
        flush();
        atStart = true;
      } else if (!/\s/.test(ch)) {
        flush();
      }
      i++;
    }
    flush();
    return [...new Set(out)];
  }

  /** Aprende el vocabulario corriente de un texto (sus palabras en minúscula). */
  observe(text: string): void {
    for (const w of lowercaseWords(text)) this.lower.add(w);
  }

  /** ¿Es una palabra del pueblo o de la época? (o el principio de una: "Ultramarin…"). */
  private isKnown(w: string): boolean {
    if (this.known.has(w)) return true;
    if (w.length < 4) return false;
    for (const k of this.known) if (k.startsWith(w)) return true;
    return false;
  }

  /** Nombres propios que no son del pueblo, del glosario ni referencias comunes de la época. */
  externalNames(text: string): string[] {
    return this.properNames(text).filter((name) => {
      const ws = words(name);
      // Una sola palabra que también se usa en minúscula es una palabra corriente.
      if (ws.length === 1 && this.lower.has(ws[0]!)) return false;
      return ws.some((w) => w.length >= 3 && !this.isKnown(w));
    });
  }

  /** De esos, los que no encajan con lo que sabe esta persona (su perfil de conocimiento). */
  outsideProfile(text: string, seed: Pick<AgentSeed, "knowledge"> | undefined): string[] {
    const external = this.externalNames(text);
    if (!seed) return external;
    let mine = this.profiles.get(seed);
    if (!mine) {
      mine = profileWords(seed);
      this.profiles.set(seed, mine);
    }
    return external.filter((name) =>
      words(name).some((w) => w.length >= 3 && !this.isKnown(w) && !mine.has(w)),
    );
  }
}
