import { randomUUID } from "node:crypto";
import type { MemoryAuditEntry } from "@lethetown/shared";
import { seededRng, type Rng } from "../util/random";
import { DEFAULT_MEMORY_CONFIG, type MemoryConfig } from "./config";
import { initialStability, reinforce } from "./decay";
import type { MinorGuard } from "../agent/minor-safety";
import { reduceDetails } from "./encoding";
import type { Reconsolidator } from "./human";
import { NEUTRAL_PROFILE, stabilityFactor, type MemoryProfile } from "./psychology";
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
  kind:
    | "recall"
    | "vague"
    | "forget"
    | "gist"
    | "reconsolidate"
    | "consolidate"
    | "archive"
    | "intrusive"
    | "false_memory"
    | "intention";
  /** Intenciones: si se acordó a tiempo o se le olvidó. */
  outcome?: "kept" | "forgotten";
  /** Otros implicados (p. ej. la persona de una intención). */
  others?: string[];
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
  /** Protección de menores: lo que no pase no se guarda (ver agent/minor-safety.ts). */
  guard?: MinorGuard;
  /** Perfil de memoria de cada agente (ver psychology.ts); sin él, el neutro. */
  profiles?: Record<string, MemoryProfile>;
}

/** Un recuerdo que no se guarda porque la protección de menores lo descartó. */
export class BlockedContentError extends Error {
  constructor() {
    super("Contenido descartado por la protección de menores");
    this.name = "BlockedContentError";
  }
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
  /** Recuerdos que no deben salir (p. ej. porque ya se han recordado por otra vía). */
  exclude?: string[];
}

