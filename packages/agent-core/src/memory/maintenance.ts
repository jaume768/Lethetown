import { estimateTextTokens } from "../util/random";
import { currentStrength } from "./decay";
import type { EpisodeSummarizer, GistCompressor, MemoryOwner, SourceConfuser } from "./human";
import type { MemorySystem } from "./memory-system";
import { cosine, scoreMemory } from "./retrieval";
import type { MemoryRecord } from "./types";

export interface MaintenanceDeps {
  memory: MemorySystem;
  gist?: GistCompressor;
  confuser?: SourceConfuser;
  summarizer?: EpisodeSummarizer;
  onError?: (task: string, error: unknown) => void;
}

export interface MaintenanceReport {
  forgotten: string[];
  gists: string[];
  sourceChanged: string[];
  deleted: string[];
  archived: string[];
  summaries: string[];
  /** Recuerdos cuya carga emocional se suavizó (desvanecimiento afectivo). */
  faded: string[];
  /** Recuerdos que, al volverse vagos, se rellenaron con detalles inventados. */
  falseMemories: string[];
}

const HOUR = 60;

/**
 * Mantenimiento periódico de la memoria de un agente (el servidor lo llama cada hora de juego):
 * marca lo olvidado, comprime lo vago a su esencia, confunde fuentes y aplica el olvido por
 * presupuesto. Cada decisión queda registrada en el audit con su motivo.
 */
export class MemoryMaintenance {
  private readonly lastRun = new Map<string, number>();

  constructor(private readonly deps: MaintenanceDeps) {}

  private get memory() {
    return this.deps.memory;
  }

  async run(owner: MemoryOwner, now: number, others: string[]): Promise<MaintenanceReport> {
    const report: MaintenanceReport = {
      forgotten: [],
      gists: [],
      sourceChanged: [],
      deleted: [],
      archived: [],
      summaries: [],
      faded: [],
      falseMemories: [],
    };
    const cfg = this.memory.config;
    const since = this.lastRun.get(owner.agentId) ?? now;
    this.lastRun.set(owner.agentId, now);
    const elapsedDays = Math.max(0, now - since) / (24 * HOUR);
    const confuseP = 1 - Math.pow(1 - cfg.sourceConfusion.dailyProbability, elapsedDays);

    for (const m of await this.memory.store.listActive(owner.agentId)) {
      if (m.status !== "active") continue;
      const s = currentStrength(m, now);
      if (s < cfg.retrieval.forgetThreshold) {
        if (m.forgottenAt === null) await this.markForgotten(owner, m, s, now, report);
        continue;
      }
      if (
        s < cfg.retrieval.vagueThreshold &&
        !m.gist &&
        cfg.gist.enabled &&
        m.importance >= cfg.gist.minImportance &&
        this.deps.gist
      ) {
        // Al volverse vago, a veces la mente lo reconstruye con detalles que no vivió (falso
        // recuerdo) en vez de quedarse con la esencia; la esencia llegará después.
        const filled = await this.memory
          .maybeConfabulate(
            {
              memory: m,
              scores: scoreMemory(
                m,
                { embedding: [], now, moodValence: 0 },
                this.memory.retrievalFor(owner.agentId),
                1,
              ).scores,
            },
            {
              system: owner.system,
              moodLabel: "neutral (activación baja)",
              socialSummary: async () => "",
            },
            now,
          )
          .catch((error: unknown) => {
            this.deps.onError?.("confabulate", error);
            return false;
          });
        if (filled) report.falseMemories.push(m.id);
        else await this.makeGist(owner, m, now, report);
      }
      if (
        this.deps.confuser &&
        confuseP > 0 &&
        now - m.createdAt >= cfg.sourceConfusion.minAgeHours * HOUR
      ) {
        // Niños y despistados confunden más la fuente (perfil del dueño).
        const p = Math.min(1, confuseP * this.memory.profileOf(owner.agentId).sourceConfusion);
        const next = this.deps.confuser.confuse(m, p, others);
        if (next && next !== m.source) await this.changeSource(owner, m, next, now, report);
      }
      await this.fadeAffect(owner, m, now, report);
    }
    await this.enforceBudget(owner, now, report);
    return report;
  }

  private async markForgotten(
    owner: MemoryOwner,
    m: MemoryRecord,
    s: number,
    now: number,
    report: MaintenanceReport,
  ) {
    await this.memory.store.update(m.id, { forgottenAt: now });
    await this.memory.audit({
      agentId: owner.agentId,
      memoryId: m.id,
      memoryText: m.text,
      action: "forgotten",
      reason: `su fuerza bajó a ${s.toFixed(3)} (umbral de olvido ${this.memory.config.retrieval.forgetThreshold}) sin volver a recordarlo`,
      at: now,
    });
    this.memory.emitEffect({
      kind: "forget",
      agentId: owner.agentId,
      memoryId: m.id,
      text: m.text,
      importance: m.importance,
    });
    report.forgotten.push(m.id);
  }

