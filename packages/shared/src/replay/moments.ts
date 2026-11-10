import type { Chronicle, SimEvent } from "../schemas/api";
import type { Drama } from "../schemas/drama";
import type { Goal } from "../schemas/goals";
import type { Lore, LoreHolder } from "../schemas/lore";
import type { MemoryAuditEntry, MemoryVersion, SocialProfile } from "../schemas/memory";
import type { SkillState } from "../schemas/skills";
import type { ReplayBundle } from "./bundle";

/**
 * Momentos destacados de una partida (para la lista del reproductor y `pnpm replay:moments`):
 * candidatos a clip con su minuto, los vecinos y la frase literal. Nada se redacta: el título
 * se arma con datos (nombres, número de turnos) y la cita es tal cual salió.
 */
export type MomentKind =
  | "drama"
  | "chronicle"
  | "conversation"
  | "rashomon"
  | "transformation"
  | "external"
  | "goal"
  | "teaching"
  | "forgetting";

export interface Moment {
  id: string;
  kind: MomentKind;
  /** Detalle del tipo (el `kind` del drama, «achieved»/«abandoned»…). */
  subkind: string | null;
  /** Minuto de juego. */
  time: number;
  agents: string[];
  title: string;
  /** La frase literal (o las dos versiones de un recuerdo). */
  quote: string;
  score: number;
  /** Cómo sale la puntuación, legible («base 0,40 + largo 0,18…»). */
  why: string;
  eventId: string | null;
  placeId: string | null;
}

/** Un nombre que el `PersonGuard` o el registro de referencias externas marcó. */
export interface ExternalMark {
  at: number;
  agentId: string;
  term: string;
  label: string;
  text: string;
}

/** Lo mínimo de un recuerdo para los momentos. */
export interface MomentMemory {
  id: string;
  agentId: string;
  text: string;
  eventId: string | null;
  createdAt: number;
  importance: number;
  emotionalValence: number;
}

export interface MomentInput {
  names: ReadonlyMap<string, string>;
  events: readonly SimEvent[];
  dramas: readonly Drama[];
  chronicles: readonly { t: number; chronicle: Chronicle }[];
  goals?: readonly Goal[];
  audit?: readonly MemoryAuditEntry[];
  memories?: readonly MomentMemory[];
  versions?: readonly MemoryVersion[];
  profiles?: readonly SocialProfile[];
  externals?: readonly ExternalMark[];
  lore?: readonly Lore[];
  holders?: readonly LoreHolder[];
  skills?: readonly SkillState[];
  /** Desde qué minuto empezó la partida (lo aprendido antes es de partida, no transmitido). */
  from?: number;
}

/** Conversaciones con al menos tantos turnos. */
export const LONG_CONVERSATION_TURNS = 6;

/** Peso de cada tipo en la puntuación (lo demás suma encima). */
export const MOMENT_BASE: Record<MomentKind, number> = {
  chronicle: 0.6,
  rashomon: 0.5,
  goal: 0.5,
  drama: 0.45,
  transformation: 0.35,
  teaching: 0.35,
  forgetting: 0.35,
  conversation: 0.3,
  external: 0.25,
};

/** Frases de olvido dichas en voz alta. */
const FORGETTING_RE =
  /\b(no me acuerdo|ya no (me )?(acuerdo|recuerdo)|no me acordaba|se me (ha )?olvidado|se me olvidó|no lo recuerdo)\b/i;

/** Una frase del log («Ana → Leo: "…"»): quién habla a quién y lo dicho. */
export function splitSpeech(text: string): { head: string; line: string } {
  const i = text.indexOf(': "');
  if (i < 0 || !text.endsWith('"')) return { head: "", line: text };
  return { head: text.slice(0, i), line: text.slice(i + 3, -1) };
}

/** Id de la conversación de una frase («<conversación>:<turno>»). */
export function conversationOf(eventId: string): string {
  const i = eventId.indexOf(":");
  return i < 0 ? eventId : eventId.slice(0, i);
}