/** Orquesta almacén + embeddings + puntuación + decaimiento/refuerzo + reconsolidación. */
export class MemorySystem {
  readonly store: MemoryStore;
  readonly embedder: Embedder;
  readonly config: MemoryConfig;
  readonly rng: Rng;
  readonly guard?: MinorGuard;
  private readonly profiles: Record<string, MemoryProfile>;
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
    this.guard = deps.guard;
    this.profiles = deps.profiles ?? {};
  }

  /** Perfil de memoria del dueño (edad, personalidad, semilla). */
  profileOf(agentId: string): MemoryProfile {
    return this.profiles[agentId] ?? NEUTRAL_PROFILE;
  }

  /** Pesos y umbrales de recuperación ajustados al perfil del dueño. */
  retrievalFor(agentId: string): RetrievalConfig {
    const p = this.profileOf(agentId);
    const base = this.config.retrieval;
    return {
      ...base,
      weights: { ...base.weights, moodMatch: base.weights.moodMatch * p.moodCongruence },
      reminiscenceBoost: p.reminiscenceRecall,
    };
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

  /**
   * Guarda un recuerdo. Si la protección de menores lo descarta, lanza `BlockedContentError`
   * (ver `tryRemember`).
   */
  async remember(input: NewMemory, now: number): Promise<MemoryRecord> {
    if (
      this.guard &&
      !(await this.guard.allows(input.text, {
        kind: input.type === "reflection" ? "reflection" : "memory",
        actors: [input.agentId, ...(input.people ?? [])],
        agentId: input.agentId,
      }))
    ) {
      throw new BlockedContentError();
    }
    const [embedding] = await this.embedder.embed([input.text]);
    const valence = input.emotionalValence ?? 0;
    const importance = Math.min(10, Math.max(1, Math.round(input.importance)));
    const record: MemoryRecord = {
      id: this.newId(),
      agentId: input.agentId,
      text: input.text,
      // Con activación extrema solo se graba la esencia (sin LLM).
      gist: input.meta?.gistOnly ? reduceDetails(input.text) : null,
      embedding: embedding ?? [],
      createdAt: now,
      lastAccessedAt: now,
      importance,
      emotionalValence: valence,
      strength: Math.min(1, Math.max(0, input.strength ?? 1)),
      stability:
        initialStability(importance, valence, this.config.decay) *
        stabilityFactor(this.profileOf(input.agentId), {
          type: input.type,
          text: input.text,
          youth: input.meta?.youth,
          valence,
        }),
      accessCount: 0,
      source: input.source ?? "vivido",
      type: input.type,
      people: input.people ?? [],
      placeId: input.placeId ?? null,
      eventId: input.eventId ?? null,
      links: input.links ?? [],
      status: "active",
      forgottenAt: null,
      meta: input.meta ?? {},
    };
    await this.store.add(record);
    return record;
  }

  /** Como `remember`, pero devuelve null si la protección de menores lo descarta. */
  async tryRemember(input: NewMemory, now: number): Promise<MemoryRecord | null> {
    try {
      return await this.remember(input, now);
    } catch (error) {
      if (error instanceof BlockedContentError) return null;
      throw error;
    }
  }

  /** Puntúa todos los recuerdos del agente sin modificarlos (para el inspector). */
  async inspect(opts: Omit<RetrieveOptions, "k" | "recall">): Promise<ScoredMemory[]> {
    const [embedding] = await this.embedder.embed([opts.query]);
    const query = { embedding: embedding ?? [], now: opts.now, moodValence: opts.moodValence };
    if (this.store.listForInspection) {
      // El almacén calcula la similitud: no hace falta traer los embeddings.
      const rows = await this.store.listForInspection(opts.agentId, query.embedding);
      return rows
        .map((r) => scoreMemory(r.memory, query, this.retrievalFor(opts.agentId), r.relevance))
        .sort((a, b) => b.scores.total - a.scores.total);
    }
    const all = await this.store.listByAgent(opts.agentId);
    return rankMemories(all, query, this.retrievalFor(opts.agentId));
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
      this.retrievalFor(opts.agentId),
    );
    const picked = ranked
      .filter((s) => s.memory.status === "active" && s.scores.clarity !== "forgotten")
      .filter((s) => !opts.exclude?.includes(s.memory.id))
      .slice(0, opts.k ?? 5);
    await this.strengthen(picked, opts.now, opts.recall);
    return picked;
  }

  /**
   * Recuerda unos recuerdos concretos (p. ej. el diario de ayer y los hábitos) con las mismas
   * reglas que `retrieve`: lo olvidado no sale, lo vago sale como esencia y recordar refuerza.
   */
  async recallByIds(
    ids: string[],
    now: number,
    moodValence: number,
    recall?: RecallContext,
  ): Promise<ScoredMemory[]> {
    const found = await Promise.all([...new Set(ids)].map((id) => this.store.get(id)));
    const picked = found
      .filter((m): m is MemoryRecord => m?.status === "active")
      // La relevancia no importa aquí (se piden por id): cuenta como plena.
      .map((m) =>
        scoreMemory(m, { embedding: [], now, moodValence }, this.retrievalFor(m.agentId), 1),
      )
      .filter((s) => s.scores.clarity !== "forgotten");
    await this.strengthen(picked, now, recall);
    return picked;
  }

  /**
   * Recuerdo intrusivo: con baja probabilidad, un recuerdo importante y negativo entra en la
   * mente sin buscarlo. Más probable con el ánimo bajo, con neuroticismo alto o si hay una pista
   * (el lugar donde pasó o alguien que salía en él). Rumiarlo lo refuerza. Usa el rng inyectado.
   */
  async intrude(opts: {
    agentId: string;
    now: number;
    /** Minutos de juego desde la última comprobación. */
    minutes: number;
    moodValence: number;
    neuroticism: number;
    placeId: string;
    present: string[];
  }): Promise<ScoredMemory | null> {
    const cfg = this.config.intrusive;
    if (!cfg.enabled || opts.minutes <= 0) return null;
    const rate =
      cfg.basePerHour *
      (1 + cfg.lowMoodFactor * Math.max(0, -opts.moodValence)) *
      Math.max(0, 1 + cfg.neuroticismFactor * (opts.neuroticism - 0.5) * 2);
    const chance = (perHour: number) => 1 - Math.pow(1 - Math.min(1, perHour), opts.minutes / 60);
    // Primero la tirada (casi siempre falla): así no hace falta leer los recuerdos.
    const roll = this.rng();
    if (roll >= chance(rate * cfg.cueFactor)) return null;
    const retrieval = this.retrievalFor(opts.agentId);
    const candidates = (await this.store.listByAgent(opts.agentId))
      .filter(
        (m) =>
          m.status === "active" &&
          m.importance >= cfg.minImportance &&
          m.emotionalValence <= cfg.maxValence,
      )
      .map((m) =>
        scoreMemory(
          m,
          { embedding: [], now: opts.now, moodValence: opts.moodValence },
          retrieval,
          1,
        ),
      )
      .filter((s) => s.scores.clarity !== "forgotten");
    if (!candidates.length) return null;
    const cued = candidates.filter(
      (s) =>
        s.memory.placeId === opts.placeId || s.memory.people.some((p) => opts.present.includes(p)),
    );
    if (roll >= chance(cued.length ? rate * cfg.cueFactor : rate)) return null;
    const pool = cued.length ? cued : candidates;
    const weights = pool.map((s) => s.memory.importance * Math.abs(s.memory.emotionalValence));
    let pick = this.rng() * weights.reduce((a, b) => a + b, 0);
    const chosen = pool.find((_, i) => (pick -= weights[i]!) <= 0) ?? pool[0]!;
    await this.store.update(
      chosen.memory.id,
      reinforce(chosen.memory, opts.now, this.config.decay),
    );
    this.emitEffect({
      kind: "intrusive",
      agentId: opts.agentId,
      memoryId: chosen.memory.id,
      text: recallText(chosen),
      importance: chosen.memory.importance,
    });
    return chosen;
  }

  /** Recordar fortalece (todos los refuerzos en una operación) y puede reconsolidar. */
  private async strengthen(picked: ScoredMemory[], now: number, recall?: RecallContext) {
    await this.store.updateMany(
      picked.map((s) => ({
        id: s.memory.id,
        patch: reinforce(s.memory, now, this.config.decay),
      })),
    );
    for (const s of picked) {
      this.emitEffect({
        kind: s.scores.clarity === "vague" ? "vague" : "recall",
        agentId: s.memory.agentId,
        memoryId: s.memory.id,
        text: recallText(s),
      });
      if (!recall) continue;
      // Puede rellenar huecos (falso recuerdo); si no, lo nítido puede reconsolidarse.
      if (!(await this.maybeConfabulate(s, recall, now))) {
        await this.maybeReconsolidate(s, recall, now);
      }
    }
  }

  /**
   * Falso recuerdo controlado: al recordar algo vago, con baja probabilidad (más si es
   * sugestionable) rellena los huecos con detalles que no vivió. Queda marcado (`meta`,
   * versión y auditoría) para el inspector y Rashomon, aunque el agente no lo sabe.
   */
  async maybeConfabulate(s: ScoredMemory, ctx: RecallContext, now: number): Promise<boolean> {
    const cfg = this.config.falseMemory;
    const m = s.memory;
    if (!cfg.enabled || !this.reconsolidator?.confabulate) return false;
    if (m.importance < cfg.minImportance || m.type === "plan" || m.meta?.gistOnly) return false;
    // Una sola reconstrucción por recuerdo (no se vuelve a rellenar lo ya rellenado).
    if (m.meta?.falseMemory) return false;
    if (now - m.createdAt < cfg.minAgeHours * 60) return false;
    const holes = 1 - s.scores.strength;
    const p = Math.min(1, cfg.probability * this.profileOf(m.agentId).suggestibility * holes);
    if (this.rng() >= p) return false;
    const vague = recallText(s);
    const filled = await this.reconsolidator.confabulate(m, vague, {
      now,
      system: ctx.system,
      moodLabel: ctx.moodLabel,
      socialSummary: await ctx.socialSummary(m.people),
    });
    if (!filled || filled.text === m.text) return false;
    const safe = await this.guard?.allows(filled.text, {
      kind: "reconsolidation",
      actors: [m.agentId, ...m.people],
      agentId: m.agentId,
    });
    if (safe === false) return false;
    await this.store.transaction(async (tx) => {
      const previous = await tx.versions(m.id);
      await tx.addVersion({
        memoryId: m.id,
        version: previous.length,
        text: m.text,
        emotionalValence: m.emotionalValence,
        source: m.source,
        at: now,
        reason: "falso recuerdo: rellenó los huecos al recordarlo",
      });
      await tx.update(m.id, {
        text: filled.text,
        gist: null,
        emotionalValence: filled.emotionalValence,
        meta: { ...m.meta, falseMemory: true },
      });
      await tx.addAudit({
        agentId: m.agentId,
        memoryId: m.id,
        memoryText: m.text,
        action: "false_memory",
        reason: `solo recordaba «${vague}» y su mente rellenó los huecos: «${filled.text}»`,
        at: now,
      });
    });
    s.memory.text = filled.text;
    this.emitEffect({
      kind: "false_memory",
      agentId: m.agentId,
      memoryId: m.id,
      text: filled.text,
      importance: m.importance,
    });
    return true;
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
    const safe = await this.guard?.allows(rewritten.text, {
      kind: "reconsolidation",
      actors: [m.agentId, ...m.people],
      agentId: m.agentId,
    });
    if (safe === false) return;
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
