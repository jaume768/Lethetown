import { and, eq, inArray, lt, ne, notInArray, or, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { worldLeases, worlds } from "../db/schema";

/**
 * Reparto de mundos entre workers con leases en Postgres: cada mundo tiene como mucho un dueño
 * con la lease vigente. Reclamar y renovar son atómicos (INSERT … ON CONFLICT … WHERE), así
 * que dos workers nunca ejecutan el mismo mundo a la vez (salvo un desfase de reloj < TTL).
 */
export class LeaseManager {
  constructor(
    private readonly db: Db,
    readonly owner: string,
    private readonly ttlMs: number,
  ) {}

  private expires() {
    return new Date(Date.now() + this.ttlMs);
  }

  /** Intenta reclamar hasta `max` mundos no parados sin dueño vigente. Devuelve sus ids. */
  async claim(max: number, exclude: string[]): Promise<string[]> {
    if (max <= 0) return [];
    const candidates = await this.db
      .select({ id: worlds.id })
      .from(worlds)
      .leftJoin(worldLeases, eq(worldLeases.worldId, worlds.id))
      .where(
        and(
          ne(worlds.status, "stopped"),
          exclude.length ? notInArray(worlds.id, exclude) : undefined,
          or(sql`${worldLeases.worldId} is null`, lt(worldLeases.expiresAt, new Date())),
        ),
      )
      .orderBy(worlds.createdAt)
      .limit(max);
    const won: string[] = [];
    for (const { id } of candidates) {
      const rows = await this.db
        .insert(worldLeases)
        .values({ worldId: id, owner: this.owner, expiresAt: this.expires() })
        .onConflictDoUpdate({
          target: worldLeases.worldId,
          set: { owner: this.owner, expiresAt: this.expires(), heartbeatAt: new Date() },
          // Solo si nadie la tiene vigente (o ya era nuestra).
          setWhere: or(lt(worldLeases.expiresAt, new Date()), eq(worldLeases.owner, this.owner)),
        })
        .returning({ id: worldLeases.worldId });
      if (rows.length) won.push(id);
    }
    return won;
  }

  /** Renueva las leases propias; devuelve las que se han perdido (otro worker las tiene). */
  async renew(ids: string[]): Promise<string[]> {
    if (!ids.length) return [];
    const kept = await this.db
      .update(worldLeases)
      .set({ expiresAt: this.expires(), heartbeatAt: new Date() })
      .where(and(inArray(worldLeases.worldId, ids), eq(worldLeases.owner, this.owner)))
      .returning({ id: worldLeases.worldId });
    const keptIds = new Set(kept.map((r) => r.id));
    return ids.filter((id) => !keptIds.has(id));
  }

  async release(ids: string[]): Promise<void> {
    if (!ids.length) return;
    await this.db
      .delete(worldLeases)
      .where(and(inArray(worldLeases.worldId, ids), eq(worldLeases.owner, this.owner)));
  }

  /** Quién ejecuta cada mundo (para el health de admin). */
  async list() {
    return this.db.select().from(worldLeases);
  }
}
