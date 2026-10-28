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

  async get(id: string): Promise<MemoryRecord | undefined> {
    const m = this.byId.get(id);
    return m && { ...m };
  }

  async listByAgent(agentId: string): Promise<MemoryRecord[]> {
    return [...this.byId.values()].filter((m) => m.agentId === agentId).map((m) => ({ ...m }));
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

  async byEvent(eventId: string): Promise<MemoryRecord[]> {
    return [...this.byId.values()].filter((m) => m.eventId === eventId).map((m) => ({ ...m }));
  }
}
