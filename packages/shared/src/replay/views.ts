import type {
  AgentMemoryResponse,
  RashomonResponse,
  RelationshipHistoryResponse,
  RelationshipsResponse,
  SimEvent,
  SocialGraphResponse,
  SocialHistoryResponse,
} from "../schemas/api";
import type { AgentGoalsResponse, Goal } from "../schemas/goals";
import type { LoreResponse } from "../schemas/lore";
import type {
  Clarity,
  MemoryVersion,
  MemoryView,
  ScoredMemoryView,
  SocialProfile,
} from "../schemas/memory";
import type { AgentSkillsResponse, SkillState } from "../schemas/skills";
import type { ReplayData, ReplayMemory } from "./bundle";
import { DEFAULT_THRESHOLDS, STORY_ACTIONS, storyStep, type MemoryStory } from "./memory-story";

/**
 * Lo que mostraban los paneles en un instante de la partida, a partir de los datos del
 * paquete (estado final de la base de datos y sus historiales). Puro: el reproductor lo llama
 * con el minuto de la repetición. Nada se calcula de nuevo: se elige la versión de cada cosa
 * que había en ese minuto (el texto antes de reconsolidarse, la ficha tras el último cambio…).
 */
export class ReplayViews {
  private readonly versions = new Map<string, MemoryVersion[]>();
  private readonly byEvent = new Map<string, ReplayMemory[]>();

  constructor(
    private readonly data: ReplayData,
    /** id → nombre de los vecinos. */
    private readonly names: ReadonlyMap<string, string>,
  ) {
    for (const v of data.versions) {
      const list = this.versions.get(v.memoryId) ?? [];
      list.push(v);
      this.versions.set(v.memoryId, list);
    }
    for (const list of this.versions.values()) list.sort((a, b) => a.at - b.at);
    for (const m of data.memories) {
      if (!m.eventId) continue;
      const list = this.byEvent.get(m.eventId) ?? [];
      list.push(m);
      this.byEvent.set(m.eventId, list);
    }
  }

  /** Un recuerdo tal como estaba en `t` (null si aún no existía). */
  memoryAt(
    m: ReplayMemory,
    t: number,
  ): { view: MemoryView; strength: number; clarity: Clarity } | null {
    if (m.createdAt > t) return null;
    // El texto de entonces: el de la primera versión guardada después de `t` (si la hay).
    const later = this.versions.get(m.id)?.find((v) => v.at > t);
    const sample = strengthSample(m, t);
    const view: MemoryView = {
      id: m.id,
      agentId: m.agentId,
      text: later ? later.text : m.text,
      gist: later ? null : m.gist,
      createdAt: m.createdAt,
      lastAccessedAt: Math.min(m.lastAccessedAt, t),
      importance: m.importance,
      emotionalValence: later ? later.emotionalValence : m.emotionalValence,
      strength: sample.strength,
      source: later ? (later.source as MemoryView["source"]) : m.source,
      type: m.type,
      people: m.people,
      placeId: m.placeId,
      eventId: m.eventId,
      links: m.links,
      status: m.archivedAt !== null && m.archivedAt <= t ? "archived" : "active",
      forgottenAt: m.forgottenAt !== null && m.forgottenAt <= t ? m.forgottenAt : null,
      meta: m.meta,
    };
    return { view, strength: sample.strength, clarity: sample.clarity };
  }

