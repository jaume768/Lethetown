import type { MemoryPatch, MemoryRecord, MemoryStore } from "@lethetown/agent-core";
import type { MemoryAuditEntry, MemorySource, MemoryType, MemoryVersion } from "@lethetown/shared";
import { MemoryAuditAction } from "@lethetown/shared";
import { and, cosineDistance, desc, eq, sql } from "drizzle-orm";
import type { Db } from "./client";
import { memories, memoryAudit, memoryVersions } from "./schema";

type Row = typeof memories.$inferSelect;

const toRecord = ({ worldId: _w, ...r }: Row): MemoryRecord => ({
  ...r,
  source: r.source as MemorySource,
  type: r.type as MemoryType,
  status: r.status === "archived" ? "archived" : "active",
});

/** MemoryStore sobre Postgres + pgvector, limitado a un mundo. */
export class PgMemoryStore implements MemoryStore {
  constructor(
    private readonly db: Db,
    readonly worldId: string,
  ) {}

  private inWorld() {
    return eq(memories.worldId, this.worldId);
  }

  async add(m: MemoryRecord): Promise<void> {
    await this.db.insert(memories).values({ ...m, worldId: this.worldId });
  }

  async update(id: string, patch: MemoryPatch): Promise<void> {
    await this.db
      .update(memories)
      .set(patch)
      .where(and(this.inWorld(), eq(memories.id, id)));
  }

  async get(id: string): Promise<MemoryRecord | undefined> {
    const [row] = await this.db
      .select()
      .from(memories)
      .where(and(this.inWorld(), eq(memories.id, id)));
    return row && toRecord(row);
  }

  async listByAgent(agentId: string): Promise<MemoryRecord[]> {
    const rows = await this.db
      .select()
      .from(memories)
      .where(and(this.inWorld(), eq(memories.agentId, agentId)));
    return rows.map(toRecord);
  }

  /**
   * Prefiltro: los más parecidos (índice HNSW) ∪ los más recientes ∪ los más importantes,
   * para que la puntuación final en agent-core no pierda recuerdos poco relevantes pero vívidos.
   */
  async candidates(
    agentId: string,
    queryEmbedding: number[],
    limit: number,
  ): Promise<MemoryRecord[]> {
    const third = Math.max(1, Math.floor(limit / 3));
    const base = () =>
      this.db
        .select()
        .from(memories)
        .where(and(this.inWorld(), eq(memories.agentId, agentId), eq(memories.status, "active")));
    const [similar, recent, important] = await Promise.all([
      base().orderBy(cosineDistance(memories.embedding, queryEmbedding)).limit(third),
      base().orderBy(desc(memories.lastAccessedAt)).limit(third),
      base().orderBy(desc(memories.importance)).limit(third),
    ]);
    const byId = new Map<string, Row>();
    for (const r of [...similar, ...recent, ...important]) byId.set(r.id, r);
    return [...byId.values()].map(toRecord);
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(memories).where(and(this.inWorld(), eq(memories.id, id)));
  }

  async addVersion(v: MemoryVersion): Promise<void> {
    await this.db.insert(memoryVersions).values({ ...v, worldId: this.worldId });
  }

  async versions(memoryId: string): Promise<MemoryVersion[]> {
    const rows = await this.db
      .select()
      .from(memoryVersions)
      .where(and(eq(memoryVersions.worldId, this.worldId), eq(memoryVersions.memoryId, memoryId)))
      .orderBy(memoryVersions.version);
    return rows.map(({ id: _id, worldId: _w, ...v }) => v);
  }

  async addAudit(entry: MemoryAuditEntry): Promise<void> {
    await this.db.insert(memoryAudit).values({ ...entry, worldId: this.worldId });
  }

  async audit(agentId: string, limit = 100): Promise<MemoryAuditEntry[]> {
    const rows = await this.db
      .select()
      .from(memoryAudit)
      .where(and(eq(memoryAudit.worldId, this.worldId), eq(memoryAudit.agentId, agentId)))
      .orderBy(desc(memoryAudit.id))
      .limit(limit);
    return rows.map(({ id: _id, worldId: _w, ...e }) => ({
      ...e,
      action: MemoryAuditAction.parse(e.action),
    }));
  }

  async byEvent(eventId: string): Promise<MemoryRecord[]> {
    const rows = await this.db
      .select()
      .from(memories)
      .where(and(this.inWorld(), eq(memories.eventId, eventId)));
    return rows.map(toRecord);
  }

  async deleteAll(): Promise<void> {
    await this.db.delete(memories).where(this.inWorld());
  }

  /** Último instante de juego registrado (para reanudar el reloj tras reiniciar). */
  async latestGameTime(): Promise<number> {
    const [row] = await this.db
      .select({ t: sql<number | null>`max(${memories.lastAccessedAt})` })
      .from(memories)
      .where(this.inWorld());
    return Number(row?.t ?? 0);
  }
}
