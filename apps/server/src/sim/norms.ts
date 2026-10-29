/**
 * Normas del mundo. Las casas son privadas: entran quienes viven en ellas, sus invitados (una
 * invitación aceptada o una cita allí con quien vive) y quien acompaña a alguien de la casa.
 * Los lugares con horario cierran: fuera de hora solo entra quien trabaja allí. Las acciones
 * comprueban estas normas antes de ir; la revisión periódica (`normsTick`) abre y cierra los
 * lugares, saca a quien se queda dentro al cerrar, detecta intrusos y, por la protección de
 * menores, no deja a un menor en una casa ajena con adultos.
 */
import { applySocialUpdate, formatClock, type Agent } from "@lethetown/agent-core";
import { isOpen, seedIsMinor, type Place } from "@lethetown/shared";
import type { SimContext } from "./context";
import { minorMeetingRule } from "./actions/meetings";
import { travel } from "./routines";

/** Minutos que dura el permiso de invitado tras aceptar una invitación. */
export const GUEST_MINUTES = 180;
/** Afinidad y confianza que pierde quien vive en la casa hacia un intruso. */
const INTRUDER_AFFINITY = -0.1;
const INTRUDER_TRUST = -0.05;

const nameOf = (ctx: SimContext, id: string) => ctx.agents.get(id)?.seed.name ?? id;

/** Quienes viven en una casa. */
export function residentsOf(ctx: SimContext, placeId: string): Agent[] {
  return [...ctx.agents.values()].filter((a) => a.seed.homeId === placeId);
}

/** Da permiso de invitado en una casa hasta un minuto de juego. */
export function grantGuest(ctx: SimContext, placeId: string, agentId: string, until: number) {
  const guests = ctx.guests.get(placeId) ?? new Map<string, number>();
  guests.set(agentId, Math.max(guests.get(agentId) ?? 0, until));
  ctx.guests.set(placeId, guests);
}

/** ¿Puede estar en ese lugar privado? (vive allí, está invitado o acompaña a alguien de allí). */
function welcome(ctx: SimContext, agent: Agent, place: Place, now: number): boolean {
  if (!place.private || agent.seed.homeId === place.id) return true;
  if ((ctx.guests.get(place.id)?.get(agent.id) ?? -1) > now) return true;
  const f = ctx.rt(agent.id).following;
  return Boolean(f && ctx.agents.get(f.who)?.seed.homeId === place.id);
}

/** "abre de 07:00 a 22:00". */
const hoursText = (p: Place) =>
  p.hours ? `abre de ${formatClock(p.hours.opens)} a ${formatClock(p.hours.closes)}` : "";

/**
 * ¿Puede ir a ese lugar a esa hora? Devuelve el motivo si no (casa ajena sin invitación, o
 * cerrado y no trabaja allí).
 */
export function mayEnter(
  ctx: SimContext,
  agent: Agent,
  placeId: string,
  at: number,
): string | null {
  const place = ctx.world.places.find((p) => p.id === placeId);
  if (!place) return null;
  if (!welcome(ctx, agent, place, at)) {
    const owners = residentsOf(ctx, place.id).map((a) => a.seed.name.split(" ")[0]);
    return `${place.name} es la casa de ${owners.join(" y ") || "otra gente"} y nadie me ha invitado`;
  }
  if (!isOpen(place, at) && agent.seed.workId !== place.id) {
    return `${place.name} está cerrado a esa hora (${hoursText(place)})`;
  }
  return null;
}

/** Saca a alguien de un sitio: a su casa (o a la plaza si es su casa la que le echa). */
function sendAway(ctx: SimContext, agent: Agent, why: string): void {
  const dest = agent.state.locationId === agent.seed.homeId ? "plaza" : agent.seed.homeId;
  ctx.rt(agent.id).pending.push({ kind: "world", text: why, placeId: null });
  ctx.rt(agent.id).overrideUntil = ctx.clock.now() + 30;
  travel(ctx, agent, dest, null, "tiempo libre", "idle");
}

