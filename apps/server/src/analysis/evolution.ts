/**
 * Métricas de evolución de un mundo, por día de juego, a partir de lo que ya se guarda: eventos
 * de la simulación, auditoría de la memoria, historial de las fichas sociales y llamadas al
 * LLM. Lógica pura: la usan la pestaña de admin «Evolución» (con los almacenes del mundo) y
 * `pnpm study:analyze` (con lo que graban `record` y `world:export`). Ver
 * docs/decisiones/evolucion.md.
 */
import {
  ACTION_SPECS,
  type AgentSeed,
  type CostBucket,
  type DayMetrics,
  type EvolutionReport,
  type Goal,
  type MemoryAuditEntry,
  type SimEvent,
  type SocialProfileChange,
} from "@lethetown/shared";
import { ReplyLatencyMeter } from "../sim/reply-latency";

/** Una llamada al LLM (de `llm_calls` o del coste en memoria), con su minuto de juego si se sabe. */
export interface LlmCallRow {
  task: string;
  model: string;
  usd: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  /** Minuto de juego (aproximado: se deduce de la hora real); null si no se sabe. */
  time: number | null;
}

export interface EvolutionInput {
  seeds: AgentSeed[];
  events: SimEvent[];
  /** Hora real de cada evento (id → ms), si se grabó (para la espera de respuesta real). */
  wallMs?: Map<string, number>;
  audits: MemoryAuditEntry[];
  socialHistory: SocialProfileChange[];
  llmCalls: LlmCallRow[];
  /** Coste por tarea ya sumado (en vivo no hay llamadas sueltas): sustituye al de `llmCalls`. */
  costByTask?: Record<string, CostBucket>;
  /** De qué sistema es cada tarea del LLM (las que no, son del núcleo). */
  taskSystems?: Record<string, string>;
  /** Cifras vivas de cada sistema y del guardián de menores (solo en la pestaña de admin). */
  systems?: Record<string, Record<string, number>>;
  /** Registro de conocimiento externo (`knowledge_log`). */
  knowledge?: KnowledgeRow[];
  /** Metas con su historial (`goals`). */
  goals?: Goal[];
}

type GoalFigures = Omit<NonNullable<DayMetrics["goals"]>, "byAgent">;

/**
 * Metas hasta el final de `until` (minuto de juego): activas, progreso y frustración medios
 * (de las activas, según su última entrada del historial) y conseguidas o abandonadas en
 * [`from`, `until`).
 */
function goalsAt(goals: Goal[], from: number, until: number): NonNullable<DayMetrics["goals"]> {
  const figures = (list: Goal[]): GoalFigures => {
    const active: { progress: number; frustration: number }[] = [];
    let achieved = 0;
    let abandoned = 0;
    for (const g of list) {
      const upTo = g.history.filter((h) => h.at < until);
      const last = upTo.at(-1);
      if (!last) continue;
      if (last.status === "active") active.push(last);
      const inRange = upTo.filter((h) => h.at >= from);
      if (inRange.some((h) => h.status === "achieved")) achieved++;
      if (inRange.some((h) => h.status === "abandoned")) abandoned++;
    }
    return {
      active: active.length,
      meanProgress: round(mean(active.map((a) => a.progress))),
      achieved,
      abandoned,
      meanFrustration: round(mean(active.map((a) => a.frustration))),
    };
  };
  const byAgent: Record<string, GoalFigures> = {};
  for (const id of [...new Set(goals.map((g) => g.agentId))].sort()) {
    byAgent[id] = figures(goals.filter((g) => g.agentId === id));
  }
  return { ...figures(goals), byAgent };
}

/** Una fila de `knowledge_log`. */
export interface KnowledgeRow {
  at: number;
  agentId: string | null;
  kind: string;
  term: string;
  label: string;
  text: string;
  source: string;
}

/** Ejemplos de conocimiento externo en el informe. */
const KNOWLEDGE_EXAMPLES = 20;

