import { randomUUID } from "node:crypto";
import type { MemoryEffect, SocialProfileStore } from "@lethetown/agent-core";
import {
  AFFINITY_DRAMA_DELTA,
  DRAMA_MIN_SCORE,
  dramaScore,
  looksLikeRumor,
  type Drama,
  type DramaKind,
  type SimEvent,
  type SocialProfile,
} from "@lethetown/shared";

/** Dos dramas del mismo tipo con los mismos agentes en menos de esto (min de juego) son uno. */
const DEDUPE_MINUTES = 30;

export interface DramaContext {
  now(): number;
  name(agentId: string): string;
  placeOf(agentId: string): string | null;
}

/**
 * Detecta "dramas" (rumores, discusiones, amistades, reconsolidaciones fuertes, olvidos
 * importantes) a partir de los eventos, los efectos de memoria y los cambios de afinidad.
 * No cambia la simulación: solo observa.
 */
export class DramaDetector {
  private readonly recent: { key: string; time: number }[] = [];
  private readonly listeners: ((d: Drama) => void)[] = [];

  constructor(private readonly ctx: DramaContext) {}

  onDrama(listener: (d: Drama) => void): void {
    this.listeners.push(listener);
  }

  /** Frases con oyentes de más: alguien escuchaba; si además cuenta algo oído, es un rumor. */
  onEvent(e: SimEvent): void {
    // Plantón en una cita.
    if (e.meta?.action === "meeting" && e.meta.ok === false && e.text.startsWith("💔")) {
      this.publish(
        "meeting_failed",
        dramaScore.meetingFailed(e.participants.length - 1),
        e.text.replace(/^💔 /, ""),
        e.participants,
        e.agentId ? this.ctx.placeOf(e.agentId) : null,
        e.id,
      );
      return;
    }
    // Alguien descubre un sitio del pueblo.
    if (e.meta?.action === "discover") {
      this.publish(
        "discovery",
        dramaScore.discovery(),
        e.text.replace(/^🧭 /, ""),
        e.participants,
        e.agentId ? this.ctx.placeOf(e.agentId) : null,
        e.id,
      );
      return;
    }
    if (e.kind !== "speech" || !e.agentId) return;
    // En un grupo, los demás del grupo están en la conversación: no escuchan a escondidas.
    const group = new Set(e.meta?.group ?? []);
    const hidden = e.participants.slice(2).filter((id) => !group.has(id));
    const listeners = hidden.length;
    const rumor = looksLikeRumor(e.text);
    if (listeners <= 0 && !rumor) return;
    const kind: DramaKind = rumor ? "rumor" : "eavesdrop";
    const others = hidden.map((id) => this.ctx.name(id));
    const speaker = this.ctx.name(e.agentId);
    const title = rumor
      ? `${speaker} va contando lo que oyó${others.length ? ` (y ${others.join(", ")} lo oye)` : ""}`
      : `${others.join(", ")} escucha a escondidas a ${speaker}`;
    const score = rumor ? dramaScore.rumor(listeners) : dramaScore.eavesdrop(listeners);
    this.publish(kind, score, title, e.participants, this.ctx.placeOf(e.agentId), e.id);
  }

  onEffect(e: MemoryEffect): void {
    const importance = e.importance ?? 0;
    if (e.kind === "reconsolidate") {
      this.publish(
        "reconsolidation",
        dramaScore.reconsolidation(importance),
        `${this.ctx.name(e.agentId)} recuerda distinto: «${clip(e.text)}»`,
        [e.agentId],
        this.ctx.placeOf(e.agentId),
        null,
      );
    } else if (e.kind === "intention") {
      const kept = e.outcome === "kept";
      this.publish(
        kept ? "intention_kept" : "intention_forgotten",
        dramaScore.intention(importance, !kept),
        kept
          ? `${this.ctx.name(e.agentId)} se acuerda de ${clip(e.text)}`
          : `A ${this.ctx.name(e.agentId)} se le olvida ${clip(e.text)}`,
        [e.agentId, ...(e.others ?? [])],
        this.ctx.placeOf(e.agentId),
        null,
      );
    } else if (e.kind === "false_memory") {
      this.publish(
        "false_memory",
        dramaScore.falseMemory(importance),
        `${this.ctx.name(e.agentId)} «recuerda» algo que no pasó así: «${clip(e.text)}»`,
        [e.agentId],
        this.ctx.placeOf(e.agentId),
        null,
      );
    } else if (e.kind === "forget") {
      this.publish(
        "forgetting",
        dramaScore.forgetting(importance),
        `${this.ctx.name(e.agentId)} olvida «${clip(e.text)}»`,
        [e.agentId],
        this.ctx.placeOf(e.agentId),
        null,
      );
    }
  }

  onSocial(before: SocialProfile | undefined, after: SocialProfile): void {
    // La relación cambia de tipo (de vecinos a amigos, de amistad a rivalidad…).
    const beforeType = before?.relationshipType ?? "neighbor";
    if (
      after.relationshipType !== beforeType &&
      ["friendship", "rivalry", "romantic"].includes(after.relationshipType)
    ) {
      const a = this.ctx.name(after.ownerId);
      const b = this.ctx.name(after.aboutId);
      const title = {
        friendship: `${a} ya considera a ${b} un amigo`,
        rivalry: `${a} ya ve a ${b} como un rival`,
        romantic: `${a} se ha enamorado de ${b}`,
      }[after.relationshipType as "friendship" | "rivalry" | "romantic"];
      this.publish(
        "relationship",
        dramaScore.relationship(after.affinity),
        title,
        [after.ownerId, after.aboutId],
        this.ctx.placeOf(after.ownerId),
        null,
      );
    }
    const delta = after.affinity - (before?.affinity ?? 0);
    if (Math.abs(delta) < AFFINITY_DRAMA_DELTA) return;
    const kind: DramaKind = delta < 0 ? "argument" : "friendship";
    const a = this.ctx.name(after.ownerId);
    const b = this.ctx.name(after.aboutId);
    const title =
      kind === "argument"
        ? `${a} se lleva peor con ${b}: «${clip(after.summary)}»`
        : `${a} se acerca a ${b}: «${clip(after.summary)}»`;
    this.publish(
      kind,
      dramaScore.affinity(delta),
      title,
      [after.ownerId, after.aboutId],
      this.ctx.placeOf(after.ownerId),
      null,
    );
  }

  /** Envuelve un SocialProfileStore para enterarse de los cambios de afinidad. */
  observe(store: SocialProfileStore): SocialProfileStore {
    return {
      get: (o, a) => store.get(o, a),
      list: (o) => store.list(o),
      listAll: () => store.listAll(),
      addHistory: (c) => store.addHistory(c),
      history: (o, a, opts) => store.history(o, a, opts),
      upsert: async (p) => {
        const before = await store.get(p.ownerId, p.aboutId);
        await store.upsert(p);
        this.onSocial(before, p);
      },
    };
  }

  private publish(
    kind: DramaKind,
    score: number,
    title: string,
    agents: string[],
    placeId: string | null,
    eventId: string | null,
  ): void {
    if (score < DRAMA_MIN_SCORE) return;
    const time = this.ctx.now();
    const key = `${kind}:${[...agents].sort().join(",")}`;
    while (this.recent.length && time - this.recent[0]!.time > DEDUPE_MINUTES) this.recent.shift();
    if (this.recent.some((r) => r.key === key)) return;
    this.recent.push({ key, time });
    const drama: Drama = { id: randomUUID(), time, kind, score, title, agents, placeId, eventId };
    for (const l of this.listeners) l(drama);
  }
}

function clip(text: string, max = 70): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
