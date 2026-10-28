import { randomUUID } from "node:crypto";
import { DEFAULT_DECAY, initialStability, reinforce, type DecayConfig } from "./decay";
import {
  DEFAULT_RETRIEVAL,
  rankMemories,
  type RetrievalConfig,
  type ScoredMemory,
} from "./retrieval";
import type { Embedder, MemoryRecord, MemoryStore, NewMemory } from "./types";

export interface MemorySystemDeps {
  store: MemoryStore;
  embedder: Embedder;
  retrieval?: RetrievalConfig;
  decay?: DecayConfig;
  /** Candidatos que se piden al almacén antes de puntuar. */
  candidateLimit?: number;
  idGenerator?: () => string;
}

export interface RetrieveOptions {
  agentId: string;
  query: string;
  now: number;
  moodValence: number;
  k?: number;
}

/** Orquesta almacén + embeddings + puntuación + decaimiento/refuerzo. */
export class MemorySystem {
  readonly store: MemoryStore;
  readonly embedder: Embedder;
  readonly retrievalConfig: RetrievalConfig;
  readonly decayConfig: DecayConfig;
  private readonly candidateLimit: number;
  private readonly newId: () => string;

  constructor(deps: MemorySystemDeps) {
    this.store = deps.store;
    this.embedder = deps.embedder;
    this.retrievalConfig = deps.retrieval ?? DEFAULT_RETRIEVAL;
    this.decayConfig = deps.decay ?? DEFAULT_DECAY;
    this.candidateLimit = deps.candidateLimit ?? 200;
    this.newId = deps.idGenerator ?? randomUUID;
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
      stability: initialStability(importance, valence, this.decayConfig),
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
  async inspect(opts: Omit<RetrieveOptions, "k">): Promise<ScoredMemory[]> {
    const [embedding] = await this.embedder.embed([opts.query]);
    const all = await this.store.listByAgent(opts.agentId);
    return rankMemories(
      all,
      { embedding: embedding ?? [], now: opts.now, moodValence: opts.moodValence },
      this.retrievalConfig,
    );
  }

  /**
   * Recupera los k mejores recuerdos no olvidados y los refuerza (recordar fortalece).
   * TODO(fase 2): pasar aquí por el Reconsolidator para deformar lo recordado.
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
      this.retrievalConfig,
    );
    const picked = ranked
      .filter((s) => s.memory.status === "active" && s.scores.clarity !== "forgotten")
      .slice(0, opts.k ?? 5);
    await Promise.all(
      picked.map((s) =>
        this.store.update(s.memory.id, reinforce(s.memory, opts.now, this.decayConfig)),
      ),
    );
    return picked;
  }
}
