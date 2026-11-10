import type { SimEvent } from "../schemas/api";
import type { Goal } from "../schemas/goals";
import type { MemoryAuditEntry } from "../schemas/memory";
import { splitSpeech, type Moment, type MomentInput } from "./moments";

/**
 * Arcos largos (tipo `arc`): lo que pasa a lo largo de varios días, no en un minuto. Se ordenan
 * aparte de los momentos (no compiten con los dramas). Nada se redacta: palabras, frases,
 * motivos y días salen tal cual de la partida.
 *
 * - `repeated` / `question`: lo mismo dicho de A a B en ≥ 3 días distintos (palabras que se
 *   repiten en sus frases, raras en el resto del pueblo).
 * - `confirmed`: una meta cualitativa que la consolidación confirma, con la frase que lo logró.
 * - `seed_memory`: un recuerdo de la semilla que se vuelve vago o se olvida, con el día.
 * - `paired`: la misma intención o meta en dos semillas y cómo acabó en cada una.
 */

/** Días distintos para que algo repetido sea un arco. */
export const ARC_MIN_DAYS = 3;

/** Palabras que no cuentan (muletillas y gramática; lo raro lo decide la rareza en el pueblo). */
const STOP = new Set(
  (
    "pues bueno vale gracias sabes entonces ahora luego mucho mucha muchos muchas todo toda " +
    "todos todas algo nada esto esta este eso esa ese estos estas esos esas aqui ahi alli porque " +
    "pero como cuando donde tambien tampoco siempre nunca claro verdad tienes tengo tiene tienen " +
    "quiero quieres quiere puedo puedes puede hacer hace hago haces creo crees dice dijo decir " +
    "digo dices mira oye anda venga bien mejor otra otro otros otras cosa cosas poco poca hola " +
    "esta estas estoy estan eres somos seria sido hemos habia haber tener estar para sobre desde " +
    "hasta entre cada mismo misma alguien nadie algun alguna alguno ningun ninguna quiza quizas " +
    "igual menos tanto tanta ella ellos ellas nosotros usted ustedes conmigo contigo vamos vaya " +
    "tambien despues antes rato dime oiga mire sera seras fuera fuese hoy ayer cual cuales que " +
    "quien quienes asi mas muy " +
    // Formas de llamarse (se dicen siempre, no son un tema).
    "mama papa hijo hija abuela abuelo nieta nieto criatura carino"
  ).split(" "),
);

