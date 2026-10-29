import type { MemoryAuditEntry, MemoryVersion } from "@lethetown/shared";
import type { MemoryPatch, MemoryRecord, MemoryStore } from "./types";

export class InMemoryStore implements MemoryStore {
  private readonly byId = new Map<string, MemoryRecord>();
  private readonly versionsById = new Map<string, MemoryVersion[]>();
  private readonly auditLog: MemoryAuditEntry[] = [];

  async add(memory: MemoryRecord): Promise<void> {
    this.byId.set(memory.id, { ...memory });
  }

  async update(id: string, patch: MemoryPatch): Promise<void> {
    const current = this.byId.get(id);
    if (!current) throw new Error(`Recuerdo no encontrado: ${id}`);
    this.byId.set(id, { ...current, ...patch });
  }

  async updateMany(updates: { id: string; patch: MemoryPatch }[]): Promise<void> {
    for (const u of updates) await this.update(u.id, u.patch);
  }

  /** En RAM no hay escrituras a medias que deshacer (todo es síncrono en un solo hilo). */
  async transaction<T>(fn: (tx: MemoryStore) => Promise<T>): Promise<T> {
    return fn(this);
  }

  async get(id: string): Promise<MemoryRecord | undefined> {
    const m = this.byId.get(id);
    return m && { ...m };
  }

  async listByAgent(agentId: string): Promise<MemoryRecord[]> {
    return [...this.byId.values()].filter((m) => m.agentId === agentId).map((m) => ({ ...m }));
  }

  /** En RAM los vectores ya están en memoria: se devuelven siempre (no cuesta nada). */
  async listActive(agentId: string, _opts?: { withEmbedding?: boolean }): Promise<MemoryRecord[]> {
    return [...this.byId.values()]
      .filter((m) => m.agentId === agentId && m.status === "active")
      .map((m) => ({ ...m }));
  }

  async candidates(agentId: string): Promise<MemoryRecord[]> {
    return (await this.listByAgent(agentId)).filter((m) => m.status === "active");
  }

  async delete(id: string): Promise<void> {
    this.byId.delete(id);
  }

  async addVersion(version: MemoryVersion): Promise<void> {
    this.versionsById.set(version.memoryId, [
      ...(this.versionsById.get(version.memoryId) ?? []),
      version,
    ]);
  }

  async versions(memoryId: string): Promise<MemoryVersion[]> {
    return [...(this.versionsById.get(memoryId) ?? [])];
  }

  async addAudit(entry: MemoryAuditEntry): Promise<void> {
    this.auditLog.push({ ...entry });
  }

  async audit(agentId: string, limit = 100): Promise<MemoryAuditEntry[]> {
    return this.auditLog
      .filter((e) => e.agentId === agentId)
      .slice(-limit)
      .reverse();
  }

  /**
   * Retención: borra los recuerdos olvidados o archivados desde antes de `memoriesBefore`
   * (minutos de juego), la auditoría anterior a `auditBefore` y las versiones anteriores a
   * `versionsBefore` (y las de recuerdos que ya no existen). Devuelve cuántos borró de cada.
   */
  prune(cut: { memoriesBefore: number; auditBefore: number; versionsBefore: number }): {
    memories: number;
    audit: number;
    versions: number;
  } {
    let memories = 0;
    for (const [id, m] of this.byId) {
      const gone = m.status === "archived" || m.forgottenAt !== null;
      if (gone && (m.forgottenAt ?? m.createdAt) < cut.memoriesBefore) {
        this.byId.delete(id);
        memories++;
      }
    }
    let versions = 0;
    for (const [id, list] of this.versionsById) {
      const kept = this.byId.has(id) ? list.filter((v) => v.at >= cut.versionsBefore) : [];
      versions += list.length - kept.length;
      if (kept.length) this.versionsById.set(id, kept);
      else this.versionsById.delete(id);
    }
    const before = this.auditLog.length;
    const keptAudit = this.auditLog.filter((e) => e.at >= cut.auditBefore);
    this.auditLog.splice(0, this.auditLog.length, ...keptAudit);
    return { memories, audit: before - keptAudit.length, versions };
  }

  async byEvent(eventId: string): Promise<MemoryRecord[]> {
    return [...this.byId.values()].filter((m) => m.eventId === eventId).map((m) => ({ ...m }));
  }
}
