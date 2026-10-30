import { and, desc, eq, notInArray } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "./client";
import { DEFAULT_WORLD_ID, worlds, worldSnapshots } from "./schema";

export const WorldStatus = z.enum(["running", "paused", "stopped"]);
export type WorldStatus = z.infer<typeof WorldStatus>;

export interface WorldRow {
  id: string;
  name: string;
  map: string;
  seed: number | null;
  status: WorldStatus;
  /** Idioma de los prompts (es | en). */
  language: "es" | "en";
  /** Sistemas desactivados (`{ notes: false }`); por defecto, todos activos. */
  systems: Record<string, boolean>;
  createdAt: Date;
}

/** Id de mundo: minúsculas, números y guiones (va en URLs y en claves). */
export const WorldId = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{0,39}$/, "id: minúsculas, números y guiones (máx. 40)");

export type NewWorldRow = Omit<WorldRow, "createdAt" | "status" | "language" | "systems"> & {
  status?: WorldStatus;
  language?: "es" | "en";
  systems?: Record<string, boolean>;
};

export interface WorldRepo {
  list(): Promise<WorldRow[]>;
  get(id: string): Promise<WorldRow | undefined>;
  create(w: NewWorldRow): Promise<WorldRow>;
  setStatus(id: string, status: WorldStatus): Promise<void>;
  /** Crea el mundo por defecto si no existe (instalación nueva o modo RAM). */
  ensureDefault(map: string, seed: number | null): Promise<WorldRow>;
}

export interface SnapshotStore {
  save(worldId: string, gameTime: number, reason: string, data: unknown): Promise<void>;
  latest(worldId: string): Promise<{ gameTime: number; data: unknown } | undefined>;
}

/** Instantáneas que se conservan por mundo (las más antiguas se borran). */
const KEEP_SNAPSHOTS = 48;

const toRow = (r: typeof worlds.$inferSelect): WorldRow => ({
  ...r,
  status: WorldStatus.catch("running").parse(r.status),
  language: r.language === "en" ? "en" : "es",
  systems: z.record(z.string(), z.boolean()).catch({}).parse(r.systems),
});

export class PgWorldRepo implements WorldRepo {
  constructor(private readonly db: Db) {}

  async list() {
    return (await this.db.select().from(worlds).orderBy(worlds.createdAt)).map(toRow);
  }

  async get(id: string) {
    const [row] = await this.db.select().from(worlds).where(eq(worlds.id, id));
    return row && toRow(row);
  }

  async create(w: NewWorldRow) {
    const [row] = await this.db.insert(worlds).values(w).returning();
    return toRow(row!);
  }

  async setStatus(id: string, status: WorldStatus) {
    await this.db.update(worlds).set({ status }).where(eq(worlds.id, id));
  }

  async ensureDefault(map: string, seed: number | null) {
    await this.db
      .insert(worlds)
      .values({ id: DEFAULT_WORLD_ID, name: "Lethetown", map, seed })
      .onConflictDoNothing();
    return (await this.get(DEFAULT_WORLD_ID))!;
  }
}

export class InMemoryWorldRepo implements WorldRepo {
  private readonly rows = new Map<string, WorldRow>();

  async list() {
    return [...this.rows.values()];
  }
  async get(id: string) {
    return this.rows.get(id);
  }
  async create(w: NewWorldRow) {
    if (this.rows.has(w.id)) throw new Error(`El mundo ${w.id} ya existe`);
    const row: WorldRow = {
      status: "running",
      language: "es",
      systems: {},
      ...w,
      createdAt: new Date(),
    };
    this.rows.set(w.id, row);
    return row;
  }
  async setStatus(id: string, status: WorldStatus) {
    const row = this.rows.get(id);
    if (row) row.status = status;
  }
  async ensureDefault(map: string, seed: number | null) {
    return (
      this.rows.get(DEFAULT_WORLD_ID) ??
      this.create({ id: DEFAULT_WORLD_ID, name: "Lethetown", map, seed })
    );
  }
}

export class PgSnapshotStore implements SnapshotStore {
  constructor(private readonly db: Db) {}

  async save(worldId: string, gameTime: number, reason: string, data: unknown) {
    await this.db.insert(worldSnapshots).values({ worldId, gameTime, reason, data });
    // Poda: conserva las KEEP_SNAPSHOTS más recientes del mundo.
    const keep = this.db
      .select({ id: worldSnapshots.id })
      .from(worldSnapshots)
      .where(eq(worldSnapshots.worldId, worldId))
      .orderBy(desc(worldSnapshots.id))
      .limit(KEEP_SNAPSHOTS);
    await this.db
      .delete(worldSnapshots)
      .where(and(eq(worldSnapshots.worldId, worldId), notInArray(worldSnapshots.id, keep)));
  }

  async latest(worldId: string) {
    const [row] = await this.db
      .select({ gameTime: worldSnapshots.gameTime, data: worldSnapshots.data })
      .from(worldSnapshots)
      .where(eq(worldSnapshots.worldId, worldId))
      .orderBy(desc(worldSnapshots.id))
      .limit(1);
    return row;
  }
}

export class InMemorySnapshotStore implements SnapshotStore {
  private readonly items = new Map<string, { gameTime: number; data: unknown }[]>();

  async save(worldId: string, gameTime: number, _reason: string, data: unknown) {
    // Se guarda una copia JSON, igual que en Postgres (jsonb).
    const list = [
      ...(this.items.get(worldId) ?? []),
      { gameTime, data: JSON.parse(JSON.stringify(data)) },
    ];
    this.items.set(worldId, list.slice(-KEEP_SNAPSHOTS));
  }

  async latest(worldId: string) {
    return this.items.get(worldId)?.at(-1);
  }
}
