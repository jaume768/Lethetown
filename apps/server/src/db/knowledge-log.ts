/** Registro de conocimiento externo, en RAM o en Postgres, siempre por mundo. */
import type { KnowledgeRecord } from "@lethetown/agent-core";
import { and, desc, eq } from "drizzle-orm";
import type { Db } from "./client";
import { knowledgeLog } from "./schema";

export interface KnowledgeLogStore {
  add(r: KnowledgeRecord): Promise<void>;
  /** Las más recientes primero. */
  list(limit?: number): Promise<KnowledgeRecord[]>;
}

export class InMemoryKnowledgeLogStore implements KnowledgeLogStore {
  readonly rows: KnowledgeRecord[] = [];

  async add(r: KnowledgeRecord) {
    this.rows.push({ ...r });
  }

  async list(limit = 1000) {
    return this.rows.slice(-limit).reverse();
  }

  /** Retención: borra lo anterior a `before` (minuto de juego). */
  prune(before: number): number {
    const keep = this.rows.filter((r) => r.at >= before);
    const n = this.rows.length - keep.length;
    this.rows.splice(0, this.rows.length, ...keep);
    return n;
  }
}

export class PgKnowledgeLogStore implements KnowledgeLogStore {
  constructor(
    private readonly db: Db,
    readonly worldId: string,
  ) {}

  async add(r: KnowledgeRecord) {
    await this.db.insert(knowledgeLog).values({ ...r, worldId: this.worldId });
  }

  async list(limit = 1000) {
    const rows = await this.db
      .select()
      .from(knowledgeLog)
      .where(and(eq(knowledgeLog.worldId, this.worldId)))
      .orderBy(desc(knowledgeLog.at), desc(knowledgeLog.id))
      .limit(limit);
    return rows.map(
      ({ worldId: _w, id: _id, ...r }) =>
        ({ ...r, kind: r.kind as KnowledgeRecord["kind"] }) as KnowledgeRecord,
    );
  }
}
