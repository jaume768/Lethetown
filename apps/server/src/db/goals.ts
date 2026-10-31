/** Metas y vecinos que se fueron, en RAM o en Postgres, siempre por mundo (sistema `goals`). */
import { Departure, Goal } from "@lethetown/shared";
import { and, eq } from "drizzle-orm";
import type { Db } from "./client";
import { departures, goals } from "./schema";

export interface GoalStore {
  upsert(goal: Goal): Promise<void>;
  /** Todas las del mundo (para cargar al abrir y para «Evolución»). */
  list(): Promise<Goal[]>;
  listFor(agentId: string): Promise<Goal[]>;
}

export interface DepartureStore {
  upsert(d: Departure): Promise<void>;
  list(): Promise<Departure[]>;
}

export class InMemoryGoalStore implements GoalStore {
  private readonly byId = new Map<string, Goal>();

  async upsert(goal: Goal) {
    this.byId.set(goal.id, structuredClone(goal));
  }

  async list() {
    return [...this.byId.values()].map((g) => structuredClone(g));
  }

  async listFor(agentId: string) {
    return (await this.list()).filter((g) => g.agentId === agentId);
  }
}

export class InMemoryDepartureStore implements DepartureStore {
  private readonly byAgent = new Map<string, Departure>();

  async upsert(d: Departure) {
    this.byAgent.set(d.agentId, { ...d });
  }

  async list() {
    return [...this.byAgent.values()].map((d) => ({ ...d }));
  }
}

type GoalRow = typeof goals.$inferSelect;
const toGoal = ({ worldId: _w, ...r }: GoalRow): Goal => Goal.parse(r);

export class PgGoalStore implements GoalStore {
  constructor(
    private readonly db: Db,
    readonly worldId: string,
  ) {}

  async upsert(goal: Goal) {
    const { id: _id, ...set } = goal;
    await this.db
      .insert(goals)
      .values({ ...goal, worldId: this.worldId })
      .onConflictDoUpdate({ target: [goals.worldId, goals.id], set });
  }

  async list() {
    const rows = await this.db.select().from(goals).where(eq(goals.worldId, this.worldId));
    return rows.map(toGoal);
  }

  async listFor(agentId: string) {
    const rows = await this.db
      .select()
      .from(goals)
      .where(and(eq(goals.worldId, this.worldId), eq(goals.agentId, agentId)));
    return rows.map(toGoal);
  }
}

export class PgDepartureStore implements DepartureStore {
  constructor(
    private readonly db: Db,
    readonly worldId: string,
  ) {}

  async upsert(d: Departure) {
    const row = { ...d, worldId: this.worldId };
    const { agentId: _a, worldId: _w, ...set } = row;
    await this.db
      .insert(departures)
      .values(row)
      .onConflictDoUpdate({ target: [departures.worldId, departures.agentId], set });
  }

  async list() {
    const rows = await this.db
      .select()
      .from(departures)
      .where(eq(departures.worldId, this.worldId));
    return rows.map(({ worldId: _w, ...r }) => Departure.parse(r));
  }
}
