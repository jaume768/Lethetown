/**
 * Citas entre agentes (compromisos): agenda para el prompt, hueco en el plan y, llegada la hora,
 * quién se acuerda de ir, quién llega (o tarde) y cómo acaba. Un plantón afecta a la afinidad y
 * la confianza, cambia el ánimo y es un drama. Sin LLM: todo lo decide el motor (la memoria de
 * cada uno, con su perfil, decide si se acuerda).
 */
import { applySocialUpdate, formatClock, makeMood, type Agent } from "@lethetown/agent-core";
import type { Commitment, PlanItem } from "@lethetown/shared";
import type { SimContext } from "./context";
import { goOrDo } from "./routines";

/** Minutos antes de la hora en que uno se acuerda (o no) y sale hacia la cita. */
export const MEETING_LEAD = 20;
/** Minutos después de la hora que se espera a los demás. */
export const MEETING_WINDOW = 45;
/** Llegar más tarde de esto (minutos) es llegar tarde. */
export const LATE_AFTER = 10;
/** Duración del hueco que reserva una cita en el plan (minutos). */
export const MEETING_SLOT = 60;
/** Afinidad y confianza que quita un plantón (a quien esperaba) y llegar tarde. */
const NO_SHOW_AFFINITY = -0.15;
const NO_SHOW_TRUST = -0.1;
const LATE_AFFINITY = -0.03;

const name = (ctx: SimContext, id: string) => ctx.agents.get(id)?.seed.name ?? id;
const first = (ctx: SimContext, id: string) => name(ctx, id).split(" ")[0]!;
const placeName = (ctx: SimContext, id: string) =>
  ctx.world.places.find((p) => p.id === id)?.name ?? id;

/** "hoy a las 10:00" / "mañana a las 17:30" / "el día 4 a las 9:00". */
export function whenText(at: number, now: number): string {
  const days = Math.floor(at / 1440) - Math.floor(now / 1440);
  const day = days === 0 ? "hoy" : days === 1 ? "mañana" : `el día ${Math.floor(at / 1440)}`;
  return `${day} a las ${formatClock(at % 1440)}`;
}

export function newMeetingId(ctx: SimContext): string {
  ctx.meetingSeq += 1;
  return `c${ctx.meetingSeq}`;
}

/** Guarda la cita (en el runtime y, en segundo plano, en el almacén). */
export function saveMeeting(ctx: SimContext, c: Commitment): void {
  c.updatedAt = ctx.clock.now();
  ctx.meetings.set(c.id, c);
  const write = ctx.commitments
    .upsert(structuredClone(c))
    .catch((e: unknown) => ctx.emit("system", null, `⚠ No se pudo guardar la cita: ${String(e)}`));
  ctx.deps.track?.(write);
}

/** Los que han dicho que sí (incluido quien la propuso). */
export function acceptedOf(c: Commitment): string[] {
  return c.participants.filter((p) => c.responses[p] === "accepted");
}

/** Citas abiertas (propuestas o aceptadas) de un agente. */
export function openMeetingsOf(ctx: SimContext, agentId: string): Commitment[] {
  return [...ctx.meetings.values()]
    .filter((c) => c.participants.includes(agentId))
    .filter((c) => c.status === "proposed" || c.status === "accepted")
    .sort((a, b) => a.at - b.at);
}

/** Líneas de la AGENDA del prompt de decidir. */
export function agendaLines(ctx: SimContext, agentId: string, now: number): string[] {
  return openMeetingsOf(ctx, agentId).map((c) => {
    const others = c.participants.filter((p) => p !== agentId).map((p) => first(ctx, p));
    const where = `${placeName(ctx, c.placeId)}, ${whenText(c.at, now)} (${c.reason})`;
    if (c.responses[agentId] === "pending") {
      return `Cita ${c.id}: ${first(ctx, c.organizerId)} te propone quedar en ${where}. Responde con accept_meeting o decline_meeting.`;
    }
    return `Cita ${c.id} con ${others.join(", ")}: ${where}.`;
  });
}

/** Hueco del plan de una cita (minuto del día de inicio y lo que se hace). */
export function slotOf(ctx: SimContext, c: Commitment, agentId: string): PlanItem {
  const others = c.participants.filter((p) => p !== agentId).map((p) => first(ctx, p));
  const start = Math.max(0, (c.at % 1440) - MEETING_LEAD);
  return {
    startMinute: start,
    durationMin: Math.min(MEETING_SLOT + MEETING_LEAD, 1440 - start),
    activity: `cita con ${others.join(" y ")}: ${c.reason}`,
    activityKind: "idle",
    placeId: c.placeId,
    spotId: null,
    replanned: true,
  };
}

