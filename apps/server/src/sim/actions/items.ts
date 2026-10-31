/**
 * Acciones de inventario: regalar, prestar, devolver, coger y dejar (ver sim/items.ts). El LLM
 * elige qué hacer; el motor comprueba de quién es cada cosa, quién la lleva y quién está delante.
 * Con un menor y un adulto, solo en un sitio público (como las citas).
 */
import { applySocialUpdate } from "@lethetown/agent-core";
import type {
  GiveItemAction,
  Item,
  LeaveItemAction,
  LendItemAction,
  ReturnItemAction,
  TakeItemAction,
} from "@lethetown/shared";
import type { z } from "zod";
import type { SimContext } from "../context";
import { itemsState, saveItem } from "../items";
import { minorMeetingRule } from "./meetings";
import { isHere, registerAction, type ActionContext } from "./registry";

const nameOf = (ctx: SimContext, id: string) => ctx.agents.get(id)?.seed.name ?? id;
const firstOf = (ctx: SimContext, id: string) => nameOf(ctx, id).split(" ")[0]!;

/** Aquí (o en la charla del acuerdo): ver `isHere`. */
const here = isHere;

const someoneHere = (c: ActionContext) => [...c.ctx.agents.keys()].some((id) => here(c, id));
const carried = (c: ActionContext) =>
  [...itemsState(c.ctx).items.values()].filter((i) => i.holderId === c.agent.id);

/** El objeto si lo lleva encima; si no, el motivo. */
function mine(c: ActionContext, itemId: string): Item | string {
  const item = itemsState(c.ctx).items.get(itemId);
  if (!item) return `no tengo ningún "${itemId}"`;
  if (item.holderId !== c.agent.id) return `no llevo ${item.name} encima`;
  return item;
}

/** Comprobaciones comunes de dar o prestar algo propio a alguien de aquí. */
function checkHandOver(c: ActionContext, itemId: string, to: string): string | null {
  const item = mine(c, itemId);
  if (typeof item === "string") return item;
  if (!here(c, to)) return `${nameOf(c.ctx, to)} no está aquí`;
  if (item.ownerId !== c.agent.id) return `${item.name} no es mío`;
  if (item.loan) return `${item.name} está prestado`;
  return minorMeetingRule(c.ctx, [c.agent.id, to], c.agent.state.locationId);
}

/** Aviso a quien recibe algo y evento del log. */
function announce(
  c: ActionContext,
  action: string,
  to: string,
  text: string,
  perception: string,
): void {
  c.ctx.rt(to).pending.push({ kind: "world", text: perception, placeId: c.agent.state.locationId });
  c.ctx.emit("action", c.agent.id, text, [c.agent.id, to], undefined, { action, ok: true });
}

registerAction<z.infer<typeof GiveItemAction>>({
  type: "give_item",
  available: (c) => someoneHere(c) && carried(c).some((i) => i.ownerId === c.agent.id && !i.loan),
  check: (c, a) => checkHandOver(c, a.itemId, a.to),
  describe: ({ ctx }, a) =>
    `regalarle ${itemsState(ctx).items.get(a.itemId)?.name ?? a.itemId} a ${firstOf(ctx, a.to)}`,
  execute: async (c, a) => {
    const { ctx, agent, now } = c;
    const item = itemsState(ctx).items.get(a.itemId)!;
    item.ownerId = a.to;
    item.holderId = a.to;
    saveItem(ctx, item);
    announce(
      c,
      "give_item",
      a.to,
      `🎁 ${agent.seed.name} le regala ${item.name} a ${nameOf(ctx, a.to)}`,
      `${agent.seed.name} me ha regalado ${item.name} (${item.id}).`,
    );
    await applySocialUpdate(ctx.deps.social, {
      ownerId: a.to,
      aboutId: agent.id,
      affinityDelta: 0.05,
      now,
      reason: `me regaló ${item.name}`,
      config: ctx.deps.memory.config.social,
    });
  },
});

registerAction<z.infer<typeof LendItemAction>>({
  type: "lend_item",
  available: (c) => someoneHere(c) && carried(c).some((i) => i.ownerId === c.agent.id && !i.loan),
  check: (c, a) => checkHandOver(c, a.itemId, a.to),
  describe: ({ ctx }, a) =>
    `prestarle ${itemsState(ctx).items.get(a.itemId)?.name ?? a.itemId} a ${firstOf(ctx, a.to)}`,
  execute: async (c, a) => {
    const { ctx, agent, now } = c;
    const item = itemsState(ctx).items.get(a.itemId)!;
    item.holderId = a.to;
    item.loan = {
      from: agent.id,
      to: a.to,
      since: now,
      dueAt: now + a.days * 1440,
      overdueNoticed: false,
    };
    saveItem(ctx, item);
    // Quien lo recibe se propone devolverlo (memoria prospectiva: se le puede olvidar).
    await ctx.agents.get(a.to)?.intend(now, {
      text: `devolverle a ${firstOf(ctx, agent.id)} ${item.name}`,
      personId: agent.id,
    });
    announce(
      c,
      "lend_item",
      a.to,
      `🤝 ${agent.seed.name} le presta ${item.name} a ${nameOf(ctx, a.to)} (${a.days} días)`,
      `${agent.seed.name} me ha prestado ${item.name} (${item.id}); tengo que devolvérselo en ${a.days} días.`,
    );
  },
});

