import type { MemoryPatch, MemoryRecord, MemoryStore } from "@lethetown/agent-core";
import type { MemoryAuditEntry, MemorySource, MemoryType, MemoryVersion } from "@lethetown/shared";
import { MemoryAuditAction } from "@lethetown/shared";
import { and, cosineDistance, desc, eq, getTableColumns, sql } from "drizzle-orm";
import type { Db } from "./client";
import { memories, memoryAudit, memoryVersions } from "./schema";

type Row = typeof memories.$inferSelect;

const toRecord = ({ worldId: _w, ...r }: Row): MemoryRecord => ({
  ...r,
  source: r.source as MemorySource,
  type: r.type as MemoryType,
  status: r.status === "archived" ? "archived" : "active",
});

/** La conexión o una transacción abierta (misma API de consultas). */
type DbOrTx = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];

/** Columnas que se actualizan en lote (las de un refuerzo al recordar), con su tipo SQL. */
const BATCH_COLUMNS = {
  strength: { column: "strength", type: "real" },
  stability: { column: "stability", type: "real" },
  lastAccessedAt: { column: "last_accessed_at", type: "double precision" },
  accessCount: { column: "access_count", type: "integer" },
} as const;
type BatchKey = keyof typeof BATCH_COLUMNS;

/** MemoryStore sobre Postgres + pgvector, limitado a un mundo. */
export class PgMemoryStore implements MemoryStore {
  constructor(
    private readonly db: DbOrTx,
    readonly worldId: string,
  ) {}

  async transaction<T>(fn: (tx: MemoryStore) => Promise<T>): Promise<T> {
    return this.db.transaction((tx) => fn(new PgMemoryStore(tx, this.worldId)));
  }

  /**
   * Si todas las actualizaciones tocan las mismas columnas "de refuerzo", un único
   * UPDATE … FROM (VALUES …); si no, una a una dentro de una transacción.
   */
  async updateMany(updates: { id: string; patch: MemoryPatch }[]): Promise<void> {
    if (updates.length === 0) return;
    if (updates.length === 1) return this.update(updates[0]!.id, updates[0]!.patch);
    const keys = Object.keys(updates[0]!.patch).sort() as BatchKey[];
    const sameShape = updates.every(
      (u) =>
        Object.keys(u.patch).sort().join() === keys.join() && keys.every((k) => k in BATCH_COLUMNS),
    );
    if (!sameShape || keys.length === 0) {
      await this.transaction(async (tx) => {
        for (const u of updates) await tx.update(u.id, u.patch);
      });
      return;
    }
    const rows = updates.map(
      (u) =>
        sql`(${u.id}, ${sql.join(
          keys.map((k) => sql`${u.patch[k]}::${sql.raw(BATCH_COLUMNS[k].type)}`),
          sql`, `,
        )})`,
    );
    const set = sql.join(
      keys.map((k) => sql.raw(`${BATCH_COLUMNS[k].column} = v.${BATCH_COLUMNS[k].column}`)),
      sql`, `,
    );
    const cols = sql.raw(["id", ...keys.map((k) => BATCH_COLUMNS[k].column)].join(", "));
    await this.db.execute(sql`
      update ${memories} set ${set}
      from (values ${sql.join(rows, sql`, `)}) as v(${cols})
      where ${memories.id} = v.id and ${memories.worldId} = ${this.worldId}`);
  }

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
    // Búsqueda vectorial filtrada por mundo, agente y estado. Con un filtro tan selectivo, el
    // HNSW puede devolver menos de `third` filas (descarta las de otros agentes tras escanear
    // ef_search vecinos); los iterative scans de pgvector ≥ 0.8 siguen escaneando hasta llenar
    // el LIMIT. relaxed_order basta: el orden final lo decide la puntuación de agent-core.
    const similar = await this.db.transaction(async (tx) => {
      await tx.execute(sql`set local hnsw.iterative_scan = relaxed_order`);
      return tx
        .select()
        .from(memories)
        .where(and(this.inWorld(), eq(memories.agentId, agentId), eq(memories.status, "active")))
        .orderBy(cosineDistance(memories.embedding, queryEmbedding))
        .limit(third);
    });
    const [recent, important] = await Promise.all([
      base().orderBy(desc(memories.lastAccessedAt)).limit(third),
      base().orderBy(desc(memories.importance)).limit(third),
    ]);
    const byId = new Map<string, Row>();
    for (const r of [...similar, ...recent, ...important]) byId.set(r.id, r);
    return [...byId.values()].map(toRecord);
  }

  /** Inspector: similitud calculada en SQL y sin traer la columna embedding. */
  async listForInspection(
    agentId: string,
    queryEmbedding: number[],
  ): Promise<{ memory: MemoryRecord; relevance: number }[]> {
    const { embedding: _e, worldId: _w, ...cols } = getTableColumns(memories);
    const rows = await this.db
      .select({
        ...cols,
        relevance: sql<number>`1 - (${cosineDistance(memories.embedding, queryEmbedding)})`,
      })
      .from(memories)
      .where(and(this.inWorld(), eq(memories.agentId, agentId)));
    return rows.map(({ relevance, ...r }) => ({
      memory: toRecord({ ...r, embedding: [], worldId: this.worldId }),
      relevance: Number(relevance),
    }));
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