const fmt = (n: number) => n.toFixed(2).replace(".", ",");

/**
 * Puntuación simple y explicada: base del tipo + largo (turnos o texto) + carga emocional
 * (|afinidad| más fuerte entre los implicados, o la valencia del recuerdo) + vecinos implicados.
 */
export function scoreMoment(input: {
  kind: MomentKind;
  base?: number;
  turns?: number;
  textLength: number;
  charge: number;
  agents: number;
}): { score: number; why: string } {
  const base = input.base ?? MOMENT_BASE[input.kind];
  const length =
    input.turns !== undefined
      ? Math.min(1, Math.max(0, input.turns - LONG_CONVERSATION_TURNS + 1) / 10) * 0.3
      : Math.min(1, input.textLength / 240) * 0.15;
  const charge = Math.min(1, Math.abs(input.charge)) * 0.3;
  const people = Math.min(3, Math.max(0, input.agents - 1)) * 0.08;
  const score = base + length + charge + people;
  const parts = [
    `base ${fmt(base)}`,
    `largo ${fmt(length)}${input.turns !== undefined ? ` (${input.turns} turnos)` : ""}`,
    `carga ${fmt(charge)}`,
    `vecinos ${fmt(people)} (${input.agents})`,
  ];
  return { score: Math.round(score * 1000) / 1000, why: parts.join(" + ") };
}

