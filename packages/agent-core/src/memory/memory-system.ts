import { randomUUID } from "node:crypto";
import type { MemoryAuditEntry } from "@lethetown/shared";
import { seededRng, type Rng } from "../util/random";
import { DEFAULT_MEMORY_CONFIG, type MemoryConfig } from "./config";
import { initialStability, reinforce } from "./decay";
import type { Reconsolidator } from "./human";
import {
  rankMemories,
  scoreMemory,
  recallText,
  type RetrievalConfig,
  type ScoredMemory,
} from "./retrieval";
import type { Embedder, MemoryRecord, MemoryStore, NewMemory } from "./types";

/** Efectos visibles de la memoria (el servidor los emite por WebSocket). */
export interface MemoryEffect {
  kind: "recall" | "vague" | "forget" | "gist" | "reconsolidate" | "consolidate" | "archive";
  agentId: string;
  memoryId: string;
  text: string;
  /** Importancia del recuerdo (1-10), para puntuar el "drama" de un olvido o una reescritura. */
  importance?: number;
}

export interface MemorySystemDeps {
  store: MemoryStore;
  embedder: Embedder;
  config?: MemoryConfig;
  reconsolidator?: Reconsolidator;
  /** Candidatos que se piden al almacén antes de puntuar. */
  candidateLimit?: number;
  idGenerator?: () => string;
  rng?: Rng;
}

/** Contexto para reconsolidar al recordar (identidad del agente y lo que piensa de otros). */
export interface RecallContext {
  system: string;
  moodLabel: string;
  /** Resumen de lo que el agente piensa de las personas implicadas. */
  socialSummary: (people: string[]) => Promise<string>;
}

export interface RetrieveOptions {
  agentId: string;
  query: string;
  now: number;
  moodValence: number;
  k?: number;
  /** Si se pasa, los recuerdos recuperados pueden reconsolidarse (reescribirse). */
  recall?: RecallContext;
}

/** Orquesta almacén + embeddings + puntuación + decaimiento/refuerzo + reconsolidación. */
export class MemorySystem {
  readonly store: MemoryStore;
  readonly embedder: Embedder;
  readonly config: MemoryConfig;
  readonly rng: Rng;
  private readonly reconsolidator?: Reconsolidator;
  private readonly candidateLimit: number;
  private readonly newId: () => string;
  private readonly effectListeners: ((e: MemoryEffect) => void)[] = [];

  constructor(deps: MemorySystemDeps) {
    this.store = deps.store;
    this.embedder = deps.embedder;
    this.config = deps.config ?? DEFAULT_MEMORY_CONFIG;
    this.reconsolidator = deps.reconsolidator;
    this.candidateLimit = deps.candidateLimit ?? 200;
    this.newId = deps.idGenerator ?? randomUUID;
    this.rng = deps.rng ?? seededRng(Date.now());
  }

  get retrievalConfig(): RetrievalConfig {
    return this.config.retrieval;
  }

  onEffect(listener: (e: MemoryEffect) => void): void {
    this.effectListeners.push(listener);
  }

  emitEffect(effect: MemoryEffect): void {
    for (const l of this.effectListeners) l(effect);
  }

  async audit(entry: MemoryAuditEntry): Promise<void> {
    await this.store.addAudit(entry);
  }

  async remember(input: NewMemory, now: number): Promise<MemoryRecord> {
    const [embedding] = await this.embedder.embed([input.text]);
    const valence = input.emotionalValence ?? 0;
    const importance = Math.min(10, Math.max(1, Math.round(input.importance)));
    const record: MemoryRecord = {
      id: this.newId(),
      agentId: input.agentId,
      text: input.text,
      gist: null,
      embedding: embedding ?? [],
      createdAt: now,
      lastAccessedAt: now,
      importance,
      emotionalValence: valence,
      strength: 1,
      stability: initialStability(importance, valence, this.config.decay),
      accessCount: 0,
      source: input.source ?? "vivido",
      type: input.type,
      people: input.people ?? [],
      placeId: input.placeId ?? null,
      eventId: input.eventId ?? null,
      links: input.links ?? [],
      status: "active",
      forgottenAt: null,
    };
    await this.store.add(record);
    return record;
  }

