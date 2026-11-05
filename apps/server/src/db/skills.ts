/** Habilidades y saberes del pueblo, en RAM o en Postgres, siempre por mundo (sistemas `skills` y `lore`). */
import { Lore, LoreHolder, SkillState } from "@lethetown/shared";
import { and, eq } from "drizzle-orm";
import type { Db } from "./client";
import { lore, loreHolders, skills } from "./schema";
import { bounded, RANGES } from "./ranges";

export interface SkillStore {
  upsert(s: SkillState): Promise<void>;
  list(): Promise<SkillState[]>;
  listFor(agentId: string): Promise<SkillState[]>;
}

export interface LoreStore {
  upsertLore(l: Lore): Promise<void>;
  upsertHolder(h: LoreHolder): Promise<void>;
  lore(): Promise<Lore[]>;
  holders(): Promise<LoreHolder[]>;
}

const skillKey = (s: Pick<SkillState, "agentId" | "skill">) => `${s.agentId}:${s.skill}`;
const holderKey = (h: Pick<LoreHolder, "loreId" | "agentId">) => `${h.loreId}:${h.agentId}`;

export class InMemorySkillStore implements SkillStore {
  private readonly byKey = new Map<string, SkillState>();

  async upsert(s: SkillState) {
    this.byKey.set(skillKey(s), structuredClone(s));
  }

  async list() {
    return [...this.byKey.values()].map((s) => structuredClone(s));
  }

  async listFor(agentId: string) {
    return (await this.list()).filter((s) => s.agentId === agentId);
  }
}

export class InMemoryLoreStore implements LoreStore {
  private readonly items = new Map<string, Lore>();
  private readonly held = new Map<string, LoreHolder>();

  async upsertLore(l: Lore) {
    this.items.set(l.id, structuredClone(l));
  }

  async upsertHolder(h: LoreHolder) {
    this.held.set(holderKey(h), structuredClone(h));
  }

  async lore() {
    return [...this.items.values()].map((l) => structuredClone(l));
  }

  async holders() {
    return [...this.held.values()].map((h) => structuredClone(h));
  }
}

type SkillRow = typeof skills.$inferSelect;
const toSkill = ({ worldId: _w, ...r }: SkillRow): SkillState => SkillState.parse(r);

export class PgSkillStore implements SkillStore {
  constructor(
    private readonly db: Db,
    readonly worldId: string,
  ) {}

  async upsert(state: SkillState) {
    const s = bounded(state, RANGES.skill);
    const { agentId: _a, skill: _s, ...set } = s;
    await this.db
      .insert(skills)
      .values({ ...s, worldId: this.worldId })
      .onConflictDoUpdate({ target: [skills.worldId, skills.agentId, skills.skill], set });
  }

  async list() {
    const rows = await this.db.select().from(skills).where(eq(skills.worldId, this.worldId));
    return rows.map(toSkill);
  }

  async listFor(agentId: string) {
    const rows = await this.db
      .select()
      .from(skills)
      .where(and(eq(skills.worldId, this.worldId), eq(skills.agentId, agentId)));
    return rows.map(toSkill);
  }
}

type LoreRow = typeof lore.$inferSelect;
type HolderRow = typeof loreHolders.$inferSelect;

export class PgLoreStore implements LoreStore {
  constructor(
    private readonly db: Db,
    readonly worldId: string,
  ) {}

  async upsertLore(l: Lore) {
    const { id: _id, ...set } = l;
    await this.db
      .insert(lore)
      .values({ ...l, worldId: this.worldId })
      .onConflictDoUpdate({ target: [lore.worldId, lore.id], set });
  }

  async upsertHolder(holder: LoreHolder) {
    const h = bounded(holder, RANGES.loreHolder);
    const { loreId: _l, agentId: _a, ...set } = h;
    await this.db
      .insert(loreHolders)
      .values({ ...h, worldId: this.worldId })
      .onConflictDoUpdate({
        target: [loreHolders.worldId, loreHolders.loreId, loreHolders.agentId],
        set,
      });
  }

  async lore() {
    const rows = await this.db.select().from(lore).where(eq(lore.worldId, this.worldId));
    return rows.map(({ worldId: _w, ...r }: LoreRow) => Lore.parse(r));
  }

  async holders() {
    const rows = await this.db
      .select()
      .from(loreHolders)
      .where(eq(loreHolders.worldId, this.worldId));
    return rows.map(({ worldId: _w, ...r }: HolderRow) => LoreHolder.parse(r));
  }
}
