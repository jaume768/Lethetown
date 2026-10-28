import type { MemoryPatch, MemoryRecord, MemoryStore } from "@lethetown/agent-core";
import type { MemorySource, MemoryType } from "@lethetown/shared";
import { and, cosineDistance, desc, eq, sql } from "drizzle-orm";
import type { Db } from "./client";
import { memories } from "./schema";

type Row = typeof memories.$inferSelect;

const toRecord = (r: Row): MemoryRecord => ({
  ...r,
  source: r.source as MemorySource,
  type: r.type as MemoryType,
  status: r.status === "archived" ? "archived" : "active",
});

/** MemoryStore sobre Postgres + pgvector. */
export class PgMemoryStore implements MemoryStore {
  constructor(private readonly db: Db) {}

  async add(m: MemoryRecord): Promise<void> {
    await this.db.insert(memories).values(m);
  }

  async update(id: string, patch: MemoryPatch): Promise<void> {
    await this.db.update(memories).set(patch).where(eq(memories.id, id));
  }

  async get(id: string): Promise<MemoryRecord | undefined> {
    const [row] = await this.db.select().from(memories).where(eq(memories.id, id));
    return row && toRecord(row);
  }

  async listByAgent(agentId: string): Promise<MemoryRecord[]> {
    const rows = await this.db.select().from(memories).where(eq(memories.agentId, agentId));
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
        .where(and(eq(memories.agentId, agentId), eq(memories.status, "active")));
    const [similar, recent, important] = await Promise.all([
      base().orderBy(cosineDistance(memories.embedding, queryEmbedding)).limit(third),
      base().orderBy(desc(memories.lastAccessedAt)).limit(third),
      base().orderBy(desc(memories.importance)).limit(third),
    ]);
    const byId = new Map<string, Row>();
    for (const r of [...similar, ...recent, ...important]) byId.set(r.id, r);
    return [...byId.values()].map(toRecord);
  }

  async deleteAll(): Promise<void> {
    await this.db.delete(memories);
  }

  /** Último instante de juego registrado (para reanudar el reloj tras reiniciar). */
  async latestGameTime(): Promise<number> {
    const [row] = await this.db
      .select({ t: sql<number | null>`max(${memories.lastAccessedAt})` })
      .from(memories);
    return Number(row?.t ?? 0);
  }
}