  private async makeGist(
    owner: MemoryOwner,
    m: MemoryRecord,
    now: number,
    report: MaintenanceReport,
  ) {
    try {
      const gist = await this.deps.gist!.compress(owner, m);
      const safe = await this.memory.guard?.allows(gist, {
        kind: "gist",
        actors: [owner.agentId, ...m.people],
        agentId: owner.agentId,
      });
      if (safe === false) return;
      await this.memory.store.update(m.id, { gist });
      await this.memory.audit({
        agentId: owner.agentId,
        memoryId: m.id,
        memoryText: m.text,
        action: "gist",
        reason: `se volvió vago; solo queda la esencia: "${gist}"`,
        at: now,
      });
      this.memory.emitEffect({ kind: "gist", agentId: owner.agentId, memoryId: m.id, text: gist });
      report.gists.push(m.id);
    } catch (error) {
      this.deps.onError?.("gist", error);
    }
  }

  private async changeSource(
    owner: MemoryOwner,
    m: MemoryRecord,
    next: MemoryRecord["source"],
    now: number,
    report: MaintenanceReport,
  ) {
    const versions = await this.memory.store.versions(m.id);
    await this.memory.store.addVersion({
      memoryId: m.id,
      version: versions.length,
      text: m.text,
      emotionalValence: m.emotionalValence,
      source: m.source,
      at: now,
      reason: "confusión de fuente",
    });
    await this.memory.store.update(m.id, { source: next });
    await this.memory.audit({
      agentId: owner.agentId,
      memoryId: m.id,
      memoryText: m.text,
      action: "source_changed",
      reason: `ya no recuerda bien quién se lo contó: "${m.source}" → "${next}"`,
      at: now,
    });
    report.sourceChanged.push(m.id);
  }

  /**
   * Sesgo de desvanecimiento afectivo (sin LLM): la valencia se acerca a 0 con el tiempo, la de
   * lo negativo antes que la de lo positivo. Solo se aplica a saltos de `fadeStep`, y cada salto
   * deja versión y auditoría.
   */
  private async fadeAffect(
    owner: MemoryOwner,
    m: MemoryRecord,
    now: number,
    report: MaintenanceReport,
  ) {
    const cfg = this.memory.config.biases;
    const v = m.emotionalValence;
    if (Math.abs(v) <= cfg.fadeFloor) return;
    const days = (now - (m.meta?.affectAt ?? m.createdAt)) / (24 * HOUR);
    if (days <= 0) return;
    const halfLife = v < 0 ? cfg.fadeNegativeHalfLifeDays : cfg.fadePositiveHalfLifeDays;
    const faded = v * Math.pow(0.5, days / halfLife);
    if (Math.abs(v - faded) < cfg.fadeStep) return;
    const next = Math.abs(faded) <= cfg.fadeFloor ? 0 : Math.round(faded * 100) / 100;
    await this.memory.store.transaction(async (tx) => {
      const versions = await tx.versions(m.id);
      await tx.addVersion({
        memoryId: m.id,
        version: versions.length,
        text: m.text,
        emotionalValence: v,
        source: m.source,
        at: now,
        reason: "desvanecimiento afectivo",
      });
      await tx.update(m.id, { emotionalValence: next, meta: { ...m.meta, affectAt: now } });
      await tx.addAudit({
        agentId: owner.agentId,
        memoryId: m.id,
        memoryText: m.text,
        action: "affect_faded",
        reason: `con el tiempo ya no le ${v < 0 ? "duele" : "emociona"} tanto: valencia ${v.toFixed(2)} → ${next.toFixed(2)}${v < 0 ? " (lo malo se suaviza antes que lo bueno)" : ""}`,
        at: now,
      });
    });
    report.faded.push(m.id);
  }

  /** Nunca se olvidan los planes recientes ni lo que citan, ni el conocimiento base importante. */
  private protectedIds(all: MemoryRecord[], now: number): Set<string> {
    const cfg = this.memory.config.budget;
    const ids = new Set<string>();
    for (const m of all) {
      const recentPlan = m.type === "plan" && now - m.createdAt < cfg.protectPlanHours * HOUR;
      const core = m.type === "semantic" && m.importance >= 6;
      if (recentPlan || core) {
        ids.add(m.id);
        m.links.forEach((l) => ids.add(l));
      }
    }
    return ids;
  }