/** Revisión periódica de las normas (sin LLM). */
export async function normsTick(ctx: SimContext, now: number): Promise<void> {
  // Permisos de invitado caducados.
  for (const [placeId, guests] of ctx.guests) {
    for (const [id, until] of guests) if (until <= now) guests.delete(id);
    if (!guests.size) ctx.guests.delete(placeId);
  }
  for (const place of ctx.world.places) {
    // Abrir y cerrar.
    if (place.hours) {
      const open = isOpen(place, now);
      const was = ctx.openPlaces.get(place.id);
      ctx.openPlaces.set(place.id, open);
      if (was !== undefined && was !== open) {
        const staff = [...ctx.agents.values()].find(
          (a) => a.seed.workId === place.id && a.state.locationId === place.id,
        );
        const who = staff
          ? `${staff.seed.name} ${open ? "abre" : "cierra"}`
          : open
            ? "Abre"
            : "Cierra";
        ctx.emit(
          "world",
          staff?.id ?? null,
          `${open ? "🔓" : "🔒"} ${who} ${place.name}`,
          [],
          undefined,
          {
            action: open ? "open_place" : "close_place",
            ok: true,
          },
        );
      }
    }
    const inside = [...ctx.agents.values()].filter(
      (a) =>
        a.state.locationId === place.id &&
        !ctx.rt(a.id).travelling &&
        a.state.activityKind !== "sleep",
    );
    if (!inside.length) continue;
    // Al cerrar, fuera quien no trabaja allí.
    if (!isOpen(place, now)) {
      for (const a of inside.filter((x) => x.seed.workId !== place.id)) {
        sendAway(ctx, a, `${place.name} cierra (${hoursText(place)}): me tengo que ir.`);
      }
      continue;
    }
    if (!place.private) continue;
    // Intrusos: en una casa sin permiso. Si alguien de la casa le ve, le sienta mal.
    const residents = inside.filter((a) => a.seed.homeId === place.id);
    for (const a of inside.filter((x) => !welcome(ctx, x, place, now))) {
      if (residents.length) {
        for (const r of residents) {
          ctx.rt(r.id).pending.push({
            kind: "world",
            text: `${a.seed.name} se ha metido en casa sin que nadie le invitara.`,
            placeId: place.id,
          });
          await applySocialUpdate(ctx.deps.social, {
            ownerId: r.id,
            aboutId: a.id,
            affinityDelta: INTRUDER_AFFINITY,
            trustDelta: INTRUDER_TRUST,
            now,
            reason: "se metió en mi casa sin permiso",
            config: ctx.deps.memory.config.social,
          });
        }
        ctx.emit(
          "action",
          a.id,
          `🚪 ${a.seed.name} se mete en ${place.name} sin permiso (y ${residents.map((r) => r.seed.name.split(" ")[0]).join(" y ")} ${residents.length > 1 ? "lo ven" : "lo ve"})`,
          [a.id, ...residents.map((r) => r.id)],
          undefined,
          { action: "intruder", ok: false },
        );
      }
      sendAway(ctx, a, `No debería estar en ${place.name}: no es mi casa y nadie me ha invitado.`);
    }
    // Protección de menores: un menor no se queda en una casa ajena con adultos.
    const present = inside.filter(
      (a) => a.state.locationId === place.id && !ctx.rt(a.id).travelling,
    );
    if (
      minorMeetingRule(
        ctx,
        present.map((a) => a.id),
        place.id,
      )
    ) {
      for (const m of present.filter((a) => seedIsMinor(a.seed) && a.seed.homeId !== place.id)) {
        sendAway(
          ctx,
          m,
          `Me voy a casa: no me quedo en casa de ${nameOf(ctx, residentsOf(ctx, place.id)[0]?.id ?? "")} sin mi familia.`,
        );
      }
    }
  }
}