  /**
   * «Así muere un recuerdo»: su texto, la curva de fuerza y lo que le pasó hasta `t` (null si
   * el paquete no sabe nada de él o aún no existía).
   */
  story(
    memoryId: string,
    t: number,
    thresholds: { forget: number; vague: number } = DEFAULT_THRESHOLDS,
  ): MemoryStory | null {
    const m = this.data.memories.find((x) => x.id === memoryId);
    const audit = this.data.audit
      .filter((a) => a.memoryId === memoryId && STORY_ACTIONS.includes(a.action))
      .sort((a, b) => a.at - b.at);
    const first = audit[0];
    if (!m && !first) return null;
    if (m ? m.createdAt > t : first!.at > t) return null;
    const steps = audit.filter((a) => a.at <= t).map((a) => storyStep(a, this.names));
    const forgotten = steps.find((s) => s.action === "forgotten");
    const at = m ? this.memoryAt(m, t) : null;
    const curve: [number, number][] = m
      ? [
          ...m.strengthAt.filter(([x]) => x <= t).map(([x, v]): [number, number] => [x, v]),
          [t, at!.strength],
        ]
      : [];
    const firstVersion = this.versions.get(memoryId)?.[0];
    return {
      memoryId,
      agentId: m?.agentId ?? first!.agentId,
      text: at?.view.text ?? first!.memoryText,
      firstText: firstVersion?.text ?? at?.view.text ?? first!.memoryText,
      createdAt: m?.createdAt ?? null,
      strength:
        forgotten && forgotten.detail.kind === "forgotten" && !at
          ? forgotten.detail.strength
          : (at?.strength ?? 1),
      clarity: forgotten ? "forgotten" : (at?.clarity ?? "clear"),
      curve,
      span: m?.strengthAt.length
        ? [m.strengthAt[0]![0], Math.max(m.strengthAt.at(-1)![0], m.strengthAt[0]![0] + 1)]
        : [first!.at, (audit.at(-1)?.at ?? first!.at) + 1],
      thresholds,
      steps,
      forgottenAt: forgotten?.at ?? null,
    };
  }

  /** Historial de versiones de un recuerdo hasta `t`. */
  versionsAt(memoryId: string, t: number): MemoryVersion[] {
    return (this.versions.get(memoryId) ?? []).filter((v) => v.at <= t);
  }

  /** El jardín de recuerdos de un vecino en `t`: de más fuerte e importante a menos. */
  agentMemory(agentId: string, t: number, limit = 40, offset = 0): AgentMemoryResponse {
    const scored: ScoredMemoryView[] = [];
    for (const m of this.data.memories) {
      if (m.agentId !== agentId) continue;
      const at = this.memoryAt(m, t);
      if (!at) continue;
      const importance = at.view.importance / 10;
      scored.push({
        memory: at.view,
        // En la repetición no hay consulta (ni embeddings): solo fuerza e importancia.
        scores: {
          recency: 0,
          importance,
          relevance: 0,
          moodMatch: 0,
          strength: at.strength,
          total: at.strength * importance,
          clarity: at.clarity,
        },
      });
    }
    scored.sort((a, b) => b.scores.total - a.scores.total);
    return {
      agentId,
      now: t,
      workingMemory: [],
      memories: scored.slice(offset, offset + limit),
      total: scored.length,
      offset,
      audit: this.data.audit
        .filter((a) => a.agentId === agentId && a.at <= t)
        .sort((a, b) => b.at - a.at)
        .slice(0, 50),
      social: this.profilesAt(t).filter((p) => p.ownerId === agentId),
    };
  }

  /** Las fichas sociales en `t`: la del último cambio de su historial hasta entonces. */
  profilesAt(t: number): SocialProfile[] {
    const out: SocialProfile[] = [];
    for (const p of this.data.profiles) {
      const changes = this.history(p.ownerId, p.aboutId);
      const last = lastBefore(changes, t);
      if (!last) {
        if (p.lastUpdated <= t && !changes.length) out.push(p);
        continue;
      }
      out.push({
        ...p,
        affinity: last.affinity,
        trust: last.trust,
        familiarity: last.familiarity,
        relationshipType: last.relationshipType,
        // El resumen solo se guarda al final: antes de su último cambio, no se enseña.
        summary: p.lastUpdated <= t ? p.summary : "",
        lastUpdated: last.at,
      });
    }
    return out;
  }