/** Citas aceptadas de un agente en un día (para planificarlo respetándolas). */
export function fixedPlanFor(ctx: SimContext, agentId: string, day: number): PlanItem[] {
  return openMeetingsOf(ctx, agentId)
    .filter((c) => c.status === "accepted" && c.responses[agentId] === "accepted")
    .filter((c) => Math.floor(c.at / 1440) === day)
    .map((c) => slotOf(ctx, c, agentId));
}

/** Reserva el hueco en el plan de hoy (si la cita es hoy y aún no ha pasado). */
export function reserveSlot(ctx: SimContext, agent: Agent, c: Commitment, now: number): void {
  if (Math.floor(c.at / 1440) !== Math.floor(now / 1440) || c.at <= now) return;
  const slot = slotOf(ctx, c, agent.id);
  agent.replan(slot.startMinute, slot, slot.durationMin);
}

/** Quita el hueco de una cita del plan (se le olvidó o se anuló). */
export function releaseSlot(ctx: SimContext, agent: Agent, c: Commitment): void {
  const slot = slotOf(ctx, c, agent.id);
  agent.state.plan = agent.state.plan.filter(
    (p) => !(p.startMinute === slot.startMinute && p.activity === slot.activity),
  );
}

/**
 * Repasar la agenda: al decidir con ella delante, cada cita aceptada refuerza su intención (una
 * vez al día por cita), así que una cita de la que se habla y se piensa se olvida menos.
 */
export async function rehearseAgenda(ctx: SimContext, agent: Agent, now: number): Promise<void> {
  const day = Math.floor(now / 1440);
  for (const c of openMeetingsOf(ctx, agent.id)) {
    const memoryId = c.intentions[agent.id];
    const flag = `rehearsed:${agent.id}:${day}`;
    if (c.status !== "accepted" || !memoryId || c.flags.includes(flag)) continue;
    c.flags.push(flag);
    await agent.rehearseIntention(memoryId, now);
    saveMeeting(ctx, c);
  }
}

/** Algo que le llega a un agente (la percepción hace que lo recuerde y reaccione). */
function tell(ctx: SimContext, agentId: string, text: string): void {
  ctx.rt(agentId).pending.push({ kind: "world", text, placeId: null });
}

/** Hora de salir: cada uno se acuerda (o no) según su memoria y su perfil. */
async function departures(ctx: SimContext, c: Commitment, now: number): Promise<void> {
  for (const p of acceptedOf(c)) {
    if (c.flags.includes(`left:${p}`) || c.forgot.includes(p)) continue;
    const agent = ctx.agents.get(p);
    if (!agent) continue;
    const memoryId = c.intentions[p];
    const remembered = memoryId ? await agent.recallIntentionNow(memoryId, now) : true;
    if (remembered) {
      c.flags.push(`left:${p}`);
      // Lo que estuviera haciendo por su cuenta cede: manda el hueco de la cita en el plan.
      ctx.rt(p).overrideUntil = 0;
      ctx.emit(
        "action",
        p,
        `🕑 ${agent.seed.name} se acuerda de su cita en ${placeName(ctx, c.placeId)}`,
        [p],
        undefined,
        { action: "meeting", ok: true },
      );
      steer(ctx, c, agent);
    } else {
      c.forgot.push(p);
      releaseSlot(ctx, agent, c);
      ctx.emit(
        "memory",
        p,
        `🫥 A ${agent.seed.name} se le olvida la cita con ${c.participants
          .filter((x) => x !== p)
          .map((x) => first(ctx, x))
          .join(" y ")}`,
        [p],
        undefined,
        {
          action: "meeting",
          ok: false,
        },
      );
    }
  }
}

/**
 * Quien se acordó y aún no ha llegado va hacia la cita (si no está de camino ni hablando: una
 * charla puede entretenerle y hacerle llegar tarde).
 */
function steer(ctx: SimContext, c: Commitment, agent: Agent): void {
  const rt = ctx.rt(agent.id);
  if (c.arrivals[agent.id] !== undefined || rt.travelling) return;
  if (agent.state.locationId === c.placeId) return;
  if (agent.state.activityKind === "talk" || agent.state.activityKind === "sleep") return;
  goOrDo(ctx, agent, c.placeId, null, slotOf(ctx, c, agent.id).activity, "idle");
}

/** Quién está ya en el sitio (y si llegó tarde). */
function arrivals(ctx: SimContext, c: Commitment, now: number): void {
  for (const p of acceptedOf(c)) {
    if (c.arrivals[p] !== undefined) continue;
    const agent = ctx.agents.get(p);
    if (!agent || agent.state.locationId !== c.placeId || ctx.rt(p).travelling) continue;
    c.arrivals[p] = now;
    if (now > c.at + LATE_AFTER) {
      const waiting = Object.keys(c.arrivals).filter((x) => x !== p);
      ctx.emit(
        "action",
        p,
        `⏰ ${agent.seed.name} llega tarde a la cita (${Math.round(now - c.at)} min)`,
        [p, ...waiting],
        undefined,
        {
          action: "meeting",
          ok: true,
        },
      );
      for (const w of waiting) {
        void applySocialUpdate(ctx.deps.social, {
          ownerId: w,
          aboutId: p,
          affinityDelta: LATE_AFFINITY,
          now,
          reason: `llegó tarde a la cita en ${placeName(ctx, c.placeId)}`,
          config: ctx.deps.memory.config.social,
        });
      }
    }
  }
}

