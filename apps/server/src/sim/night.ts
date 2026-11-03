import type { SimContext } from "./context";
import { nightOf } from "./memory-routines";
import { systemsHold } from "./systems/registry";

/**
 * ¿Duerme todo el pueblo? Cada vecino que está aquí (no de viaje ni fuera del pueblo) está en
 * su cama, quieto y ya ha empezado la consolidación de esta noche (su llamada al LLM, si sigue
 * en curso, la cuenta quien pregunta). Lo usa la noche rápida (`night-speed.ts`).
 */
export function everyoneAsleep(ctx: SimContext, now: number): boolean {
  const night = nightOf(now);
  for (const agent of ctx.agents.values()) {
    const rt = ctx.rt(agent.id);
    if (rt.travelling || systemsHold(ctx, agent.id)) continue;
    if (!agent.isSleepTime(now)) return false;
    if (agent.state.activityKind !== "sleep" || agent.state.movement) return false;
    if (ctx.deps.consolidator && rt.consolidatedNight !== night) return false;
  }
  return true;
}