function knowledgeReport(rows: KnowledgeRow[]): NonNullable<EvolutionReport["knowledge"]> {
  const byKind: Record<string, number> = {};
  const byAgent: Record<string, Record<string, number>> = {};
  for (const r of rows) {
    inc(byKind, r.kind);
    inc((byAgent[r.agentId ?? "-"] ??= {}), r.kind);
  }
  const examples = [...rows].sort((a, b) => b.at - a.at).slice(0, KNOWLEDGE_EXAMPLES);
  return { byKind, byAgent, examples };
}

const ACTIONS = new Set(Object.keys(ACTION_SPECS));
const dayOf = (t: number) => Math.floor(t / 1440);
const pairKey = (a: string, b: string) => (a < b ? `${a}–${b}` : `${b}–${a}`);
const round = (x: number, d = 2) => Math.round(x * 10 ** d) / 10 ** d;
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const inc = (r: Record<string, number>, k: string, n = 1) => (r[k] = (r[k] ?? 0) + n);

/** Lo dicho en un evento de habla (`Nombre → Otro: "…"`). */
const utteranceOf = (e: SimEvent) => /: "(.*)"$/s.exec(e.text)?.[1] ?? "";

/** Motivo de fin de una charla, sin nombres ni números (para agrupar). */
function endReason(text: string): string | null {
  const m = /terminan de hablar \((\d+) turnos?; (.+)\)$/s.exec(text);
  if (!m) return null;
  const reason = m[2]!;
  if (reason.startsWith("se fue con")) return "se fue con otros";
  if (/ se fue a /.test(reason)) return "se fue a otro sitio";
  return reason.replace(/\d+/g, "N");
}

function gini(values: number[]): number {
  const xs = [...values].sort((a, b) => a - b);
  const total = xs.reduce((a, b) => a + b, 0);
  if (!total || xs.length < 2) return 0;
  const weighted = xs.reduce((s, x, i) => s + (i + 1) * x, 0);
  return (2 * weighted) / (xs.length * total) - (xs.length + 1) / xs.length;
}

/** Métricas de un tramo de la partida (un día, o toda). */
function metricsOf(
  day: number,
  input: EvolutionInput,
  events: SimEvent[],
  audits: MemoryAuditEntry[],
  changes: number,
  calls: LlmCallRow[],
  pairsEver: Set<string>,
): DayMetrics {
  const ids = input.seeds.map((s) => s.id);
  const possible = (ids.length * (ids.length - 1)) / 2;
  const pairs = new Map<string, number>();
  const partners = new Map<string, Set<string>>(ids.map((id) => [id, new Set()]));
  const byAgent = new Map<string, number>(ids.map((id) => [id, 0]));
  const conversations = { total: 0, group: 0, pair: 0, turns: [] as number[] };
  const endReasons: Record<string, number> = {};
  const intentions = { proposed: 0, kept: 0, missed: 0, late: 0 };
  const actions: DayMetrics["actions"] = {};
  const llmErrors: Record<string, number> = {};
  const act = (t: string) => (actions[t] ??= { done: 0, agreed: 0, failed: 0 });
  let utterances = 0;
  for (const e of events) {
    if (e.kind === "speech" && e.agentId && e.participants[1]) {
      const to = e.participants[1];
      utterances++;
      // Las frases no llevan `meta.action`: cada una es un `say`.
      act("say").done++;
      byAgent.set(e.agentId, (byAgent.get(e.agentId) ?? 0) + 1);
      const key = pairKey(e.agentId, to);
      pairs.set(key, (pairs.get(key) ?? 0) + 1);
      pairsEver.add(key);
      partners.get(e.agentId)?.add(to);
      partners.get(to)?.add(e.agentId);
    }
    const reason = e.agentId === null ? endReason(e.text) : null;
    if (reason) {
      conversations.total++;
      if (e.participants.length > 2) conversations.group++;
      else conversations.pair++;
      conversations.turns.push(Number(/\((\d+) turno/.exec(e.text)?.[1] ?? 0));
      inc(endReasons, reason);
    }
    if (e.kind === "memory") {
      if (e.text.startsWith("📝")) intentions.proposed++;
      else if (e.text.startsWith("✅")) intentions.kept++;
      else if (e.text.startsWith("🫥") && / se le pasa /.test(e.text)) intentions.missed++;
      else if (e.text.startsWith("😳")) intentions.late++;
    }
    const action = e.meta?.action;
    if (action && ACTIONS.has(action)) {
      if (e.meta?.agreed) act(action).agreed++;
      else if (e.meta?.ok === false) act(action).failed++;
      else act(action).done++;
    }
    const error = e.kind === "system" ? /⚠ Error en "([^"]+)"/.exec(e.text)?.[1] : undefined;
    if (error) inc(llmErrors, error);
  }
  // Un acuerdo hablado ejecuta su acción formal (que deja su propio evento): no cuenta dos veces.
  for (const a of Object.values(actions)) a.done = Math.max(0, a.done - a.agreed);
  const counts = [...pairs.values()].sort((a, b) => b - a);
  const memory = { reconsolidated: 0, forgotten: 0, archived: 0, deleted: 0 };
  for (const a of audits) {
    if (a.action in memory) memory[a.action as keyof typeof memory]++;
  }
  const partnerCounts = [...partners.values()].map((s) => s.size);
  return {
    day,
    utterances,
    pairsTalked: pairs.size,
    pairsPct: possible ? round((100 * pairs.size) / possible, 1) : 0,
    pairsEver: pairsEver.size,
    top4Share: utterances ? round(counts.slice(0, 4).reduce((a, b) => a + b, 0) / utterances) : 0,
    gini: round(gini([...byAgent.values()])),
    partnersMean: round(mean(partnerCounts), 1),
    partnersMin: partnerCounts.length ? Math.min(...partnerCounts) : 0,
    conversations: {
      total: conversations.total,
      group: conversations.group,
      pair: conversations.pair,
      meanTurns: round(mean(conversations.turns), 1),
      endReasons,
    },
    intentions,
    actions,
    relationshipChanges: changes,
    memory,
    llmErrors,
    usd: round(
      calls.reduce((s, c) => s + c.usd, 0),
      3,
    ),
  };
}

