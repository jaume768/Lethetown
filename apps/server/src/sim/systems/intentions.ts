/**
 * Sistema de intenciones (solo métricas): la memoria prospectiva es del núcleo (agent-core), y
 * aquí se cuenta cómo va para la pestaña «Evolución» y `study:analyze`: abiertas por agente,
 * fusionadas, descartadas por el tope, caducadas, cumplidas y olvidadas (de la auditoría). En la
 * partida 2 se proponían 199 al día y solo se cumplía el 46 %. Sin LLM ni prompt.
 */
import type { MemoryAuditEntry } from "@lethetown/shared";
import { z } from "zod";
import type { SimContext } from "../context";
import { registerSystem } from "./registry";

/** Lo que cuenta (acción de la auditoría → nombre de la métrica). */
const COUNTED = {
  intention_merged: "merged",
  intention_dropped: "dropped",
  intention_expired: "expired",
  intention_kept: "kept",
  intention_forgotten: "forgotten",
} as const satisfies Partial<Record<MemoryAuditEntry["action"], string>>;
type Counted = (typeof COUNTED)[keyof typeof COUNTED];

interface IntentionsState {
  counts: Record<Counted, number>;
  listening: boolean;
}

const zero = (): Record<Counted, number> => ({
  merged: 0,
  dropped: 0,
  expired: 0,
  kept: 0,
  forgotten: 0,
});

export const intentionsState = (ctx: SimContext) =>
  ctx.state<IntentionsState>("intentions", () => ({ counts: zero(), listening: false }));

/** Abiertas (pendientes u olvidadas que aún pueden volver) de cada agente. */
export function openIntentions(ctx: SimContext): Map<string, number> {
  const out = new Map<string, number>();
  for (const a of ctx.agents.values()) {
    out.set(
      a.id,
      a.mind.intentions.filter((i) => i.status === "pending" || i.status === "forgotten").length,
    );
  }
  return out;
}

registerSystem({
  id: "intentions",
  description: "Lo que cada uno se propone hacer: abiertas, fusionadas, descartadas y caducadas.",
  snapshot: {
    version: 1,
    schema: z.object({ counts: z.record(z.string(), z.number()) }),
    save: (ctx) => ({ counts: { ...intentionsState(ctx).counts } }),
    restore: (ctx, d) => {
      intentionsState(ctx).counts = { ...zero(), ...d.counts };
    },
  },
  load: (ctx) => {
    const s = intentionsState(ctx);
    if (s.listening) return;
    s.listening = true;
    ctx.deps.memory.onAudit((e) => {
      const key = COUNTED[e.action as keyof typeof COUNTED];
      if (key) s.counts[key]++;
    });
  },
  retention: {
    table: "memory_audit",
    keep: "no tiene tabla propia: cuenta lo que ya guarda la auditoría de memoria",
  },
  metrics: (ctx) => {
    const open = [...openIntentions(ctx).values()];
    const total = open.reduce((a, b) => a + b, 0);
    const out: Record<string, number> = {
      open: total,
      openMean: open.length ? Math.round((total / open.length) * 10) / 10 : 0,
      openMax: open.length ? Math.max(...open) : 0,
      ...intentionsState(ctx).counts,
    };
    for (const [id, n] of openIntentions(ctx)) out[`open.${id}`] = n;
    return out;
  },
});
