import type { MemoryPatch, MemoryRecord, MemoryStore } from "./types";

export class InMemoryStore implements MemoryStore {
  private readonly byId = new Map<string, MemoryRecord>();

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
    return this.listByAgent(agentId);
  }
}
