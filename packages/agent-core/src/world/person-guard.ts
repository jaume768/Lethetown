/**
 * PersonGuard: que nadie invente vecinos ni conocidos («la Pepa» de la partida 2). Como
 * MinorGuard, sin LLM y sobre todo texto del LLM que entra en el mundo: detecta nombres de
 * persona que no son vecinos, ni gente de fuera de quien habla o de quien se menciona
 * (`offstagePeople` de la semilla, o lo que le contaron de ellos), ni personajes públicos de la
 * época. Se engancha a MinorGuard como reescritor (`addRewriter`): en modo `enforce` cambia el
 * nombre por «alguien» (o descarta el texto, en una intención); en `log`, solo registra. La
 * decisión, además, se repite una vez con el aviso. Ver docs/decisiones/personas.md.
 *
 * Qué cuenta como nombre de persona (por palabras, lineal):
 * - un nombre de pila de la lista (`GIVEN_NAMES` y los de la biblia): «Pepa», «Tolo»; al empezar
 *   una frase, solo si no es también una palabra corriente («Rosa», «Gloria»);
 * - tras un parentesco («mi primo», «su tía»), un tratamiento («don», «doña») o un artículo de
 *   persona mallorquín («na», «en» ante un nombre de pila), la palabra en mayúscula que sigue;
 * - «la X» / «el X» con X en mayúscula que no es palabra corriente ni algo conocido: se registra,
 *   pero no se cambia (podría ser un sitio: «la Seu»).
 */
import type { AgentSeed } from "@lethetown/shared";
import type { SafetyContext, SafetyKind, TextRewriter } from "../agent/minor-safety";
import { GIVEN_NAMES } from "./given-names";
import { normalizeText } from "./knowledge";

/** Cómo se trató una persona inventada (para el registro). */
export type PersonOutcome = "retried" | "replaced" | "dropped" | "logged";

export interface PersonRecord {
  /** Minuto de juego. */
  at: number;
  agentId: string | null;
  /** El nombre tal cual («la Pepa», «mi primo Tolo»). */
  name: string;
  outcome: PersonOutcome;
  /** El texto original (recortado). */
  text: string;
  source: SafetyKind;
}

export interface PersonGuardStats {
  detected: number;
  retried: number;
  replaced: number;
  dropped: number;
}

export interface PersonGuardOptions {
  /** Vecinos (nombre, id y gente de fuera que conocen). */
  neighbors: Pick<AgentSeed, "id" | "name" | "offstagePeople">[];
  /** Personajes públicos de la época y referencias conocidas (palabras que no son inventos). */
  publicFigures?: string[];
  /** Otros nombres propios que existen: lugares, glosario, referencias comunes. */
  known?: string[];
  /** Nombres de pila de más (además de `GIVEN_NAMES`). */
  extraGivenNames?: string[];
  /** ¿Es una palabra corriente (vista en minúscula)? Para la mayúscula de inicio de frase. */
  isCommonWord?: (normalized: string) => boolean;
  mode: "log" | "enforce";
  now: () => number;
  onRecord?: (r: PersonRecord) => void;
}

/** Lo que sustituye a una persona inventada. */
export const SOMEONE = "alguien";
/** Textos en los que una persona inventada no se cambia: se descarta entero. */
const DROP = new Set<SafetyKind>(["intention"]);
const MAX_TEXT = 300;

const KIN = new Set(
  normalizeText(
    "primo prima tío tía hermano hermana cuñado cuñada sobrino sobrina abuelo abuela nieto nieta hijo hija padre madre suegro suegra marido mujer esposo esposa novio novia amigo amiga vecino vecina compadre comadre padrino madrina ahijado ahijada",
  ).split(" "),
);
const POSSESSIVE = new Set(["mi", "tu", "su", "nuestro", "nuestra", "vuestro", "vuestra", "mis"]);
const TITLES = new Set(["don", "dona", "doña", "senor", "señor", "senora", "señora", "tio", "tia"]);
const ARTICLES = new Set(["la", "el"]);
/** Artículo personal mallorquín: «na Joana», «en Biel». */
const PERSONAL = new Set(["na", "en"]);
/** Tras estas, la palabra en mayúscula es un santo o una fiesta («San Juan», «Sant Antoni»). */
const SAINTS = new Set(normalizeText("San Santa Sant Santo Virgen Sor Fray Nuestra").split(" "));
/** Exclamaciones que son nombres («¡Jesús!», «¡Madre de Dios!»). */
const EXCLAMATIONS = new Set(normalizeText("Jesús Cristo Dios Virgen Jesucristo").split(" "));
/**
 * Nombres de pila que también son palabras corrientes: al empezar una frase no cuentan como
 * persona («Rosa de los vientos», «Gloria bendita»).
 */
