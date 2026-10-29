/** Almacén de objetos del inventario, en RAM o en Postgres, siempre por mundo. */
import { Item } from "@lethetown/shared";
import { and, eq, or } from "drizzle-orm";
import type { Db } from "./client";
import { inventoryItems } from "./schema";

export interface ItemStore {
  upsert(item: Item): Promise<void>;
  /** Todos los del mundo (para cargarlos al arrancar sin instantánea). */
  listAll(): Promise<Item[]>;
  /** Los que lleva o son suyos. */
  listFor(agentId: string): Promise<Item[]>;
}

/** "i12" → 12. */
export const itemSeqOf = (id: string) => Number(/^i(\d+)$/.exec(id)?.[1] ?? 0);
const byId = (a: Item, b: Item) => itemSeqOf(a.id) - itemSeqOf(b.id);

export class InMemoryItemStore implements ItemStore {
  private readonly items = new Map<string, Item>();

  async upsert(item: Item) {
    this.items.set(item.id, structuredClone(item));
  }

  async listAll() {
    return [...this.items.values()].sort(byId).map((i) => structuredClone(i));
  }

  async listFor(agentId: string) {
    return (await this.listAll()).filter((i) => i.holderId === agentId || i.ownerId === agentId);
  }
}

type Row = typeof inventoryItems.$inferSelect;
const toItem = ({ worldId: _w, ...r }: Row): Item => Item.parse(r);

export class PgItemStore implements ItemStore {
  constructor(
    private readonly db: Db,
    readonly worldId: string,
  ) {}

  async upsert(item: Item) {
    const { id: _id, ...set } = item;
    await this.db
      .insert(inventoryItems)
      .values({ ...item, worldId: this.worldId })
      .onConflictDoUpdate({ target: [inventoryItems.worldId, inventoryItems.id], set });
  }

  async listAll() {
    const rows = await this.db
      .select()
      .from(inventoryItems)
      .where(eq(inventoryItems.worldId, this.worldId));
    return rows.map(toItem).sort(byId);
  }

  async listFor(agentId: string) {
    const rows = await this.db
      .select()
      .from(inventoryItems)
      .where(
        and(
          eq(inventoryItems.worldId, this.worldId),
          or(eq(inventoryItems.holderId, agentId), eq(inventoryItems.ownerId, agentId)),
        ),
      );
    return rows.map(toItem).sort(byId);
  }
}
