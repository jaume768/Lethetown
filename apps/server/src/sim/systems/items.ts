/** Sistema de inventario y préstamos (sim/items.ts y sim/actions/items.ts; mock en agent/mock/items.ts). */
import { Item } from "@lethetown/shared";
import { z } from "zod";
import { inventorySections, itemsState, itemsTick, loadItems } from "../items";
import { registerSystem } from "./registry";
import { REVIEW_MINUTES } from "./types";

registerSystem({
  id: "items",
  description: "Objetos que se llevan encima: dueño, regalos, préstamos y devoluciones.",
  actions: ["give_item", "lend_item", "return_item", "take_item", "leave_item"],
  snapshot: {
    version: 1,
    schema: z.object({ items: z.array(Item), seq: z.number().int().nonnegative() }),
    save: (ctx) => {
      const s = itemsState(ctx);
      return { items: structuredClone([...s.items.values()]), seq: s.seq };
    },
    restore: (ctx, data) => {
      const s = itemsState(ctx);
      s.items.clear();
      for (const i of data.items) s.items.set(i.id, i);
      s.seq = data.seq;
    },
  },
  load: async (ctx, { restored, now }) =>
    loadItems(ctx, restored ? [] : await ctx.itemStore.listAll(), now),
  tick: { every: REVIEW_MINUTES, run: itemsTick },
  promptSections: (ctx, agent) => inventorySections(ctx, agent).map((s) => ({ ...s, order: 20 })),
  retention: { table: "inventory_items", keep: "es el estado vivo del inventario, no historial" },
  metrics: (ctx) => {
    const items = [...itemsState(ctx).items.values()];
    return {
      items: items.length,
      loans: items.filter((i) => i.loan).length,
      overdue: items.filter((i) => i.loan?.overdueNoticed).length,
    };
  },
  admin: (ctx) => [...itemsState(ctx).items.values()],
});
