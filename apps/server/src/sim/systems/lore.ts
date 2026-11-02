/**
 * Sistema de saberes del pueblo: recetas, técnicas, sitios, historias y canciones que se cuentan,
 * se deforman, se refuerzan con el uso y pueden perderse (lógica en sim/lore.ts y
 * agent-core/lore). Sin llamadas nuevas al LLM. Ver docs/decisiones/lore.md.
 */
import { Lore, LoreHolder } from "@lethetown/shared";
import { z } from "zod";
import { formalAction } from "../agreements";
import { presentWith } from "../perception";
import { listenToPractice, loreCfg, loreLines, loreState, loreTick, seedLore } from "../lore";
import { registerSystem } from "./registry";
import { REVIEW_MINUTES, type AgreementKind } from "./types";

/** «Te cuento cómo hacía las magdalenas mi mujer»: `from` lo cuenta a `to`. */
const shareAgreement: AgreementKind = {
  type: "share_lore",
  steps: (_ctx, a) =>
    a.loreId && a.to.length
      ? a.to.map((who) => ({
          actorId: a.from,
          action: () => formalAction({ type: "share_lore", who, loreId: a.loreId! }),
        }))
      : "falta qué saber o a quién",
  covers: (i) => /contar|receta|enseñar/i.test(i.text),
};

registerSystem({
  id: "lore",
  description: "Saberes del pueblo: se cuentan, se deforman, se refuerzan con el uso y se pierden.",
  actions: ["share_lore"],
  agreements: [shareAgreement],
  snapshot: {
    version: 1,
    schema: z.object({
      lore: z.array(Lore),
      holders: z.array(LoreHolder),
      seq: z.number().int().nonnegative(),
      lastDecayDay: z.number(),
      counts: z.object({
        transmissions: z.number(),
        forgotten: z.number(),
        lost: z.number(),
        altered: z.number(),
      }),
    }),
    save: (ctx) => {
      const s = loreState(ctx);
      return {
        lore: structuredClone([...s.lore.values()]),
        holders: structuredClone([...s.holders.values()]),
        seq: s.seq,
        lastDecayDay: s.lastDecayDay,
        counts: { ...s.counts },
      };
    },
    restore: (ctx, d) => {
      const s = loreState(ctx);
      s.lore = new Map(d.lore.map((l) => [l.id, l]));
      s.holders = new Map(d.holders.map((h) => [`${h.loreId}:${h.agentId}`, h]));
      s.seq = d.seq;
      s.lastDecayDay = d.lastDecayDay;
      s.counts = { ...d.counts };
    },
  },
  load: async (ctx, { restored, now }) => {
    listenToPractice(ctx);
    if (restored) return;
    const s = loreState(ctx);
    const [items, holders] = await Promise.all([s.store.lore(), s.store.holders()]);
    if (items.length) {
      s.lore = new Map(items.map((l) => [l.id, l]));
      s.holders = new Map(holders.map((h) => [`${h.loreId}:${h.agentId}`, h]));
      s.seq = Math.max(0, ...items.map((l) => Number(l.id.slice(1)) || 0));
    } else {
      seedLore(ctx, now);
    }
  },
  tick: { every: REVIEW_MINUTES, run: loreTick },
  promptSections: (ctx, agent, now) => {
    if (!loreCfg(ctx).enabled || !presentWith(ctx, agent).length) return [];
    const lines = loreLines(ctx, agent, now);
    return lines.length ? [{ title: "SABERES QUE PUEDES CONTAR", lines, order: 66 }] : [];
  },
  retention: {
    table: "lore",
    keep: "son los saberes del pueblo y quién los sabe (pocas filas); lore_holders va con ellos",
  },
  metrics: (ctx) => {
    const s = loreState(ctx);
    const holders = [...s.holders.values()].filter((h) => h.forgottenAt === null);
    return {
      lore: s.lore.size,
      lost: [...s.lore.values()].filter((l) => l.lostAt !== null).length,
      holders: holders.length,
      meanFidelity: holders.length
        ? Math.round((holders.reduce((a, h) => a + h.fidelity, 0) / holders.length) * 100) / 100
        : 0,
      transmissions: s.counts.transmissions,
      altered: s.counts.altered,
      forgotten: s.counts.forgotten,
    };
  },
  admin: (ctx) => ({
    lore: [...loreState(ctx).lore.values()],
    holders: [...loreState(ctx).holders.values()],
  }),
});