/** Todos los candidatos, de más a menos puntuación. */
export function findMoments(input: MomentInput): Moment[] {
  const name = (id: string) => input.names.get(id) ?? id;
  const affinity = affinityIndex(input.profiles ?? []);
  // Carga emocional: lo que se tienen los dos protagonistas (los dos primeros), en los dos sentidos.
  const charge = (agents: readonly string[]) => {
    const [a, b] = agents;
    if (!a || !b) return 0;
    const ab = affinity.get(`${a}>${b}`);
    const ba = affinity.get(`${b}>${a}`);
    const known = [ab, ba].filter((x): x is number => x !== undefined);
    return known.length ? Math.max(...known.map(Math.abs)) : 0;
  };
  const out: Moment[] = [];
  const push = (
    m: Omit<Moment, "score" | "why">,
    extra: { base?: number; turns?: number; charge?: number } = {},
  ) => {
    const s = scoreMoment({
      kind: m.kind,
      base: extra.base,
      turns: extra.turns,
      textLength: m.quote.length,
      charge: extra.charge ?? charge(m.agents),
      agents: m.agents.length,
    });
    out.push({ ...m, ...s });
  };
  const events = new Map(input.events.map((e) => [e.id, e]));
  const talks = new Map<string, SimEvent[]>();
  for (const e of [...input.events].sort((a, b) => a.time - b.time)) {
    if (e.kind !== "speech") continue;
    const id = conversationOf(e.id);
    talks.set(id, [...(talks.get(id) ?? []), e]);
  }
  /** La frase de un drama: la suya, o la última de su conversación antes del drama. */
  const lineOf = (d: Drama): SimEvent | undefined => {
    if (!d.eventId) return undefined;
    const direct = events.get(d.eventId);
    if (direct) return direct;
    const lines = talks.get(conversationOf(d.eventId)) ?? [];
    return lines.filter((l) => l.time <= d.time + 1).at(-1) ?? lines[0];
  };

  // Dramas: uno por conversación y tipo, y sin repetir tipo y vecinos en dos horas.
  const lastDrama = new Map<string, Drama>();
  const seenTalk = new Set<string>();
  for (const d of [...input.dramas].sort((a, b) => a.time - b.time)) {
    const key = `${d.kind}|${[...d.agents].sort().join(",")}`;
    const prev = lastDrama.get(key);
    if (prev && d.time - prev.time < 120) continue;
    const talkKey = d.eventId ? `${d.kind}|${conversationOf(d.eventId)}` : null;
    if (talkKey && seenTalk.has(talkKey)) continue;
    if (talkKey) seenTalk.add(talkKey);
    lastDrama.set(key, d);
    const ev = lineOf(d);
    push(
      {
        id: `drama:${d.id}`,
        kind: "drama",
        subkind: d.kind,
        time: d.time,
        agents: d.agents,
        title: d.title,
        // La frase literal; si no la hay (un olvido, una meta), nada: el título ya lo cuenta.
        quote: ev?.kind === "speech" ? splitSpeech(ev.text).line : (ev?.text ?? ""),
        eventId: ev?.id ?? d.eventId,
        placeId: d.placeId,
      },
      { base: MOMENT_BASE.drama * (0.5 + d.score) },
    );
  }

  for (const { t, chronicle } of input.chronicles) {
    push({
      id: `chronicle:${chronicle.day}`,
      kind: "chronicle",
      subkind: null,
      time: t,
      agents: [],
      title: chronicle.title,
      quote: firstSentence(chronicle.text),
      eventId: null,
      placeId: null,
    });
  }

  // Conversaciones largas y frases de olvido.
  for (const e of input.events) {
    if (e.kind !== "speech") continue;
    const line = splitSpeech(e.text).line;
    if (e.agentId && FORGETTING_RE.test(line)) {
      push({
        id: `forgetting:${e.id}`,
        kind: "forgetting",
        subkind: "said",
        time: e.time,
        agents: unique([e.agentId, ...e.participants]),
        title: `${name(e.agentId)} no se acuerda`,
        quote: line,
        eventId: e.id,
        placeId: null,
      });
    }
  }
  for (const [id, lines] of talks) {
    if (lines.length < LONG_CONVERSATION_TURNS) continue;
    const agents = unique(lines.flatMap((l) => (l.agentId ? [l.agentId] : [])));
    const quote = lines
      .map((l) => splitSpeech(l.text).line)
      .reduce((a, b) => (b.length > a.length ? b : a), "");
    push(
      {
        id: `conversation:${id}`,
        kind: "conversation",
        subkind: null,
        time: lines[0]!.time,
        agents,
        title: `${lines.length} turnos: ${agents.map(name).join(", ")}`,
        quote,
        eventId: lines[0]!.id,
        placeId: null,
      },
      { turns: lines.length },
    );
  }

  const memories = new Map((input.memories ?? []).map((m) => [m.id, m]));
  const versionsOf = new Map<string, MemoryVersion[]>();
  for (const v of input.versions ?? []) {
    versionsOf.set(v.memoryId, [...(versionsOf.get(v.memoryId) ?? []), v]);
  }

  // Un mismo hecho recordado distinto por dos vecinos.
  const byEvent = new Map<string, MomentMemory[]>();
  for (const m of memories.values()) {
    if (!m.eventId) continue;
    byEvent.set(m.eventId, [...(byEvent.get(m.eventId) ?? []), m]);
  }
  for (const [eventId, list] of byEvent) {
    const firstByAgent = new Map<string, MomentMemory>();
    for (const m of [...list].sort((a, b) => a.createdAt - b.createdAt)) {
      if (!firstByAgent.has(m.agentId)) firstByAgent.set(m.agentId, m);
    }
    if (firstByAgent.size < 2) continue;
    // Primero los que cambiaron al recordarlo (lo que se ve distinto).
    const accounts = [...firstByAgent.values()].sort(
      (a, b) => Number(versionsOf.has(b.id)) - Number(versionsOf.has(a.id)),
    );
    const valences = accounts.map((m) => m.emotionalValence);
    const spread = Math.max(...valences) - Math.min(...valences);
    const changed = accounts.some((m) => versionsOf.has(m.id));
    // Distinto de verdad: alguno se reescribió al recordarlo, o lo vivieron con ánimo opuesto.
    if (!changed && spread < 0.8) continue;
    const agents = accounts.map((m) => m.agentId);
    push(
      {
        id: `rashomon:${eventId}`,
        kind: "rashomon",
        subkind: changed ? "reconsolidated" : "valence",
        time: Math.min(...accounts.map((m) => m.createdAt)),
        agents,
        title: `Lo recuerdan distinto: ${agents.slice(0, 3).map(name).join(", ")}`,
        quote: accounts
          .slice(0, 2)
          .map((m) => `${name(m.agentId)}: «${m.text}»`)
          .join(" / "),
        eventId,
        placeId: null,
      },
      {
        base: MOMENT_BASE.rashomon + (changed ? 0.1 : 0),
        charge: Math.max(charge(agents), spread / 2),
      },
    );
  }

  // Recuerdos que se transforman (reconsolidación, consolidación, recuerdos falsos).
  for (const [memoryId, versions] of versionsOf) {
    const m = memories.get(memoryId);
    if (m && m.importance < 5) continue;
    const sorted = [...versions].sort((a, b) => a.at - b.at);
    sorted.forEach((v, i) => {
      const after = sorted[i + 1]?.text ?? m?.text;
      if (!after || after === v.text) return;
      push(
        {
          id: `transformation:${memoryId}:${v.version}`,
          kind: "transformation",
          subkind: v.reason,
          time: v.at,
          agents: m ? [m.agentId] : [],
          title: `${m ? name(m.agentId) : "Alguien"}: ${v.reason}`,
          quote: `«${v.text}» → «${after}»`,
          eventId: m?.eventId ?? null,
          placeId: null,
        },
        { charge: m?.emotionalValence ?? 0 },
      );
    });
  }
  for (const a of input.audit ?? []) {
    if (a.action !== "false_memory") continue;
    push(
      {
        id: `transformation:false:${a.memoryId}:${a.at}`,
        kind: "transformation",
        subkind: "false_memory",
        time: a.at,
        agents: [a.agentId],
        title: `${name(a.agentId)} recuerda algo que no pasó`,
        quote: a.memoryText,
        eventId: memories.get(a.memoryId)?.eventId ?? null,
        placeId: null,
      },
      { base: MOMENT_BASE.transformation + 0.2 },
    );
  }

  // Olvidos de recuerdos importantes.
  for (const a of input.audit ?? []) {
    if (a.action !== "forgotten") continue;
    const m = memories.get(a.memoryId);
    if (!m || m.importance < 6) continue;
    push(
      {
        id: `forgetting:${a.memoryId}:${a.at}`,
        kind: "forgetting",
        subkind: "memory",
        time: a.at,
        agents: [a.agentId],
        title: `${name(a.agentId)} olvida algo importante`,
        quote: a.memoryText,
        eventId: m.eventId,
        placeId: null,
      },
      { charge: m.emotionalValence },
    );
  }

  for (const x of input.externals ?? []) {
    push({
      id: `external:${x.agentId}:${x.at}:${x.term}`,
      kind: "external",
      subkind: x.label,
      time: x.at,
      agents: [x.agentId],
      title: `${name(x.agentId)} nombra a «${x.term}» (${x.label})`,
      quote: x.text,
      eventId: null,
      placeId: null,
    });
  }

  for (const g of input.goals ?? []) {
    for (const h of g.history) {
      if (h.status !== "achieved" && h.status !== "abandoned") continue;
      push({
        id: `goal:${g.id}:${h.at}`,
        kind: "goal",
        subkind: h.status,
        time: h.at,
        agents: [g.agentId],
        title: `${name(g.agentId)} ${h.status === "achieved" ? "consigue una meta" : "abandona una meta"} (${h.reason})`,
        quote: g.text,
        eventId: null,
        placeId: null,
      });
      break;
    }
  }

  // Clases y saberes transmitidos durante la partida.
  const from = input.from ?? -Infinity;
  const lore = new Map((input.lore ?? []).map((l) => [l.id, l]));
  for (const h of input.holders ?? []) {
    if (!h.learnedFrom || h.learnedAt <= from) continue;
    const l = lore.get(h.loreId);
    push({
      id: `teaching:lore:${h.loreId}:${h.agentId}`,
      kind: "teaching",
      subkind: "lore",
      time: h.learnedAt,
      agents: [h.learnedFrom, h.agentId],
      title: `${name(h.learnedFrom)} le enseña a ${name(h.agentId)}: ${l?.title ?? h.loreId}`,
      quote: h.elements.map((e) => e.text).join(" · "),
      eventId: null,
      placeId: l?.placeId ?? null,
    });
  }
  for (const s of input.skills ?? []) {
    if (!s.learnedFrom) continue;
    const first = s.history.find((x) => x.at > from);
    if (!first) continue;
    push({
      id: `teaching:skill:${s.skill}:${s.agentId}`,
      kind: "teaching",
      subkind: "skill",
      time: first.at,
      agents: [s.learnedFrom, s.agentId],
      title: `${name(s.learnedFrom)} enseña ${s.skill} a ${name(s.agentId)}`,
      quote: first.reason,
      eventId: null,
      placeId: null,
    });
  }

  return out.sort((a, b) => b.score - a.score || a.time - b.time);
}

