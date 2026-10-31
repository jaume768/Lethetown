/**
 * Puente de la conversación a la acción (sim/agreements.ts). Sus tipos de acuerdo los aportan
 * los demás sistemas (`agreements` de cada uno); aquí solo sus cifras. Sin instantánea: lo hecho
 * queda en las tablas de cada sistema y los descartes en la auditoría (`agreement_discarded`).
 */
import { agreementsState } from "../agreements";
import { registerSystem } from "./registry";

registerSystem({
  id: "agreements",
  description: "Lo acordado hablando pasa por las mismas acciones formales del motor.",
  retention: { table: "memory_audit", policy: "memoryAudit" },
  metrics: (ctx) => {
    const s = agreementsState(ctx);
    const sum = (r: Record<string, number>) => Object.values(r).reduce((a, b) => a + b, 0);
    return {
      applied: sum(s.applied),
      discarded: sum(s.discarded),
      linkedIntentions: s.linkedIntentions,
      ...Object.fromEntries(Object.entries(s.applied).map(([t, n]) => [`applied.${t}`, n])),
    };
  },
});