  /** Puntúa todos los recuerdos del agente sin modificarlos (para el inspector). */
  async inspect(opts: Omit<RetrieveOptions, "k" | "recall">): Promise<ScoredMemory[]> {
    const [embedding] = await this.embedder.embed([opts.query]);
    const query = { embedding: embedding ?? [], now: opts.now, moodValence: opts.moodValence };
    if (this.store.listForInspection) {
      // El almacén calcula la similitud: no hace falta traer los embeddings.
      const rows = await this.store.listForInspection(opts.agentId, query.embedding);
      return rows
        .map((r) => scoreMemory(r.memory, query, this.config.retrieval, r.relevance))
        .sort((a, b) => b.scores.total - a.scores.total);
    }
    const all = await this.store.listByAgent(opts.agentId);
    return rankMemories(all, query, this.config.retrieval);
  }

  /**
   * Recupera los k mejores recuerdos no olvidados, los refuerza (recordar fortalece) y, con
   * cierta probabilidad, los reconsolida: el recuerdo se reescribe influido por el ánimo actual.
   */
  async retrieve(opts: RetrieveOptions): Promise<ScoredMemory[]> {
    const [embedding] = await this.embedder.embed([opts.query]);
    const candidates = await this.store.candidates(
      opts.agentId,
      embedding ?? [],
      this.candidateLimit,
    );
    const ranked = rankMemories(
      candidates,
      { embedding: embedding ?? [], now: opts.now, moodValence: opts.moodValence },
      this.config.retrieval,
    );
    const picked = ranked
      .filter((s) => s.memory.status === "active" && s.scores.clarity !== "forgotten")
      .slice(0, opts.k ?? 5);
    // Recordar fortalece: todos los refuerzos en una sola operación.
    await this.store.updateMany(
      picked.map((s) => ({
        id: s.memory.id,
        patch: reinforce(s.memory, opts.now, this.config.decay),
      })),
    );
    for (const s of picked) {
      this.emitEffect({
        kind: s.scores.clarity === "vague" ? "vague" : "recall",
        agentId: s.memory.agentId,
        memoryId: s.memory.id,
        text: recallText(s),
      });
      if (opts.recall) await this.maybeReconsolidate(s, opts.recall, opts.now);
    }
    return picked;
  }

  private async maybeReconsolidate(s: ScoredMemory, ctx: RecallContext, now: number) {
    const cfg = this.config.reconsolidation;
    const m = s.memory;
    if (!this.reconsolidator || s.scores.clarity !== "clear") return;
    if (m.importance < cfg.minImportance || m.type === "plan") return;
    if (this.rng() >= cfg.probability) return;
    const rewritten = await this.reconsolidator.reconsolidate(m, {
      now,
      system: ctx.system,
      moodLabel: ctx.moodLabel,
      socialSummary: await ctx.socialSummary(m.people),
    });
    if (!rewritten || rewritten.text === m.text) return;
    // Versión + cambio + auditoría, todo o nada.
    await this.store.transaction(async (tx) => {
      const previous = await tx.versions(m.id);
      await tx.addVersion({
        memoryId: m.id,
        version: previous.length,
        text: m.text,
        emotionalValence: m.emotionalValence,
        source: m.source,
        at: now,
        reason: "reconsolidación al recordar",
      });
      await tx.update(m.id, {
        text: rewritten.text,
        emotionalValence: rewritten.emotionalValence,
      });
      await tx.addAudit({
        agentId: m.agentId,
        memoryId: m.id,
        memoryText: m.text,
        action: "reconsolidated",
        reason: `al recordarlo con ánimo "${ctx.moodLabel}" pasó a: "${rewritten.text}"`,
        at: now,
      });
    });
    s.memory.text = rewritten.text;
    this.emitEffect({
      kind: "reconsolidate",
      agentId: m.agentId,
      memoryId: m.id,
      text: rewritten.text,
      importance: m.importance,
    });
  }
}
