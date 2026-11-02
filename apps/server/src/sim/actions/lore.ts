/** Contar un saber a alguien presente (sistema `lore`, ver sim/lore.ts). */
import type { ShareLoreAction } from "@lethetown/shared";
import type { z } from "zod";
import type { SimContext } from "../context";
import { heldBy, holderOf, loreState, shareLore } from "../lore";
import { isHere, registerAction, type ActionContext } from "./registry";
import { teachingRule } from "./skills";

const nameOf = (ctx: SimContext, id: string) => ctx.agents.get(id)?.seed.name ?? id;
const firstOf = (ctx: SimContext, id: string) => nameOf(ctx, id).split(" ")[0]!;
const someoneHere = (c: ActionContext) => [...c.ctx.agents.keys()].some((id) => isHere(c, id));

registerAction<z.infer<typeof ShareLoreAction>>({
  type: "share_lore",
  available: (c) => someoneHere(c) && heldBy(c.ctx, c.agent.id).length > 0,
  check: (c, a) => {
    if (!isHere(c, a.who)) return `${nameOf(c.ctx, a.who)} no está aquí`;
    const l = loreState(c.ctx).lore.get(a.loreId);
    const mine = holderOf(c.ctx, a.loreId, c.agent.id);
    if (!l || !mine || mine.forgottenAt !== null) return `no sé nada de "${a.loreId}"`;
    return teachingRule(c.ctx, [c.agent.id, a.who], c.agent.state.locationId);
  },
  describe: ({ ctx }, a) =>
    `contarle a ${firstOf(ctx, a.who)} ${loreState(ctx).lore.get(a.loreId)?.title ?? a.loreId}`,
  execute: ({ ctx, agent, now }, a) => {
    const l = loreState(ctx).lore.get(a.loreId)!;
    const r = shareLore(ctx, agent, a.who, a.loreId, now);
    ctx.rt(a.who).pending.push({
      kind: "world",
      text: `${agent.seed.name} me ha contado ${l.title}.`,
      placeId: agent.state.locationId,
    });
    const how = r
      ? ` (se queda con ${r.kept} de ${l.elements.length} cosas)`
      : " (no se queda con nada)";
    ctx.emit(
      "action",
      agent.id,
      `📜 ${agent.seed.name} le cuenta a ${firstOf(ctx, a.who)} «${l.title}»${how}`,
      [agent.id, a.who],
      undefined,
      { action: "share_lore", ok: true },
    );
  },
});
