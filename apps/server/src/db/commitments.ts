/** Almacén de citas (compromisos), en RAM o en Postgres, siempre por mundo. */
import { Commitment, CommitmentStatus } from "@lethetown/shared";
import { and, arrayContains, desc, eq } from "drizzle-orm";
import type { Db } from "./client";
import { commitments } from "./schema";

export interface CommitmentStore {
  upsert(c: Commitment): Promise<void>;
  get(id: string): Promise<Commitment | undefined>;
  /** Citas de un agente, de la más reciente a la más antigua. */
  listFor(agentId: string, limit?: number): Promise<Commitment[]>;
  /** Mayor número de id usado ("c12" → 12), para seguir la numeración. */
  maxSeq(): Promise<number>;
}

/** "c12" → 12. */
const seqOf = (id: string) => Number(/^c(\d+)$/.exec(id)?.[1] ?? 0);

export class InMemoryCommitmentStore implements CommitmentStore {
  private readonly byId = new Map<string, Commitment>();

  async upsert(c: Commitment) {
    this.byId.set(c.id, structuredClone(c));
  }

  async get(id: string) {
    const c = this.byId.get(id);
    return c && structuredClone(c);
  }

  async listFor(agentId: string, limit = 100) {
    return [...this.byId.values()]
      .filter((c) => c.participants.includes(agentId))
      .sort((a, b) => b.at - a.at)
      .slice(0, limit)
      .map((c) => structuredClone(c));
  }

  async maxSeq() {
    return Math.max(0, ...[...this.byId.keys()].map(seqOf));
  }
}

type Row = typeof commitments.$inferSelect;
const toCommitment = ({ worldId: _w, ...r }: Row): Commitment =>
  Commitment.parse({ ...r, status: CommitmentStatus.catch("cancelled").parse(r.status) });

export class PgCommitmentStore implements CommitmentStore {
  constructor(
    private readonly db: Db,
    readonly worldId: string,
  ) {}

  async upsert(c: Commitment) {
    const { id: _id, ...set } = c;
    await this.db
      .insert(commitments)
      .values({ ...c, worldId: this.worldId })
      .onConflictDoUpdate({ target: [commitments.worldId, commitments.id], set });
  }

  async get(id: string) {
    const [row] = await this.db
      .select()
      .from(commitments)
      .where(and(eq(commitments.worldId, this.worldId), eq(commitments.id, id)));
    return row && toCommitment(row);
  }

  async listFor(agentId: string, limit = 100) {
    const rows = await this.db
      .select()
      .from(commitments)
      .where(
        and(
          eq(commitments.worldId, this.worldId),
          arrayContains(commitments.participants, [agentId]),
        ),
      )
      .orderBy(desc(commitments.at))
      .limit(limit);
    return rows.map(toCommitment);
  }

  async maxSeq() {
    const rows = await this.db
      .select({ id: commitments.id })
      .from(commitments)
      .where(eq(commitments.worldId, this.worldId));
    return Math.max(0, ...rows.map((r) => seqOf(r.id)));
  }
}