/** A media espera, quien ya está se da cuenta de que alguien no llega. */
function waiting(ctx: SimContext, c: Commitment): void {
  for (const w of Object.keys(c.arrivals)) {
    if (c.flags.includes(`waited:${w}`)) continue;
    const missing = acceptedOf(c).filter((p) => c.arrivals[p] === undefined);
    if (!missing.length) continue;
    c.flags.push(`waited:${w}`);
    tell(
      ctx,
      w,
      `Estás esperando a ${missing.map((p) => first(ctx, p)).join(" y ")}, que no llega a la cita.`,
    );
  }
}

/** Fin de la espera: cumplida o fallida, con sus efectos en las relaciones y el ánimo. */
async function finish(ctx: SimContext, c: Commitment, now: number): Promise<void> {
  const came = acceptedOf(c).filter((p) => c.arrivals[p] !== undefined);
  const noShow = acceptedOf(c).filter((p) => c.arrivals[p] === undefined);
  c.status = noShow.length === 0 ? "done" : "failed";
  const where = placeName(ctx, c.placeId);
  const config = ctx.deps.memory.config.social;
  if (c.status === "done") {
    ctx.emit(
      "action",
      c.organizerId,
      `🤝 ${came.map((p) => first(ctx, p)).join(" y ")} se ven en ${where}, como quedaron`,
      came,
      undefined,
      {
        action: "meeting",
        ok: true,
      },
    );
    return;
  }
  ctx.emit(
    "memory",
    c.organizerId,
    `💔 Plantón en ${where}: ${noShow.map((p) => first(ctx, p)).join(" y ")} no ${noShow.length > 1 ? "fueron" : "fue"} a la cita${came.length ? ` con ${came.map((p) => first(ctx, p)).join(" y ")}` : ""}`,
    [...came, ...noShow],
    undefined,
    { action: "meeting", ok: false },
  );
  for (const w of came) {
    const agent = ctx.agents.get(w)!;
    for (const p of noShow) {
      const before = await ctx.deps.social.get(w, p);
      const close =
        before?.relationshipType === "family" || before?.relationshipType === "friendship";
      await applySocialUpdate(ctx.deps.social, {
        ownerId: w,
        aboutId: p,
        affinityDelta: close ? NO_SHOW_AFFINITY / 2 : NO_SHOW_AFFINITY,
        trustDelta: NO_SHOW_TRUST,
        now,
        reason: `me dio plantón en la cita de ${where}`,
        config,
      });
      // Con alguien cercano, más preocupación que enfado.
      const m = agent.state.mood;
      agent.state.mood = close
        ? makeMood(m.valence - 0.1, Math.min(1, m.arousal + 0.15))
        : makeMood(m.valence - 0.2, Math.min(1, m.arousal + 0.1));
      tell(
        ctx,
        w,
        close
          ? `${first(ctx, p)} no vino a la cita en ${where}; me preocupa que le haya pasado algo.`
          : `${first(ctx, p)} no vino a la cita en ${where}: me ha dejado plantado.`,
      );
    }
  }
  // Quien no fue se entera (si se acuerda después, cae en la cuenta por la memoria prospectiva).
}

/** Revisión periódica de las citas (la llama la simulación cada pocos minutos de juego). */
export async function meetingsTick(ctx: SimContext, now: number): Promise<void> {
  for (const c of [...ctx.meetings.values()]) {
    if (c.status === "proposed" && now >= c.at) {
      c.status = "cancelled";
      saveMeeting(ctx, c);
      continue;
    }
    if (c.status !== "accepted") {
      // Las cerradas se quedan un día en el runtime (para la agenda) y luego solo en el almacén.
      if (now - c.at > 1440) ctx.meetings.delete(c.id);
      continue;
    }
    const before = JSON.stringify(c);
    if (now >= c.at - MEETING_LEAD) await departures(ctx, c, now);
    if (now >= c.at - MEETING_LEAD) {
      for (const p of acceptedOf(c).filter((x) => c.flags.includes(`left:${x}`))) {
        const agent = ctx.agents.get(p);
        if (agent) steer(ctx, c, agent);
      }
      arrivals(ctx, c, now);
    }
    if (now >= c.at + LATE_AFTER) waiting(ctx, c);
    if (now >= c.at + MEETING_WINDOW) await finish(ctx, c, now);
    if (JSON.stringify(c) !== before) saveMeeting(ctx, c);
  }
}
