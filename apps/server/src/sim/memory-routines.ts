import { writeChronicle as composeChronicle, type Agent } from "@lethetown/agent-core";
import type { Chronicle } from "@lethetown/shared";
import { errorMessage, type SimContext } from "./context";
import { systemConsolidation } from "./systems/registry";

/** Memoria humana en la simulación: mantenimiento, consolidación nocturna y crónica diaria. */

const MAINTENANCE_EVERY = 60;
const CHRONICLE_MINUTE = 23 * 60;
/** Líneas del día que ve el cronista. */
const CHRONICLE_LINES = 120;

/**
 * Rutina que no cuenta para la crónica: "Nombre: actividad" (cambios de actividad, caminar).
 * En la partida de estudio era la mayoría de los eventos y dejaba fuera la mañana.
 */
function isRoutine(ctx: SimContext, kind: string, text: string): boolean {
  if (kind !== "action") return false;
  for (const a of ctx.agents.values()) if (text.startsWith(`${a.seed.name}: `)) return true;
  return false;
}

/**
 * Como mucho `n` líneas repartidas por todo el día (antes eran las últimas `n`: la crónica solo
 * contaba la noche).
 */
export function spreadOverDay(lines: string[], n: number): string[] {
  if (lines.length <= n) return lines;
  return Array.from({ length: n }, (_, i) => lines[Math.floor((i * lines.length) / n)]!);
}

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
    // Cómo dormirá: según lo tenso o preocupado que se acuesta.
    agent.fallAsleep();
    // Primero el cierre del día (diario y hábitos, sin LLM): el diario entra en la reflexión.
    const end = await agent.endDay(now, night);
    for (const habit of end.habitsFormed) {
      ctx.emit("memory", agent.id, `🔁 ${agent.seed.name} ya tiene una costumbre: «${habit}»`, [
        agent.id,
      ]);
    }
    // Lo que añaden los sistemas (repasar sus metas…) va en la misma llamada.
    const parts = systemConsolidation(ctx, agent, now);
    const r = await ctx.deps.consolidator.consolidate(
      agent.owner,
      rt.lastConsolidation,
      now,
      parts.map((p) => ({ key: p.key, prompt: p.prompt })),
    );
    // +1: lo creado ahora (diario, hechos) no vuelve a entrar en la consolidación de mañana.
    rt.lastConsolidation = now + 1;
    for (const p of parts) {
      const applied = p.apply(r.extras[p.key], now);
      if (applied) await applied;
    }
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
    const events = await ctx.deps.events.range(day * 1440, (day + 1) * 1440, 5000);
    const lines = spreadOverDay(
      events
        .filter((e) => ["speech", "action", "world", "thought", "memory"].includes(e.kind))
        .filter((e) => !isRoutine(ctx, e.kind, e.text))
        .map((e) => e.text),
      CHRONICLE_LINES,
    );
    const chronicle = await composeChronicle(
      ctx.deps.llm,
      day,
      lines,
      CHRONICLE_LINES,
      ctx.deps.language,
      ctx.deps.memory.guard,
    );
    await ctx.deps.chronicles.add(chronicle);
    ctx.emit("chronicle", null, `📜 Crónica del día ${day}: ${chronicle.title}`);
    ctx.signal({ type: "chronicle", chronicle });
    return chronicle;
  } catch (error) {
    ctx.emit("system", null, `⚠ Error en "chronicle": ${errorMessage(error)}`);
    return null;
  }
}