/** Cambios de tipo de relación (vecino → amistad…) en el historial de las fichas. */
function relationshipChanges(history: SocialProfileChange[]) {
  const last = new Map<string, string>();
  const changes: { at: number; from: string; to: string }[] = [];
  for (const h of [...history].sort((a, b) => a.at - b.at)) {
    const key = `${h.ownerId}>${h.aboutId}`;
    const prev = last.get(key);
    if (prev && prev !== h.relationshipType) {
      changes.push({ at: h.at, from: prev, to: h.relationshipType });
    }
    last.set(key, h.relationshipType);
  }
  return changes;
}

export function analyzeEvolution(input: EvolutionInput): EvolutionReport {
  const events = [...input.events].sort((a, b) => a.time - b.time);
  const changes = relationshipChanges(input.socialHistory);
  const days = [...new Set(events.map((e) => dayOf(e.time)))].sort((a, b) => a - b);
  const ever = new Set<string>();
  const perDay = days.map((d) =>
    metricsOf(
      d,
      input,
      events.filter((e) => dayOf(e.time) === d),
      input.audits.filter((a) => dayOf(a.at) === d),
      changes.filter((c) => dayOf(c.at) === d).length,
      input.llmCalls.filter((c) => c.time !== null && dayOf(c.time) === d),
      ever,
    ),
  );
  // Conocimiento externo por día (anacronismos y referencias).
  for (const d of perDay) {
    const rows = input.knowledge?.filter((r) => dayOf(r.at) === d.day);
    if (rows) d.knowledge = knowledgeReport(rows).byKind;
  }
  const total = metricsOf(
    -1,
    input,
    events,
    input.audits,
    changes.length,
    input.llmCalls,
    new Set(),
  );
  if (input.knowledge) total.knowledge = knowledgeReport(input.knowledge).byKind;
  if (input.goals) {
    for (const d of perDay) d.goals = goalsAt(input.goals, d.day * 1440, (d.day + 1) * 1440);
    total.goals = goalsAt(input.goals, -Infinity, Infinity);
  }

  // Coste por tarea y por sistema.
  const byTask: EvolutionReport["cost"]["byTask"] = {};
  const bySystem: Record<string, number> = {};
  const tokens: Record<string, { in: number; out: number; read: number }> = {};
  for (const c of input.llmCalls) {
    const t = (byTask[c.task] ??= {
      calls: 0,
      usd: 0,
      cacheReadPct: 0,
      inPerCall: 0,
      outPerCall: 0,
    });
    const k = (tokens[c.task] ??= { in: 0, out: 0, read: 0 });
    t.calls++;
    t.usd += c.usd;
    k.in += c.inputTokens + c.cacheReadTokens + c.cacheWriteTokens;
    k.read += c.cacheReadTokens;
    k.out += c.outputTokens;
    inc(bySystem, input.taskSystems?.[c.task] ?? "núcleo", c.usd);
  }
  for (const [task, b] of Object.entries(input.costByTask ?? {})) {
    byTask[task] = { calls: b.calls, usd: b.usd, cacheReadPct: 0, inPerCall: 0, outPerCall: 0 };
    tokens[task] = {
      in: b.inputTokens + b.cacheReadTokens + b.cacheWriteTokens,
      out: b.outputTokens,
      read: b.cacheReadTokens,
    };
    inc(bySystem, input.taskSystems?.[task] ?? "núcleo", b.usd);
  }
  for (const [task, t] of Object.entries(byTask)) {
    const k = tokens[task]!;
    t.usd = round(t.usd, 3);
    t.cacheReadPct = k.in ? round((100 * k.read) / k.in, 0) : 0;
    t.inPerCall = Math.round(k.in / t.calls);
    t.outPerCall = Math.round(k.out / t.calls);
  }

  // Espera de respuesta y longitud de lo que se dice según el estilo.
  const replies = new ReplyLatencyMeter();
  const seeds = new Map(input.seeds.map((s) => [s.id, s]));
  const speech: EvolutionReport["speechByStyle"] = {};
  const lengths: Record<string, number[]> = {};
  for (const e of events) {
    replies.add(e, input.wallMs?.get(e.id) ?? null);
    if (e.kind !== "speech" || !e.agentId) continue;
    const seed = seeds.get(e.agentId);
    const style = !seed
      ? "?"
      : seed.age < 18
        ? "menores"
        : (seed.speechStyle?.sentenceLength ?? "media");
    const text = utteranceOf(e);
    (lengths[style] ??= []).push(text.length);
    const s = (speech[style] ??= { n: 0, meanChars: 0, maxChars: 0, short: 0 });
    s.n++;
    s.maxChars = Math.max(s.maxChars, text.length);
    if (text.split(/\s+/).filter(Boolean).length <= 3) s.short++;
  }
  for (const [style, s] of Object.entries(speech)) s.meanChars = Math.round(mean(lengths[style]!));
  const r = replies.summary();

  const pairs = new Map<string, number>();
  const byAgent: Record<string, number> = {};
  for (const e of events) {
    if (e.kind !== "speech" || !e.agentId || !e.participants[1]) continue;
    const key = pairKey(e.agentId, e.participants[1]);
    pairs.set(key, (pairs.get(key) ?? 0) + 1);
    inc(byAgent, e.agentId);
  }
  const transitions: Record<string, number> = {};
  for (const c of changes) inc(transitions, `${c.from} → ${c.to}`);
  return {
    agents: input.seeds.length,
    days: perDay,
    total,
    cost: {
      total: round(
        Object.values(byTask).reduce((s, t) => s + t.usd, 0),
        3,
      ),
      byTask,
      bySystem: Object.fromEntries(Object.entries(bySystem).map(([k, v]) => [k, round(v, 3)])),
    },
    replyLatency: {
      replies: r.replies,
      meanMinutes: round(r.meanMinutes, 1),
      p90Minutes: round(r.p90Minutes, 1),
      meanSeconds: r.meanMs === null ? null : round(r.meanMs / 1000, 1),
    },
    speechByStyle: speech,
    topPairs: [...pairs]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([pair, utterances]) => ({ pair, utterances })),
    utterancesByAgent: byAgent,
    relationshipTransitions: transitions,
    ...(input.knowledge ? { knowledge: knowledgeReport(input.knowledge) } : {}),
    ...(input.systems ? { systems: input.systems } : {}),
  };
}