/**
 * Los mejores, con un tope por tipo (y por tipo de drama) para que haya de todo: primero los
 * `minPerKind` mejores de cada tipo, luego el resto por puntuación. Ordenados por puntuación.
 */
export function topMoments(
  moments: readonly Moment[],
  max = 200,
  perKind = 30,
  minPerKind = 5,
): Moment[] {
  const keyOf = (m: Moment) => (m.kind === "drama" ? `drama:${m.subkind}` : m.kind);
  const count = new Map<string, number>();
  const chosen = new Set<Moment>();
  const take = (limit: number) => {
    for (const m of moments) {
      if (chosen.size >= max) return;
      if (chosen.has(m)) continue;
      const n = count.get(keyOf(m)) ?? 0;
      if (n >= limit) continue;
      count.set(keyOf(m), n + 1);
      chosen.add(m);
    }
  };
  take(Math.min(minPerKind, perKind));
  take(perKind);
  return moments.filter((m) => chosen.has(m));
}

function affinityIndex(profiles: readonly SocialProfile[]): Map<string, number> {
  return new Map(profiles.map((p) => [`${p.ownerId}>${p.aboutId}`, p.affinity]));
}

function unique<T>(xs: readonly T[]): T[] {
  return [...new Set(xs)];
}

function firstSentence(text: string): string {
  const m = /^(.{20,280}?[.!?])(\s|$)/s.exec(text);
  return (m ? m[1]! : text.slice(0, 280)).trim();
}

/** La entrada de `findMoments` a partir de un paquete de repetición (lo que lleva). */
export function momentInputFromBundle(bundle: ReplayBundle): MomentInput {
  const names = new Map<string, string>();
  for (const f of bundle.frames) for (const a of f.agents) if (a.name) names.set(a.id, a.name);
  const events: SimEvent[] = [];
  const dramas: Drama[] = [];
  const chronicles: { t: number; chronicle: Chronicle }[] = [];
  for (const { t, msg } of bundle.messages) {
    if (msg.type === "event") events.push(msg.event);
    else if (msg.type === "drama") dramas.push(msg.drama);
    else if (msg.type === "chronicle") chronicles.push({ t, chronicle: msg.chronicle });
  }
  const d = bundle.data;
  return {
    names,
    events,
    dramas,
    chronicles,
    from: bundle.meta.from,
    ...(d
      ? {
          goals: d.goals,
          audit: d.audit,
          memories: d.memories,
          versions: d.versions,
          profiles: d.profiles,
          lore: d.lore,
          holders: d.holders,
          skills: d.skills,
        }
      : {}),
  };
}