const WORD_NAMES = new Set(
  normalizeText(
    "Rosa Gloria Luz Mar Sol Paz Victoria Esperanza Consuelo Dolores Amparo Remedios Rocío Estrella Dulce Alma Abril Nieves Ángeles Caridad Mercedes Concepción Asunción Encarnación Rosario Socorro Salvador Ángel Cruz Blanca Clemente Fina Pío Belén Lourdes Pilar Reyes Cinta",
  ).split(" "),
);
/** Signos tras los que empieza una frase. */
const STARTS = new Set([".", "!", "?", "¡", "¿", "«", '"', "“", ":", ";", "—", "…", "(", "\n"]);

interface Word {
  raw: string;
  norm: string;
  start: number;
  end: number;
  capital: boolean;
  /** Abre frase (o es la primera). */
  atStart: boolean;
}

function wordsOf(text: string): Word[] {
  const out: Word[] = [];
  let atStart = true;
  let i = 0;
  while (i < text.length) {
    const ch = text[i]!;
    if (/\p{L}/u.test(ch)) {
      let j = i;
      while (j < text.length && /[\p{L}\p{M}'’·]/u.test(text[j]!)) j++;
      const raw = text.slice(i, j);
      out.push({
        raw,
        norm: normalizeText(raw),
        start: i,
        end: j,
        capital: /\p{Lu}/u.test(raw[0]!) && raw.length > 1,
        atStart,
      });
      atStart = false;
      i = j;
      continue;
    }
    if (STARTS.has(ch)) atStart = true;
    i++;
  }
  return out;
}

/** Una persona inventada encontrada en el texto: dónde empieza y acaba lo que hay que cambiar. */
interface Hit {
  name: string;
  start: number;
  end: number;
  /** true = seguro (nombre de pila, parentesco, tratamiento); false = solo «la X» (se registra). */
  sure: boolean;
}

export class PersonGuard {
  private readonly given: Set<string>;
  private readonly known = new Set<string>();
  /** Nombres de varias palabras que existen («Lola Flores», «Juan Carlos»), por su primera palabra. */
  private readonly phrases = new Map<string, string[][]>();
  /** Gente de fuera que conoce cada uno: la suya y la que le han contado (normalizada). */
  private readonly offstage = new Map<string, Set<string>>();
  private readonly counts: PersonGuardStats = { detected: 0, retried: 0, replaced: 0, dropped: 0 };

  constructor(private readonly opts: PersonGuardOptions) {
    this.given = new Set(
      [...GIVEN_NAMES, ...(opts.extraGivenNames ?? [])].map((n) => normalizeText(n)),
    );
    const add = (text: string) => {
      for (const w of normalizeText(text).split(" ")) if (w) this.known.add(w);
    };
    // Un nombre de varias palabras cuenta entero; suelto, solo su última palabra (el apellido):
    // «Lola Flores» no hace que exista cualquier «Lola».
    const addPhrase = (text: string) => {
      const ws = normalizeText(text)
        .split(" ")
        .filter((w) => w && !ARTICLES.has(w));
      if (ws.length < 2) return ws.forEach((w) => this.known.add(w));
      this.known.add(ws.at(-1)!);
      const list = this.phrases.get(ws[0]!) ?? [];
      list.push(ws);
      this.phrases.set(ws[0]!, list);
    };
    for (const n of opts.neighbors) {
      add(n.name);
      this.known.add(n.id);
      this.offstage.set(
        n.id,
        new Set((n.offstagePeople ?? []).flatMap((p) => normalizeText(p.name).split(" "))),
      );
    }
    for (const t of [...(opts.publicFigures ?? []), ...(opts.known ?? [])]) addPhrase(t);
  }

  get mode(): PersonGuardOptions["mode"] {
    return this.opts.mode;
  }

  stats(): PersonGuardStats {
    return { ...this.counts };
  }

  /** Lo que conoce alguien de fuera (lo suyo y lo que le han contado), para la instantánea. */
  acquaintances(): Record<string, string[]> {
    return Object.fromEntries([...this.offstage].map(([id, s]) => [id, [...s]]));
  }

  restore(acquaintances: Record<string, string[]>): void {
    for (const [id, names] of Object.entries(acquaintances)) {
      const s = this.offstage.get(id) ?? new Set();
      for (const n of names) s.add(n);
      this.offstage.set(id, s);
    }
  }

  /**
   * Quien oye a alguien nombrar a una persona de fuera que ese alguien conoce, ahora también la
   * conoce (aprender de otros). Devuelve los nombres que aprendió. Una persona inventada no se
   * aprende nunca.
   */
  learn(listenerId: string, speakerId: string, text: string): string[] {
    const theirs = this.offstage.get(speakerId);
    if (!theirs) return [];
    const mine = this.offstage.get(listenerId) ?? new Set<string>();
    this.offstage.set(listenerId, mine);
    const out: string[] = [];
    for (const w of wordsOf(text)) {
      if (w.capital && theirs.has(w.norm) && !mine.has(w.norm) && !this.known.has(w.norm)) {
        mine.add(w.norm);
        out.push(w.raw);
      }
    }
    return out;
  }

  /** ¿Existe para estas personas? (vecino, conocido de fuera de alguna, personaje público…). */
  private exists(norm: string, people: string[]): boolean {
    if (this.known.has(norm)) return true;
    return people.some((id) => this.offstage.get(id)?.has(norm));
  }

  /** Personas inventadas del texto (lo que se cambiaría o se registraría). */
  private hits(text: string, ctx: SafetyContext): Hit[] {
    // Sin nadie concreto (la crónica del pueblo), vale la gente de fuera de cualquiera.
    const named = [...(ctx.agentId ? [ctx.agentId] : []), ...(ctx.actors ?? [])];
    const people = named.length ? [...new Set(named)] : [...this.offstage.keys()];
    const ws = wordsOf(text);
    const out: Hit[] = [];
    const common = (n: string) => this.opts.isCommonWord?.(n) ?? false;
    for (let i = 0; i < ws.length; i++) {
      const w = ws[i]!;
      if (!w.capital || w.norm.length < 3) continue;
      // Un nombre conocido de varias palabras («Felipe González», «Son Dureta»): entero.
      const phrase = this.phrases
        .get(w.norm)
        ?.find((p) => p.every((x, k) => ws[i + k]?.norm === x));
      if (phrase) {
        i += phrase.length - 1;
        continue;
      }
      const prev = ws[i - 1];
      const prev2 = ws[i - 2];
      if (prev && SAINTS.has(prev.norm) && prev.capital) continue;
      if (EXCLAMATIONS.has(w.norm) || this.exists(w.norm, people)) continue;
      // Apellidos y segundos nombres que siguen («Pepa Ferrer»): parte del mismo nombre.
      let j = i;
      while (ws[j + 1]?.capital && !ws[j + 1]!.atStart && !this.exists(ws[j + 1]!.norm, people)) {
        j++;
      }
      const last = ws[j]!;
      // Tras un parentesco o un tratamiento, en la misma frase («su padre. Vive» no).
      const kin = !w.atStart && prev && KIN.has(prev.norm) && prev2 && POSSESSIVE.has(prev2.norm);
      const title = !w.atStart && prev && TITLES.has(prev.norm) && !prev.capital;
      const given = this.given.has(w.norm);
      const personal = !w.atStart && prev && PERSONAL.has(prev.norm) && !prev.capital && given;
      const article = prev && ARTICLES.has(prev.norm) && !prev.capital && !w.atStart;
      let from: Word | undefined;
      let sure = true;
      if (kin) from = prev2;
      else if (title || personal) from = prev;
      else if (given && (!w.atStart || !(common(w.norm) || WORD_NAMES.has(w.norm)))) {
        from = article ? prev : w;
      } else if (article && !common(w.norm)) {
        from = prev;
        sure = false;
      }
      if (!from) continue;
      out.push({ name: text.slice(from.start, last.end), start: from.start, end: last.end, sure });
      i = j;
    }
    return out;
  }

  /** Nombres inventados del texto (sin cambiar nada). `note` lo registra (p. ej. al reintentar). */
  find(text: string, ctx: SafetyContext, note?: PersonOutcome): string[] {
    const found = this.hits(text, ctx).filter((h) => h.sure);
    if (note) for (const h of found) this.record(h.name, text, ctx, note);
    return found.map((h) => h.name);
  }

  /** El reescritor para `MinorGuard.addRewriter`. */
  readonly rewriter: TextRewriter = {
    find: (text, ctx) => this.find(text, ctx),
    note: (text, ctx) => void this.find(text, ctx, "retried"),
    rewrite: (text, ctx) => {
      const hits = this.hits(text, ctx);
      if (!hits.length) return text;
      for (const h of hits.filter((x) => !x.sure)) this.record(h.name, text, ctx, "logged");
      const sure = hits.filter((h) => h.sure);
      if (!sure.length) return text;
      if (this.opts.mode !== "enforce") {
        for (const h of sure) this.record(h.name, text, ctx, "logged");
        return text;
      }
      if (DROP.has(ctx.kind)) {
        for (const h of sure) this.record(h.name, text, ctx, "dropped");
        return null;
      }
      let out = "";
      let at = 0;
      for (const h of sure) {
        this.record(h.name, text, ctx, "replaced");
        const capital = /\p{Lu}/u.test(text[h.start]!) && isStart(text, h.start);
        out += text.slice(at, h.start) + (capital ? "Alguien" : SOMEONE);
        at = h.end;
      }
      return out + text.slice(at);
    },
  };

  private record(name: string, text: string, ctx: SafetyContext, outcome: PersonOutcome): void {
    this.counts.detected++;
    if (outcome !== "logged") this.counts[outcome]++;
    this.opts.onRecord?.({
      at: this.opts.now(),
      agentId: ctx.agentId ?? null,
      name,
      outcome,
      text: text.slice(0, MAX_TEXT),
      source: ctx.kind,
    });
  }
}

/** ¿Empieza frase en esta posición? (para «Alguien» con mayúscula). */
function isStart(text: string, at: number): boolean {
  for (let i = at - 1; i >= 0; i--) {
    const ch = text[i]!;
    if (/\s/.test(ch)) continue;
    return STARTS.has(ch);
  }
  return true;
}
