import type { SocialProfileStore } from "@lethetown/agent-core";
import { SimEventKind, type Chronicle, type SimEvent, type SocialProfile } from "@lethetown/shared";
import { and, asc, desc, eq, gte, lt } from "drizzle-orm";
import type { Db } from "./client";
import { chronicles, simEvents, socialProfiles } from "./schema";

/** Línea de tiempo de eventos. */
export interface EventStore {
  add(event: SimEvent): Promise<void>;
  /** Eventos en [from, to) minutos de juego. */
  range(from: number, to: number, limit?: number): Promise<SimEvent[]>;
  get(id: string): Promise<SimEvent | undefined>;
}

export interface ChronicleStore {
  add(c: Chronicle): Promise<void>;
  list(): Promise<Chronicle[]>;
}

// --- RAM ---------------------------------------------------------------------------------

export class InMemoryEventStore implements EventStore {
  private readonly events: SimEvent[] = [];
  constructor(private readonly max = 20_000) {}

  async add(event: SimEvent) {
    this.events.push(event);
    if (this.events.length > this.max) this.events.splice(0, this.events.length - this.max);
  }

  async range(from: number, to: number, limit = 1000) {
    return this.events.filter((e) => e.time >= from && e.time < to).slice(0, limit);
  }

  async get(id: string) {
    return this.events.find((e) => e.id === id);
  }
}

export class InMemoryChronicleStore implements ChronicleStore {
  private readonly items = new Map<number, Chronicle>();
  async add(c: Chronicle) {
    this.items.set(c.day, c);
  }
  async list() {
    return [...this.items.values()].sort((a, b) => a.day - b.day);
  }
}

// --- Postgres ------------------------------------------------------------------------------

const toEvent = ({ worldId: _w, ...r }: typeof simEvents.$inferSelect): SimEvent => ({
  ...r,
  kind: SimEventKind.parse(r.kind),
});

export class PgEventStore implements EventStore {
  constructor(
    private readonly db: Db,
    readonly worldId: string,
  ) {}

  async add(event: SimEvent) {
    await this.db
      .insert(simEvents)
      .values({ ...event, worldId: this.worldId })
      .onConflictDoNothing();
  }

  async range(from: number, to: number, limit = 1000) {
    const rows = await this.db
      .select()
      .from(simEvents)
      .where(
        and(eq(simEvents.worldId, this.worldId), gte(simEvents.time, from), lt(simEvents.time, to)),
      )
      .orderBy(asc(simEvents.time))
      .limit(limit);
    return rows.map(toEvent);
  }

  async get(id: string) {
    const [row] = await this.db
      .select()
      .from(simEvents)
      .where(and(eq(simEvents.worldId, this.worldId), eq(simEvents.id, id)));
    return row && toEvent(row);
  }

  async latestTime(): Promise<number> {
    const [row] = await this.db
      .select({ t: simEvents.time })
      .from(simEvents)
      .where(eq(simEvents.worldId, this.worldId))
      .orderBy(desc(simEvents.time))
      .limit(1);
    return row?.t ?? 0;
  }
}

export class PgChronicleStore implements ChronicleStore {
  constructor(
    private readonly db: Db,
    readonly worldId: string,
  ) {}
  async add(c: Chronicle) {
    await this.db
      .insert(chronicles)
      .values({ ...c, worldId: this.worldId })
      .onConflictDoUpdate({
        target: [chronicles.worldId, chronicles.day],
        set: { title: c.title, text: c.text },
      });
  }
  async list() {
    const rows = await this.db
      .select()
      .from(chronicles)
      .where(eq(chronicles.worldId, this.worldId))
      .orderBy(asc(chronicles.day));
    return rows.map(({ worldId: _w, ...c }) => c);
  }
}

export class PgSocialProfileStore implements SocialProfileStore {
  constructor(
    private readonly db: Db,
    readonly worldId: string,
  ) {}

  async get(ownerId: string, aboutId: string): Promise<SocialProfile | undefined> {
    const [row] = await this.db
      .select()
      .from(socialProfiles)
      .where(
        and(
          eq(socialProfiles.worldId, this.worldId),
          eq(socialProfiles.ownerId, ownerId),
          eq(socialProfiles.aboutId, aboutId),
        ),
      );
    return row && stripWorld(row);
  }

  async upsert(p: SocialProfile): Promise<void> {
    await this.db
      .insert(socialProfiles)
      .values({ ...p, worldId: this.worldId })
      .onConflictDoUpdate({
        target: [socialProfiles.worldId, socialProfiles.ownerId, socialProfiles.aboutId],
        set: {
          summary: p.summary,
          affinity: p.affinity,
          trust: p.trust,
          lastUpdated: p.lastUpdated,
        },
      });
  }

  async list(ownerId: string): Promise<SocialProfile[]> {
    const rows = await this.db
      .select()
      .from(socialProfiles)
      .where(and(eq(socialProfiles.worldId, this.worldId), eq(socialProfiles.ownerId, ownerId)));
    return rows.map(stripWorld);
  }
}

function stripWorld<T extends { worldId: string }>({
  worldId: _w,
  ...rest
}: T): Omit<T, "worldId"> {
  return rest;
}
