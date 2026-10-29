import type { SocialProfileStore } from "@lethetown/agent-core";
import {
  DramaKind,
  RelationshipBond,
  RelationshipType,
  SimEventKind,
  type Chronicle,
  type Drama,
  type SimEvent,
  type SocialProfile,
  type SocialProfileChange,
} from "@lethetown/shared";
import { and, asc, desc, eq, gte, lt } from "drizzle-orm";
import type { Db } from "./client";
import {
  chronicles,
  dramas,
  moderationLog,
  simEvents,
  socialProfileHistory,
  socialProfiles,
} from "./schema";

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

  /** Retención: borra los eventos anteriores a `before` salvo los de `keepKinds`. */
  prune(before: number, keepKinds: string[]): number {
    const kept = this.events.filter((e) => e.time >= before || keepKinds.includes(e.kind));
    const removed = this.events.length - kept.length;
    this.events.splice(0, this.events.length, ...kept);
    return removed;
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

const toEvent = ({ worldId: _w, meta, ...r }: typeof simEvents.$inferSelect): SimEvent => ({
  ...r,
  kind: SimEventKind.parse(r.kind),
  ...(meta ? { meta } : {}),
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

type SocialRow = typeof socialProfiles.$inferSelect;

const toProfile = ({ worldId: _w, ...r }: SocialRow): SocialProfile => ({
  ...r,
  relationshipType: RelationshipType.catch("neighbor").parse(r.relationshipType),
  bond: RelationshipBond.nullable().catch(null).parse(r.bond),
});

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
    return row && toProfile(row);
  }

  async upsert(p: SocialProfile): Promise<void> {
    const { ownerId: _o, aboutId: _a, ...set } = p;
    await this.db
      .insert(socialProfiles)
      .values({ ...p, worldId: this.worldId })
      .onConflictDoUpdate({
        target: [socialProfiles.worldId, socialProfiles.ownerId, socialProfiles.aboutId],
        set,
      });
  }

  async list(ownerId: string): Promise<SocialProfile[]> {
    const rows = await this.db
      .select()
      .from(socialProfiles)
      .where(and(eq(socialProfiles.worldId, this.worldId), eq(socialProfiles.ownerId, ownerId)));
    return rows.map(toProfile);
  }

  async listAll(): Promise<SocialProfile[]> {
    const rows = await this.db
      .select()
      .from(socialProfiles)
      .where(eq(socialProfiles.worldId, this.worldId));
    return rows.map(toProfile);
  }

  async addHistory(c: SocialProfileChange): Promise<void> {
    await this.db.insert(socialProfileHistory).values({ ...c, worldId: this.worldId });
  }

  async history(
    ownerId: string | null,
    aboutId?: string,
    opts: { since?: number; limit?: number } = {},
  ): Promise<SocialProfileChange[]> {
    const t = socialProfileHistory;
    const rows = await this.db
      .select()
      .from(t)
      .where(
        and(
          eq(t.worldId, this.worldId),
          ownerId === null ? undefined : eq(t.ownerId, ownerId),
          aboutId ? eq(t.aboutId, aboutId) : undefined,
          opts.since !== undefined ? gte(t.at, opts.since) : undefined,
        ),
      )
      .orderBy(asc(t.at), asc(t.id))
      .limit(opts.limit ?? 1000);
    return rows.map(({ id: _id, worldId: _w, ...c }) => ({
      ...c,
      relationshipType: RelationshipType.catch("neighbor").parse(c.relationshipType),
    }));
  }
}

// --- Moderación ----------------------------------------------------------------------------

export interface ModerationRejection {
  worldId: string;
  userId: string | null;
  kind: string;
  text: string;
  reason: string;
}

/** Registro de textos de usuario rechazados. */
export interface ModerationLog {
  add(r: ModerationRejection): Promise<void>;
  recent(worldId: string, limit?: number): Promise<(ModerationRejection & { at: Date })[]>;
}

export class InMemoryModerationLog implements ModerationLog {
  private readonly items: (ModerationRejection & { at: Date })[] = [];
  async add(r: ModerationRejection) {
    this.items.push({ ...r, at: new Date() });
    if (this.items.length > 1000) this.items.shift();
  }
  async recent(worldId: string, limit = 50) {
    return this.items
      .filter((r) => r.worldId === worldId)
      .slice(-limit)
      .reverse();
  }
}

export class PgModerationLog implements ModerationLog {
  constructor(private readonly db: Db) {}
  async add(r: ModerationRejection) {
    await this.db.insert(moderationLog).values(r);
  }
  async recent(worldId: string, limit = 50) {
    const rows = await this.db
      .select()
      .from(moderationLog)
      .where(eq(moderationLog.worldId, worldId))
      .orderBy(desc(moderationLog.at))
      .limit(limit);
    return rows.map(({ id: _id, ...r }) => r);
  }
}

// --- Dramas --------------------------------------------------------------------------------

export interface DramaStore {
  add(d: Drama): Promise<void>;
  /** Los más recientes primero. */
  recent(limit?: number): Promise<Drama[]>;
}

export class InMemoryDramaStore implements DramaStore {
  private readonly items: Drama[] = [];
  async add(d: Drama) {
    this.items.push(d);
    if (this.items.length > 500) this.items.shift();
  }
  async recent(limit = 50) {
    return this.items.slice(-limit).reverse();
  }
}

export class PgDramaStore implements DramaStore {
  constructor(
    private readonly db: Db,
    readonly worldId: string,
  ) {}
  async add(d: Drama) {
    await this.db
      .insert(dramas)
      .values({ ...d, worldId: this.worldId })
      .onConflictDoNothing();
  }
  async recent(limit = 50) {
    const rows = await this.db
      .select()
      .from(dramas)
      .where(eq(dramas.worldId, this.worldId))
      .orderBy(desc(dramas.time))
      .limit(limit);
    return rows.map(({ worldId: _w, ...d }) => ({ ...d, kind: DramaKind.parse(d.kind) }));
  }
}