/** Sin tildes y en minúsculas (para comparar palabras). */
export function fold(text: string): string {
  return text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function words(line: string, skip: ReadonlySet<string>): string[] {
  return [
    ...new Set(
      fold(line)
        .split(/[^a-zñ]+/)
        .filter((w) => w.length >= 4 && !STOP.has(w) && !skip.has(w)),
    ),
  ];
}

const day = (t: number) => Math.floor(t / 1440);
const fmt = (n: number) => n.toFixed(2).replace(".", ",");

/** Los arcos de una partida, de más a menos puntuación. */
export function findArcs(input: MomentInput, max = 60): Moment[] {
  const out = [...repeatedArcs(input), ...confirmedArcs(input), ...seedMemoryArcs(input)];
  return out.sort((a, b) => b.score - a.score || a.time - b.time).slice(0, max);
}

/** Lo mismo dicho de A a B en ≥ 3 días. */
export function repeatedArcs(input: MomentInput, perPair = 2): Moment[] {
  const name = (id: string) => input.names.get(id) ?? id;
  // Los nombres de los vecinos no cuentan (se dicen siempre).
  const skip = new Set<string>();
  for (const n of input.names.values()) for (const w of fold(n).split(/\s+/)) skip.add(w);
  const byPair = new Map<string, { a: string; b: string; lines: SimEvent[] }>();
  for (const e of input.events) {
    if (e.kind !== "speech" || !e.agentId || e.participants.length !== 2) continue;
    const b = e.participants.find((p) => p !== e.agentId);
    if (!b) continue;
    const key = `${e.agentId}>${b}`;
    const pair = byPair.get(key) ?? { a: e.agentId, b, lines: [] };
    pair.lines.push(e);
    byPair.set(key, pair);
  }
  // Rareza: en cuántas parejas sale cada palabra.
  const pairsWith = new Map<string, number>();
  const wordsOf = new Map<SimEvent, string[]>();
  for (const { lines } of byPair.values()) {
    const seen = new Set<string>();
    for (const l of lines) {
      const ws = words(splitSpeech(l.text).line, skip);
      wordsOf.set(l, ws);
      for (const w of ws) seen.add(w);
    }
    for (const w of seen) pairsWith.set(w, (pairsWith.get(w) ?? 0) + 1);
  }
  const total = Math.max(1, byPair.size);
  const out: Moment[] = [];
  for (const { a, b, lines } of byPair.values()) {
    const byWord = new Map<string, SimEvent[]>();
    for (const l of lines) {
      for (const w of wordsOf.get(l) ?? []) byWord.set(w, [...(byWord.get(w) ?? []), l]);
    }
    const candidates = [...byWord]
      .map(([w, ls]) => {
        const days = new Set(ls.map((l) => day(l.time))).size;
        const rarity = Math.log(total / (pairsWith.get(w) ?? 1));
        return { w, ls, days, rarity, score: days * rarity };
      })
      .filter((c) => c.days >= ARC_MIN_DAYS && c.rarity > 0)
      .sort((x, y) => y.score - x.score);
    const used = new Set<SimEvent>();
    /** Palabras ya en el título de otro arco de esta pareja. */
    const named = new Set<string>();
    for (const c of candidates.slice(0, perPair * 3)) {
      if (out.filter((m) => m.agents[0] === a && m.agents[1] === b).length >= perPair) break;
      if (c.ls.every((l) => used.has(l)) || named.has(c.w)) continue;
      // Palabras que van juntas (salen en casi las mismas frases): «quedarme» + «miedo» + «solo».
      const set = new Set(c.ls);
      const together = candidates
        .filter(
          (o) =>
            o !== c &&
            !named.has(o.w) &&
            o.ls.filter((l) => set.has(l)).length >= 0.6 * c.ls.length,
        )
        .slice(0, 2);
      for (const w of [c, ...together]) named.add(w.w);
      const sorted = [...c.ls].sort((x, y) => x.time - y.time);
      for (const l of sorted) used.add(l);
      const first = sorted[0]!;
      const last = sorted.at(-1)!;
      const questions = sorted.filter((l) => splitSpeech(l.text).line.includes("?")).length;
      const label = [c.w, ...together.map((o) => o.w)].map((w) => `«${w}»`).join(" + ");
      const score = 0.5 + Math.min(1, (c.days - 2) / 5) * 0.3 + Math.min(1, c.rarity / 4) * 0.2;
      out.push({
        id: `arc:repeated:${a}>${b}:${c.w}`,
        kind: "arc",
        subkind: questions * 2 >= sorted.length ? "question" : "repeated",
        time: first.time,
        agents: [a, b],
        title: `${name(a)} → ${name(b)}: ${label} en ${c.days} días (${sorted.length} veces)`,
        quote:
          sorted.length > 1
            ? `«${splitSpeech(first.text).line}» … «${splitSpeech(last.text).line}»`
            : `«${splitSpeech(first.text).line}»`,
        score: Math.round(score * 1000) / 1000,
        why: `días ${c.days} · veces ${sorted.length} · rareza ${fmt(c.rarity)} (en ${pairsWith.get(c.w)} de ${total} parejas)`,
        eventId: first.id,
        placeId: null,
        span: { from: first.time, to: last.time, count: sorted.length },
      });
    }
  }
  return out;
}

/** La entrada del historial con que la consolidación confirma una meta cualitativa. */
const CONFIRMED_RE = /^comprobado al repasar el día: se ha logrado:?\s*(.*)$/s;
const NOT_YET_RE = /^comprobado al repasar el día: aún no/;

/** Metas `confirmed` que la consolidación confirma, con la frase que lo logró. */
export function confirmedArcs(input: MomentInput): Moment[] {
  const name = (id: string) => input.names.get(id) ?? id;
  const out: Moment[] = [];
  for (const g of input.goals ?? []) {
    if (g.criterion.type !== "confirmed") continue;
    const ok = g.history.find((h) => CONFIRMED_RE.test(h.reason));
    if (!ok) continue;
    const tries = g.history.filter((h) => NOT_YET_RE.test(h.reason)).length;
    const line = achievingLine(g, input.events, ok.at);
    const why = CONFIRMED_RE.exec(ok.reason)![1]!.trim();
    out.push({
      id: `arc:confirmed:${g.id}`,
      kind: "arc",
      subkind: "confirmed",
      time: line?.time ?? ok.at,
      agents: line?.participants.length
        ? [g.agentId, ...line.participants.filter((p) => p !== g.agentId)]
        : [g.agentId],
      title: `${name(g.agentId)} lo consigue${tries ? ` tras ${tries + 1} noches` : ""}: «${g.text}»`,
      quote: line ? splitSpeech(line.text).line : why,
      score: Math.round((0.7 + Math.min(1, tries / 4) * 0.3) * 1000) / 1000,
      why: `confirmada en la consolidación (día ${day(ok.at)}): ${why} · ${tries} «aún no» antes`,
      eventId: line?.id ?? null,
      placeId: null,
      span: { from: g.createdAt, to: ok.at, count: tries + 1 },
    });
  }
  return out;
}

/** La frase que lo logró: la última de la conversación que mide la meta antes de confirmarla. */
function achievingLine(g: Goal, events: readonly SimEvent[], until: number): SimEvent | null {
  if (g.criterion.type !== "confirmed") return null;
  const m = g.criterion.measure as { personId?: string | null; topics?: string[] };
  const person = m.personId ?? null;
  const topics = (m.topics ?? []).map(fold);
  let best: SimEvent | null = null;
  for (const e of events) {
    if (e.kind !== "speech" || e.time > until || e.time < g.createdAt) continue;
    const between = person
      ? e.participants.includes(g.agentId) && e.participants.includes(person)
      : e.agentId === g.agentId;
    if (!between) continue;
    const line = fold(splitSpeech(e.text).line);
    if (topics.length && !topics.some((t) => line.includes(t))) continue;
    if (!best || e.time > best.time) best = e;
  }
  return best;
}

/** Recuerdos de la semilla (de antes de empezar) que se vuelven vagos o se olvidan. */
export function seedMemoryArcs(input: MomentInput): Moment[] {
  const name = (id: string) => input.names.get(id) ?? id;
  const from = input.from;
  if (from === undefined) return [];
  const seed = new Map(
    (input.memories ?? []).filter((m) => m.createdAt <= from).map((m) => [m.id, m]),
  );
  const byMemory = new Map<string, MemoryAuditEntry[]>();
  for (const a of input.audit ?? []) {
    if (!seed.has(a.memoryId) || (a.action !== "gist" && a.action !== "forgotten")) continue;
    byMemory.set(a.memoryId, [...(byMemory.get(a.memoryId) ?? []), a]);
  }
  const out: Moment[] = [];
  for (const [id, rows] of byMemory) {
    const m = seed.get(id)!;
    const sorted = [...rows].sort((a, b) => a.at - b.at);
    const vague = sorted.find((a) => a.action === "gist");
    const gone = sorted.find((a) => a.action === "forgotten");
    const parts = [
      vague && `se vuelve vago el día ${day(vague.at)}`,
      gone && `se olvida el día ${day(gone.at)}`,
    ].filter(Boolean);
    const first = sorted[0]!;
    const score =
      0.45 + (m.importance / 10) * 0.3 + Math.abs(m.emotionalValence) * 0.15 + (gone ? 0.1 : 0);
    out.push({
      id: `arc:seed:${id}`,
      kind: "arc",
      subkind: "seed_memory",
      time: (gone ?? first).at,
      agents: [m.agentId],
      title: `${name(m.agentId)}: un recuerdo de toda la vida ${parts.join(" y ")}`,
      quote: first.memoryText,
      score: Math.round(score * 1000) / 1000,
      why: `importancia ${m.importance} · valencia ${fmt(m.emotionalValence)}${gone ? " · olvidado" : ""}`,
      eventId: m.eventId,
      placeId: null,
      memoryId: id,
      span: { from: first.at, to: (gone ?? vague ?? first).at, count: sorted.length },
    });
  }
  return out;
}

/** Cómo acabó una intención o una meta en una partida. */
export interface Outcome {
  done: boolean;
  /** «se acordó», «se le pasó», «lo dejó»… con el minuto. */
  label: string;
  at: number | null;
}

const INTENTION_LABEL: Record<string, string> = {
  intention_kept: "se acordó",
  intention_forgotten: "se le pasó",
  intention_dropped: "lo dejó",
  intention_expired: "caducó",
};
const GOAL_LABEL: Record<string, string> = {
  achieved: "la consiguió",
  abandoned: "la abandonó",
  active: "sigue en ello",
  candidate: "pendiente de confirmar",
};

/** Clave de una intención: el vecino y su primera frase, sin tildes ni signos. */
function intentionKey(agentId: string, text: string): string {
  const first = text.split(/(?<=[.!?])\s/)[0] ?? text;
  return `${agentId}|${fold(first)
    .replace(/[^a-zñ ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()}`;
}

function intentions(
  audit: readonly MemoryAuditEntry[],
): Map<string, { text: string; agentId: string; outcome: Outcome }> {
  const out = new Map<
    string,
    { text: string; agentId: string; outcome: Outcome; rows: MemoryAuditEntry[] }
  >();
  for (const a of [...audit].sort((x, y) => x.at - y.at)) {
    if (!(a.action in INTENTION_LABEL)) continue;
    const key = intentionKey(a.agentId, a.memoryText);
    const cur = out.get(key) ?? {
      text: a.memoryText,
      agentId: a.agentId,
      outcome: { done: false, label: "", at: null },
      rows: [],
    };
    cur.rows.push(a);
    out.set(key, cur);
  }
  for (const v of out.values()) {
    const kept = v.rows.find((r) => r.action === "intention_kept");
    const decisive = kept ?? v.rows[0]!;
    const later = v.rows
      .filter((r) => r !== decisive && r.at > decisive.at)
      .map((r) => INTENTION_LABEL[r.action]);
    v.outcome = {
      done: Boolean(kept),
      label: [INTENTION_LABEL[decisive.action], ...(kept ? [] : later)].join(", luego "),
      at: decisive.at,
    };
  }
  return out;
}

function goalOutcomes(
  goals: readonly Goal[],
): Map<string, { text: string; agentId: string; outcome: Outcome }> {
  const out = new Map<string, { text: string; agentId: string; outcome: Outcome }>();
  for (const g of goals) {
    const end = g.history.find((h) => h.status === "achieved" || h.status === "abandoned");
    out.set(intentionKey(g.agentId, g.text), {
      text: g.text,
      agentId: g.agentId,
      outcome: {
        done: g.status === "achieved",
        label: GOAL_LABEL[g.status] ?? g.status,
        at: end?.at ?? null,
      },
    });
  }
  return out;
}

/**
 * Dos semillas: la misma intención o meta del mismo vecino en las dos partidas (las de la
 * semilla se llaman igual) y cómo acabó en cada una. Primero las que acabaron distinto.
 */
export function pairArcs(
  a: { label: string; input: MomentInput },
  b: { label: string; input: MomentInput },
): Moment[] {
  const name = (id: string) => a.input.names.get(id) ?? b.input.names.get(id) ?? id;
  const out: Moment[] = [];
  const kinds = [
    ["intention", intentions(a.input.audit ?? []), intentions(b.input.audit ?? [])],
    ["goal", goalOutcomes(a.input.goals ?? []), goalOutcomes(b.input.goals ?? [])],
  ] as const;
  for (const [kind, left, right] of kinds) {
    for (const [key, x] of left) {
      const y = right.get(key);
      if (!y) continue;
      const differ = x.outcome.done !== y.outcome.done;
      // Las metas que siguen igual en las dos no cuentan nada.
      if (kind === "goal" && !differ && x.outcome.label === y.outcome.label) continue;
      const when = (o: Outcome) =>
        o.at !== null ? ` (día ${day(o.at)}, minuto ${Math.round(o.at)})` : "";
      out.push({
        id: `arc:paired:${kind}:${key}`,
        kind: "arc",
        subkind: "paired",
        time: x.outcome.at ?? y.outcome.at ?? 0,
        agents: [x.agentId],
        title: `${name(x.agentId)}: «${x.text.split(/(?<=[.!?])\s/)[0]}» — ${a.label}: ${x.outcome.label || "—"} · ${b.label}: ${y.outcome.label || "—"}`,
        quote: `${a.label}: ${x.outcome.label}${when(x.outcome)} / ${b.label}: ${y.outcome.label}${when(y.outcome)}`,
        score: Math.round(((differ ? 0.8 : 0.4) + (kind === "intention" ? 0.1 : 0)) * 1000) / 1000,
        why: `${kind === "intention" ? "intención" : "meta"} en las dos semillas · ${differ ? "acabó distinto" : "acabó igual"}`,
        eventId: null,
        placeId: null,
        pair: {
          [a.label]: { done: x.outcome.done, label: x.outcome.label, at: x.outcome.at },
          [b.label]: { done: y.outcome.done, label: y.outcome.label, at: y.outcome.at },
        },
      });
    }
  }
  return out.sort((p, q) => q.score - p.score || p.time - q.time);
}
