import { writeChronicle as composeChronicle, type Agent } from "@lethetown/agent-core";
import type { Chronicle } from "@lethetown/shared";
import { errorMessage, type SimContext } from "./context";

/** Memoria humana en la simulación: mantenimiento, consolidación nocturna y crónica diaria. */

const MAINTENANCE_EVERY = 60;
const CHRONICLE_MINUTE = 23 * 60;

export async function maintain(ctx: SimContext, agent: Agent, now: number): Promise<void> {
  const rt = ctx.rt(agent.id);
  if (!ctx.deps.maintenance || now - rt.lastMaintenance < MAINTENANCE_EVERY) return;
  rt.lastMaintenance = now;
  const others = [...ctx.agents.keys()].filter((id) => id !== agent.id);
  const report = await ctx.deps.maintenance.run(agent.owner, now, others);
  const n = report.deleted.length + report.archived.length;
  if (n) {
    ctx.emit(
      "memory",
      agent.id,
      `🧠 ${agent.seed.name} olvida ${report.deleted.length} recuerdos y resume ${report.archived.length} (presupuesto de memoria)`,
      [agent.id],
    );
  }
}

export async function consolidate(ctx: SimContext, agent: Agent, now: number): Promise<void> {
  const rt = ctx.rt(agent.id);
  const night = Math.floor((now - 7 * 60) / 1440);
  if (!ctx.deps.consolidator || rt.consolidatedNight === night) return;
  rt.consolidatedNight = night;
  try {
    const r = await ctx.deps.consolidator.consolidate(agent.owner, rt.lastConsolidation, now);
    rt.lastConsolidation = now;
    // Nada que consolidar (p. ej. al arrancar de madrugada): no ensuciar el log.
    if (!r.created.length && !r.reinforced.length && !r.weakened.length) return;
    ctx.emit(
      "memory",
      agent.id,
      `🌙 ${agent.seed.name} consolida el día: ${r.created.length} reflexiones/hechos, refuerza ${r.reinforced.length} y debilita ${r.weakened.length} recuerdos`,
      [agent.id],
    );
  } catch (error) {
    ctx.emit("system", agent.id, `⚠ Error en "consolidate": ${errorMessage(error)}`);
  }
}

export function scheduleChronicle(ctx: SimContext, now: number): void {
  const day = Math.floor(now / 1440);
  const at = day * 1440 + CHRONICLE_MINUTE;
  const next = at > now ? at : at + 1440;
  ctx.clock.schedule(next, async () => {
    await writeChronicle(ctx, Math.floor(next / 1440));
    scheduleChronicle(ctx, ctx.clock.now() + 1);
  });
}

export async function writeChronicle(ctx: SimContext, day: number): Promise<Chronicle | null> {
  try {
    const events = await ctx.deps.events.range(day * 1440, (day + 1) * 1440, 2000);
    const lines = events
      .filter((e) => ["speech", "action", "world", "thought", "memory"].includes(e.kind))
      .map((e) => e.text);
    const chronicle = await composeChronicle(ctx.deps.llm, day, lines, 120, ctx.deps.language);
    await ctx.deps.chronicles.add(chronicle);
    ctx.emit("chronicle", null, `📜 Crónica del día ${day}: ${chronicle.title}`);
    ctx.signal({ type: "chronicle", chronicle });
    return chronicle;
  } catch (error) {
    ctx.emit("system", null, `⚠ Error en "chronicle": ${errorMessage(error)}`);
    return null;
  }
}