registerAction<z.infer<typeof ReturnItemAction>>({
  type: "return_item",
  available: (c) => carried(c).some((i) => i.loan?.to === c.agent.id && here(c, i.loan.from)),
  check: (c, a) => {
    const item = mine(c, a.itemId);
    if (typeof item === "string") return item;
    if (item.loan?.to !== c.agent.id) return `${item.name} no me lo han prestado`;
    return here(c, item.loan.from) ? null : `${nameOf(c.ctx, item.loan.from)} no está aquí`;
  },
  describe: ({ ctx }, a) => `devolver ${itemsState(ctx).items.get(a.itemId)?.name ?? a.itemId}`,
  execute: async (c, a) => {
    const { ctx, agent, now } = c;
    const item = itemsState(ctx).items.get(a.itemId)!;
    const loan = item.loan!;
    item.holderId = loan.from;
    item.loan = null;
    saveItem(ctx, item);
    await agent.fulfillIntention(
      (i) => i.personId === loan.from && /devol/i.test(i.text),
      now,
      `le devolvió ${item.name}`,
    );
    announce(
      c,
      "return_item",
      loan.from,
      `📗 ${agent.seed.name} le devuelve ${item.name} a ${nameOf(ctx, loan.from)}`,
      `${agent.seed.name} me ha devuelto ${item.name} (${item.id})${loan.overdueNoticed ? ", por fin" : ""}.`,
    );
    await applySocialUpdate(ctx.deps.social, {
      ownerId: loan.from,
      aboutId: agent.id,
      affinityDelta: loan.overdueNoticed ? 0.01 : 0.03,
      trustDelta: loan.overdueNoticed ? 0 : 0.02,
      now,
      reason: `me devolvió ${item.name}${loan.overdueNoticed ? " (tarde)" : ""}`,
      config: ctx.deps.memory.config.social,
    });
  },
});

registerAction<z.infer<typeof TakeItemAction>>({
  type: "take_item",
  available: (c) =>
    [...itemsState(c.ctx).items.values()].some(
      (i) =>
        !i.holderId &&
        i.placeId === c.agent.state.locationId &&
        (i.ownerId === null || i.ownerId === c.agent.id),
    ),
  check: ({ ctx, agent }, a) => {
    const item = itemsState(ctx).items.get(a.itemId);
    if (!item || item.holderId || item.placeId !== agent.state.locationId) {
      return `aquí no hay ningún "${a.itemId}"`;
    }
    if (item.ownerId && item.ownerId !== agent.id)
      return `${item.name} es de ${nameOf(ctx, item.ownerId)}`;
    return null;
  },
  describe: ({ ctx }, a) => `coger ${itemsState(ctx).items.get(a.itemId)?.name ?? a.itemId}`,
  execute: ({ ctx, agent }, a) => {
    const item = itemsState(ctx).items.get(a.itemId)!;
    item.holderId = agent.id;
    item.placeId = null;
    // Lo que era de nadie pasa a ser suyo.
    item.ownerId ??= agent.id;
    saveItem(ctx, item);
    ctx.emit("action", agent.id, `✋ ${agent.seed.name} coge ${item.name}`, [agent.id], undefined, {
      action: "take_item",
      ok: true,
    });
  },
});

registerAction<z.infer<typeof LeaveItemAction>>({
  type: "leave_item",
  available: (c) => carried(c).some((i) => i.ownerId === c.agent.id && !i.loan),
  check: (c, a) => {
    const item = mine(c, a.itemId);
    if (typeof item === "string") return item;
    return item.ownerId === c.agent.id ? null : `${item.name} no es mío: mejor devolverlo`;
  },
  describe: ({ ctx }, a) => `dejar ${itemsState(ctx).items.get(a.itemId)?.name ?? a.itemId}`,
  execute: ({ ctx, agent }, a) => {
    const item = itemsState(ctx).items.get(a.itemId)!;
    item.holderId = null;
    item.placeId = agent.state.locationId;
    saveItem(ctx, item);
    const place = ctx.world.place(agent.state.locationId).name;
    ctx.emit(
      "action",
      agent.id,
      `📦 ${agent.seed.name} deja ${item.name} en ${place}`,
      [agent.id],
      undefined,
      { action: "leave_item", ok: true },
    );
  },
});