  private historyCache = new Map<string, ReplayData["history"]>();
  private history(owner: string, about: string): ReplayData["history"] {
    if (!this.historyCache.size) {
      for (const c of [...this.data.history].sort((a, b) => a.at - b.at)) {
        const key = `${c.ownerId}>${c.aboutId}`;
        const list = this.historyCache.get(key) ?? [];
        list.push(c);
        this.historyCache.set(key, list);
      }
    }
    return this.historyCache.get(`${owner}>${about}`) ?? [];
  }

  relationships(agentId: string, t: number, limit = 50, offset = 0): RelationshipsResponse {
    const profiles = this.profilesAt(t);
    const mine = profiles
      .filter((p) => p.ownerId === agentId && this.names.has(p.aboutId))
      .sort((a, b) => b.affinity - a.affinity);
    const known = new Set(mine.map((p) => p.aboutId));
    return {
      agentId,
      now: t,
      items: mine.slice(offset, offset + limit).map((p) => ({
        name: this.names.get(p.aboutId)!,
        profile: p,
        reciprocal: profiles.find((r) => r.ownerId === p.aboutId && r.aboutId === agentId) ?? null,
        trend: this.history(agentId, p.aboutId)
          .filter((c) => c.at <= t)
          .slice(-12)
          .map((c) => ({ at: c.at, value: c.affinity })),
      })),
      total: mine.length,
      offset,
      unknown: [...this.names]
        .filter(([id]) => id !== agentId && !known.has(id))
        .map(([id, name]) => ({ id, name })),
    };
  }

  relationshipHistory(owner: string, about: string, t: number): RelationshipHistoryResponse {
    return {
      ownerId: owner,
      aboutId: about,
      changes: this.history(owner, about).filter((c) => c.at <= t),
      reciprocal: this.history(about, owner).filter((c) => c.at <= t),
    };
  }

  graph(t: number): SocialGraphResponse {
    return {
      now: t,
      nodes: [...this.names].map(([id, name]) => ({ id, name })),
      profiles: this.profilesAt(t),
    };
  }

  /** Todo el historial de la red hasta `t` (de una vez: el deslizador lo pide por páginas). */
  socialHistory(t: number, since = 0): SocialHistoryResponse {
    return {
      changes: this.data.history
        .filter((c) => c.at >= since && c.at <= t)
        .sort((a, b) => a.at - b.at),
      next: null,
    };
  }

  /** Vista Rashomon de un evento en `t`: cómo lo recordaba cada uno y cómo había cambiado. */
  rashomon(eventId: string, event: SimEvent | null, t: number): RashomonResponse {
    const base = eventId.includes(":") ? eventId.slice(0, eventId.indexOf(":")) : eventId;
    const byAgent = new Map<string, ReplayMemory[]>();
    for (const m of this.byEvent.get(base) ?? []) {
      if (m.createdAt > t) continue;
      byAgent.set(m.agentId, [...(byAgent.get(m.agentId) ?? []), m]);
    }
    const accounts = [...byAgent].map(([agentId, mems]) => ({
      agentId,
      name: this.names.get(agentId) ?? agentId,
      memories: mems
        .sort((a, b) => a.createdAt - b.createdAt)
        .map((m) => {
          const at = this.memoryAt(m, t)!;
          return {
            memory: at.view,
            strength: at.strength,
            clarity: at.clarity,
            versions: this.versionsAt(m.id, t),
          };
        }),
    }));
    return {
      event,
      now: t,
      accounts: accounts.sort((a, b) => a.name.localeCompare(b.name)),
    };
  }

  /** ¿Hay más de un recuerdo de este evento (para ofrecer la vista Rashomon)? */
  hasAccounts(eventId: string): boolean {
    const base = eventId.includes(":") ? eventId.slice(0, eventId.indexOf(":")) : eventId;
    return new Set((this.byEvent.get(base) ?? []).map((m) => m.agentId)).size >= 2;
  }

