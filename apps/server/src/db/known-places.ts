/** Almacén de lugares conocidos por agente, en RAM o en Postgres, siempre por mundo. */
import type { KnownPlace } from "@lethetown/shared";
import { KnownPlaceSource } from "@lethetown/shared";
import { and, asc, eq } from "drizzle-orm";
import type { Db } from "./client";
import { knownPlaces } from "./schema";

export interface KnownPlaceStore {
  /** Añade los que falten (lo ya conocido no se toca: se conoce una vez). */
  addMany(agentId: string, places: KnownPlace[]): Promise<void>;
  /** Sustituye todo lo de un agente (al arrancar, con lo que hay en su mente). */
  replace(agentId: string, places: KnownPlace[]): Promise<void>;
  list(agentId: string): Promise<KnownPlace[]>;
}

export class InMemoryKnownPlaceStore implements KnownPlaceStore {
  private readonly byAgent = new Map<string, Map<string, KnownPlace>>();

  async addMany(agentId: string, places: KnownPlace[]) {
    const mine = this.byAgent.get(agentId) ?? new Map<string, KnownPlace>();
    this.byAgent.set(agentId, mine);
    for (const p of places) if (!mine.has(p.placeId)) mine.set(p.placeId, { ...p });
  }

  async replace(agentId: string, places: KnownPlace[]) {
    this.byAgent.delete(agentId);
    await this.addMany(agentId, places);
  }

  async list(agentId: string) {
    return [...(this.byAgent.get(agentId)?.values() ?? [])]
      .sort((a, b) => a.at - b.at)
      .map((p) => ({ ...p }));
  }
}

export class PgKnownPlaceStore implements KnownPlaceStore {
  constructor(
    private readonly db: Db,
    readonly worldId: string,
  ) {}

  async addMany(agentId: string, places: KnownPlace[]) {
    if (!places.length) return;
    await this.db
      .insert(knownPlaces)
      .values(
        places.map((p) => ({
          worldId: this.worldId,
          agentId,
          placeId: p.placeId,
          source: p.source,
          learnedAt: p.at,
          toldBy: p.toldBy,
        })),
      )
      .onConflictDoNothing();
  }

  async replace(agentId: string, places: KnownPlace[]) {
    await this.db
      .delete(knownPlaces)
      .where(and(eq(knownPlaces.worldId, this.worldId), eq(knownPlaces.agentId, agentId)));
    await this.addMany(agentId, places);
  }

  async list(agentId: string) {
    const rows = await this.db
      .select()
      .from(knownPlaces)
      .where(and(eq(knownPlaces.worldId, this.worldId), eq(knownPlaces.agentId, agentId)))
      .orderBy(asc(knownPlaces.learnedAt));
    return rows.map((r) => ({
      placeId: r.placeId,
      source: KnownPlaceSource.catch("seen").parse(r.source),
      at: r.learnedAt,
      toldBy: r.toldBy,
    }));
  }
}
