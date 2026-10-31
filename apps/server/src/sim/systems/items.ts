/** Sistema de inventario y préstamos (sim/items.ts y sim/actions/items.ts; mock en agent/mock/items.ts). */
import { Item } from "@lethetown/shared";
import { z } from "zod";
import { inventorySections, itemsState, itemsTick, loadItems } from "../items";
import { formalAction } from "../agreements";
import type { SimContext } from "../context";
import { registerSystem } from "./registry";
import { REVIEW_MINUTES, type AgreementKind, type ResolvedAgreement } from "./types";

/** El objeto del acuerdo y a quién va (el primero de los demás), o el motivo. */
function handOver(ctx: SimContext, a: ResolvedAgreement) {
  const item = a.itemId ? itemsState(ctx).items.get(a.itemId) : undefined;
  if (!item) return `no hay ningún objeto "${a.itemId ?? ""}"`;
  return { item, to: a.to[0]! };
}

/** Dar o prestar: lo hace quien lo lleva encima (si está en la charla), a quien lo recibe. */
const handOverAgreement = (type: "loan" | "gift"): AgreementKind => ({
  type,
  steps: (ctx, a) => {
    const h = handOver(ctx, a);
    if (typeof h === "string") return h;
    const giver = h.item.holderId && a.people.includes(h.item.holderId) ? h.item.holderId : a.from;
    const to = giver === h.to ? a.from : h.to;
    return [
      {
        actorId: giver,
        action: () =>
          formalAction({
            type: type === "loan" ? "lend_item" : "give_item",
            itemId: h.item.id,
            to,
          }),
      },
    ];
  },
  covers: (i) => (type === "loan" ? /prest|devol/i : /regal|dar/i).test(i.text),
});

/** Devolver: lo hace quien lo tiene prestado. */
const returnAgreement: AgreementKind = {
  type: "return",
  steps: (ctx, a) => {
    const h = handOver(ctx, a);
    if (typeof h === "string") return h;
    if (!h.item.loan) return `${h.item.name} no está prestado`;
    const borrower = h.item.loan.to;
    if (!a.people.includes(borrower)) return `quien tiene ${h.item.name} no estaba en la charla`;
    return [
      { actorId: borrower, action: () => formalAction({ type: "return_item", itemId: h.item.id }) },
    ];
  },
  covers: (i) => /devol/i.test(i.text),
};

registerSystem({
  id: "items",
  description: "Objetos que se llevan encima: dueño, regalos, préstamos y devoluciones.",
  actions: ["give_item", "lend_item", "return_item", "take_item", "leave_item"],
  agreements: [handOverAgreement("loan"), handOverAgreement("gift"), returnAgreement],
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