  goals(agentId: string, t: number): AgentGoalsResponse {
    return {
      agentId,
      now: t,
      goals: this.data.goals
        .filter((g) => g.agentId === agentId)
        .map((g) => goalAt(g, t))
        .filter((g): g is Goal => g !== null),
    };
  }

  skills(agentId: string, t: number): AgentSkillsResponse {
    return {
      agentId,
      now: t,
      labels: this.data.skillLabels,
      skills: this.data.skills
        .filter((s) => s.agentId === agentId)
        .map((s) => skillAt(s, t))
        .filter((s): s is SkillState => s !== null),
    };
  }

  lore(t: number): LoreResponse {
    return {
      now: t,
      items: this.data.lore
        .filter((l) => l.createdAt <= t)
        .map((lore) => ({
          lore: { ...lore, lostAt: lore.lostAt !== null && lore.lostAt <= t ? lore.lostAt : null },
          holders: this.data.holders
            .filter((h) => h.loreId === lore.id && h.learnedAt <= t)
            .map((h) => ({
              ...h,
              forgottenAt: h.forgottenAt !== null && h.forgottenAt <= t ? h.forgottenAt : null,
            })),
        })),
    };
  }
}

/** La última entrada con `at ≤ t` de una lista ordenada por `at`. */
function lastBefore<T extends { at: number }>(list: readonly T[], t: number): T | undefined {
  let found: T | undefined;
  for (const x of list) {
    if (x.at > t) break;
    found = x;
  }
  return found;
}

/** Fuerza y claridad en `t`, de las muestras del paquete (interpolando en escala logarítmica). */
export function strengthSample(m: ReplayMemory, t: number): { strength: number; clarity: Clarity } {
  const s = m.strengthAt;
  const first = s[0];
  if (!first || t <= first[0]) {
    const clarity: Clarity = m.forgottenAt !== null && m.forgottenAt <= t ? "forgotten" : "clear";
    return { strength: first ? first[1] : m.strength, clarity: first ? first[2] : clarity };
  }
  for (let i = 1; i < s.length; i++) {
    const [t1, v1, c1] = s[i]!;
    if (t1 < t) continue;
    const [t0, v0, c0] = s[i - 1]!;
    const k = t1 === t0 ? 1 : (t - t0) / (t1 - t0);
    const strength =
      v0 > 0 && v1 > 0 ? Math.exp(Math.log(v0) + (Math.log(v1) - Math.log(v0)) * k) : v0;
    return { strength, clarity: k < 1 ? c0 : c1 };
  }
  const last = s[s.length - 1]!;
  return { strength: last[1], clarity: last[2] };
}

/** Una meta tal como estaba en `t` (null si aún no existía). */
export function goalAt(g: Goal, t: number): Goal | null {
  if (g.createdAt > t) return null;
  const history = g.history.filter((h) => h.at <= t);
  const last = history[history.length - 1];
  if (!last) return { ...g, history };
  return {
    ...g,
    status: last.status,
    progress: last.progress,
    motivation: last.motivation,
    frustration: last.frustration,
    updatedAt: last.at,
    history,
  };
}

/** Una habilidad tal como estaba en `t` (null si aún no la tenía). */
export function skillAt(s: SkillState, t: number): SkillState | null {
  const history = s.history.filter((h) => h.at <= t);
  const last = history[history.length - 1];
  if (!last) return s.history.length ? null : s.updatedAt <= t ? s : null;
  const level = Math.min(1, Math.max(0, last.level));
  return {
    ...s,
    level: s.updatedAt <= t ? s.level : level,
    peak: Math.max(level, ...history.map((h) => h.level)),
    lastUsedAt: s.lastUsedAt !== null && s.lastUsedAt <= t ? s.lastUsedAt : null,
    tier: s.updatedAt <= t ? s.tier : null,
    history,
  };
}