  /** Olvido por presupuesto (política híbrida): triviales viejos → resumen de grupos → descarte. */
  private async enforceBudget(owner: MemoryOwner, now: number, report: MaintenanceReport) {
    const cfg = this.memory.config.budget;
    // Con vectores: el resumen de grupos compara embeddings.
    let active = (
      await this.memory.store.listActive(owner.agentId, { withEmbedding: true })
    ).filter((m) => m.status === "active");
    const tokens = () => active.reduce((n, m) => n + estimateTextTokens(m.text), 0);
    if (tokens() <= cfg.tokensPerAgent) return;
    const protectedIds = this.protectedIds(active, now);
    const removable = (m: MemoryRecord) => !protectedIds.has(m.id);

    // Paso 1: triviales viejos.
    for (const m of active) {
      const ageH = (now - m.createdAt) / HOUR;
      if (!removable(m) || m.importance > cfg.trivialImportanceMax || ageH < cfg.trivialMinAgeHours)
        continue;
      await this.remove(
        owner,
        m,
        now,
        `trivial (importancia ${m.importance}) y antiguo (${Math.round(ageH)} h)`,
        report,
      );
    }
    active = active.filter((m) => !report.deleted.includes(m.id));
    if (tokens() <= cfg.tokensPerAgent) return;

    // Paso 2: resumir grupos de episodios relacionados en una reflexión con enlaces.
    if (this.deps.summarizer) {
      for (const cluster of this.clusters(
        active.filter((m) => removable(m) && m.type === "observation"),
      )) {
        if (tokens() <= cfg.tokensPerAgent) break;
        try {
          const summary = await this.deps.summarizer.summarize(owner, cluster);
          const created = await this.memory.tryRemember(
            {
              agentId: owner.agentId,
              text: summary,
              type: "reflection",
              source: "inferido",
              importance: Math.max(...cluster.map((m) => m.importance)),
              emotionalValence:
                cluster.reduce((v, m) => v + m.emotionalValence, 0) / cluster.length,
              people: [...new Set(cluster.flatMap((m) => m.people))],
              links: cluster.map((m) => m.id),
            },
            now,
          );
          if (!created) continue;
          report.summaries.push(created.id);
          // Archivar el grupo entero (y auditarlo) de forma atómica.
          await this.memory.store.transaction(async (tx) => {
            await tx.updateMany(cluster.map((m) => ({ id: m.id, patch: { status: "archived" } })));
            for (const m of cluster) {
              await tx.addAudit({
                agentId: owner.agentId,
                memoryId: m.id,
                memoryText: m.text,
                action: "archived",
                reason: `presupuesto de memoria superado: resumido junto a ${cluster.length - 1} episodios parecidos en "${summary}"`,
                at: now,
              });
            }
          });
          for (const m of cluster) {
            this.memory.emitEffect({
              kind: "archive",
              agentId: owner.agentId,
              memoryId: m.id,
              text: m.text,
            });
            report.archived.push(m.id);
          }
          const archived = new Set(cluster.map((m) => m.id));
          active = [...active.filter((m) => !archived.has(m.id)), created];
        } catch (error) {
          this.deps.onError?.("summarize", error);
        }
      }
    }
    if (tokens() <= cfg.tokensPerAgent) return;

    // Paso 3: descartar lo de menor importancia × fuerza.
    const ranked = active
      .filter(removable)
      .map((m) => ({ m, score: m.importance * currentStrength(m, now) }))
      .sort((a, b) => a.score - b.score);
    for (const { m, score } of ranked) {
      if (tokens() <= cfg.tokensPerAgent) break;
      await this.remove(
        owner,
        m,
        now,
        `presupuesto de memoria superado; era de lo menos valioso (importancia × fuerza = ${score.toFixed(2)})`,
        report,
      );
      active = active.filter((x) => x.id !== m.id);
    }
  }

  /** Agrupa episodios por personas/lugar compartidos y similitud del embedding. */
  private clusters(episodes: MemoryRecord[]): MemoryRecord[][] {
    const cfg = this.memory.config.budget;
    const sorted = [...episodes].sort((a, b) => a.createdAt - b.createdAt);
    const used = new Set<string>();
    const out: MemoryRecord[][] = [];
    for (const seed of sorted) {
      if (used.has(seed.id)) continue;
      const group = [seed];
      for (const other of sorted) {
        if (other.id === seed.id || used.has(other.id)) continue;
        const sharesContext =
          other.placeId === seed.placeId || other.people.some((p) => seed.people.includes(p));
        if (sharesContext && cosine(seed.embedding, other.embedding) >= cfg.clusterSimilarity) {
          group.push(other);
        }
      }
      if (group.length >= cfg.clusterMinSize) {
        group.forEach((m) => used.add(m.id));
        out.push(group);
      }
    }
    return out;
  }

  private async remove(
    owner: MemoryOwner,
    m: MemoryRecord,
    now: number,
    reason: string,
    report: MaintenanceReport,
  ) {
    // Borrado + auditoría, todo o nada.
    await this.memory.store.transaction(async (tx) => {
      await tx.delete(m.id);
      await tx.addAudit({
        agentId: owner.agentId,
        memoryId: m.id,
        memoryText: m.text,
        action: "deleted",
        reason,
        at: now,
      });
    });
    this.memory.emitEffect({
      kind: "forget",
      agentId: owner.agentId,
      memoryId: m.id,
      text: m.text,
      importance: m.importance,
    });
    report.deleted.push(m.id);
  }
}
