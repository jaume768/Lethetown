/**
 * Encuentros por el camino (fase 3.6, sistema `encounters`). Cada `scanEveryMinutes` minutos de
 * juego, sin LLM: quién tiene cerca a quien camina (ande o no), con un índice por celdas. Cada
 * pareja (quien camina → a quien ve) genera como mucho un encuentro por enfriamiento. La
 * saliencia la calcula el código (`encounterSalience`); solo si pasa el umbral, quien camina se
 * para a pensar (`ctx.wake`, sin dejar de andar) con un contexto breve (ver walking.ts). Si no,
 * como mucho un recuerdo de poca importancia. También: los viajes que se dejaron a medias para
 * charlar (se retoman al acabar la charla) y quien se aleja de una charla en el camino (sale de
 * ella). Ver docs/decisiones/cognicion.md.
 */
import {
  encounterSalience,
  SALIENCE_TEXT,
  type Agent,
  type EncounterFactors,
  type SalienceReason,
} from "@lethetown/agent-core";
import {
  CellIndex,
  closestApproach,
  lowerFirst,
  tileAt,
  type ActivityKind,
  type TilePoint,
} from "@lethetown/shared";
import type { SimContext } from "./context";
import { activeConversationOf, leaveConversation } from "./conversations";
import { goalsState } from "./goals";
import { reportIntentions } from "./intention-report";
import { itemsState } from "./items";
import { openMeetingsOf } from "./meetings";
import { mayEnter } from "./norms";
import { awake, inCallRange, tileNow, walkingTogether } from "./presence";
import { occupiedTiles, setAction, travel } from "./routines";
import { stopFollowing } from "./company";

/** Un viaje que se dejó a medias para pararse a charlar (se retoma al acabar la charla). */
export interface Trip {
  destId: string;
  spotId: string | null;
  thenAction: string;
  thenKind: ActivityKind;
  /** Inicio (minuto del día) del bloque del plan al que iba, si iba a uno. */
  planStart: number | null;
  stoppedAt: number;
}

/** Lo que le hace pensar por el camino (lo consume su turno andando, walking.ts). */
export interface WalkCue {
  withId: string;
  /** Cuándo se cruzan (o se cruzaron): puede ser un poco después de ahora (se le ve venir). */
  meetAt: number;
  score: number;
  reasons: SalienceReason[];
  /** Lo que se le vino a la memoria prospectiva al verle («Te acuerdas de que querías…»). */
  reminder: string | null;
  together: boolean;
  at: number;
}

/** Cifras de la cognición en movimiento (totales y por día de juego). */
export const ENCOUNTER_STATS = [
  "encounters",
  "salient",
  "walkDecisions",
  "lateDiscarded",
  "greetings",
  "stops",
  "roadConversations",
  "walkingConversations",
  "firstTalksOnRoad",
  "passedBy",
  "resumed",
  "replanned",
  "leftByDistance",
] as const;
export type EncounterStat = (typeof ENCOUNTER_STATS)[number];

export interface EncountersState {
  /** "a>b" → hasta cuándo no vuelve a contar que a se cruza con b. */
  cooldown: Map<string, number>;
  /** "a|b" → última vez que se vieron (en el mismo sitio o por el camino). */
  lastSeen: Map<string, number>;
  /** Decisiones en camino por agente en la hora de juego en curso. */
  walkTurns: Map<string, { hour: number; n: number }>;
  /** Encuentro que le hace pensar, pendiente de su turno andando. */
  cues: Map<string, WalkCue>;
  /** A quién acaba de ver (o ve venir) y cuándo se cruzan: lo que decida con esa persona vale. */
  sightings: Map<string, { withId: string; meetAt: number }>;
  /** Viajes dejados a medias para charlar. */
  trips: Map<string, Trip>;
  /** Parejas ("a|b") que ya han hablado alguna vez (para «hablaron por primera vez en el camino»). */
  talked: Set<string>;
  /** Saludos al pasar: a quién saludó quién y cuándo (para devolverlo, y no hacer ping-pong). */
  greeted: Map<string, { from: string; at: number }>;
  /** Totales y por día de juego. */
  totals: Record<string, number>;
  byDay: Map<number, Record<string, number>>;
}

export const encountersState = (ctx: SimContext) =>
  ctx.state<EncountersState>("encounters", () => ({
    cooldown: new Map(),
    lastSeen: new Map(),
    walkTurns: new Map(),
    cues: new Map(),
    sightings: new Map(),
    trips: new Map(),
    talked: new Set(),
    greeted: new Map(),
    totals: {},
    byDay: new Map(),
  }));

export const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/** Suma a una cifra (total y del día). */
export function countStat(ctx: SimContext, stat: EncounterStat, n = 1): void {
  const st = encountersState(ctx);
  st.totals[stat] = (st.totals[stat] ?? 0) + n;
  const day = Math.floor(ctx.clock.now() / 1440);
  const today = st.byDay.get(day) ?? {};
  today[stat] = (today[stat] ?? 0) + n;
  st.byDay.set(day, today);
}

/** ¿Le quedan decisiones en camino esta hora? (y, si `use`, gasta una). */
export function walkTurnAvailable(ctx: SimContext, agentId: string, now: number, use = false) {
  const st = encountersState(ctx);
  const hour = Math.floor(now / 60);
  const t = st.walkTurns.get(agentId);
  const n = t && t.hour === hour ? t.n : 0;
  if (n >= ctx.cognition.params.maxWalkDecisionsPerHour) return false;
  if (use) st.walkTurns.set(agentId, { hour, n: n + 1 });
  return true;
}

/** ¿Puede pensar andando ya? (le quedan turnos esta hora y no tiene otro pendiente) */
function walkingTurnFree(ctx: SimContext, agentId: string, now: number): boolean {
  return !encountersState(ctx).cues.has(agentId) && walkTurnAvailable(ctx, agentId, now);
}

/**
 * ¿Se ven (en el instante `at`)? Por el camino, al aire libre; si uno está en un sitio a cubierto
 * (el café, una casa), solo quien esté dentro del mismo sitio (no se ve a través de las paredes).
 */
export function canSee(ctx: SimContext, a: Agent, b: Agent, at = ctx.clock.now()): boolean {
  const pa = ctx.world.placeAt(tileAt(a.state, at));
  const pb = ctx.world.placeAt(tileAt(b.state, at));
  if ((pa?.indoor ?? false) || (pb?.indoor ?? false)) return pa?.id === pb?.id;
  return true;
}

/** Lo que se le ve a alguien desde fuera: a dónde va o qué hace, y su cara si es muy marcada. */
export function visibleOf(ctx: SimContext, other: Agent): string {
  const target = other.state.targetId;
  const doing =
    ctx.rt(other.id).travelling && target && ctx.world.has(target)
      ? `va a ${ctx.world.place(target).name}`
      : `está ${lowerFirst(other.state.action)}`;
  const v = other.state.mood.valence;
  const marked = Math.abs(v) >= ctx.deps.memory.config.encounter.visibleMood;
  const face = marked ? (v < 0 ? "; se le ve con mala cara" : "; se le ve de muy buen humor") : "";
  return `${doing}${face}`;
}

/** Lo que el motor sabe de la otra persona para la saliencia (sin LLM). */
async function factorsOf(
  ctx: SimContext,
  agent: Agent,
  other: Agent,
  now: number,
  extra: { intention: boolean; together: boolean; lastSeen: number | undefined },
): Promise<EncounterFactors> {
  const profile = await ctx.deps.social.get(agent.id, other.id);
  const seedRel = agent.seed.relationships?.find((r) => r.with === other.id);
  const loan = [...itemsState(ctx).items.values()].some(
    (i) =>
      i.loan &&
      ((i.loan.from === agent.id && i.loan.to === other.id) ||
        (i.loan.from === other.id && i.loan.to === agent.id)),
  );
  const goals = goalsState(ctx);
  const conflict = [...goals.conflicts].some((key) => {
    const owners = key.split("|").map((id) => goals.goals.get(id)?.agentId);
    return owners.includes(agent.id) && owners.includes(other.id);
  });
  return {
    affinity: profile?.affinity ?? seedRel?.affinity ?? null,
    familiarity: profile?.familiarity ?? seedRel?.familiarity ?? null,
    family: seedRel?.bond === "family" || profile?.relationshipType === "family",
    rivalry: profile?.relationshipType === "rivalry",
    intention: extra.intention,
    meeting: openMeetingsOf(ctx, agent.id).some((c) => c.participants.includes(other.id)),
    loan,
    goalConflict: conflict,
    otherMood: other.state.mood.valence,
    daysApart: extra.lastSeen === undefined ? null : (now - extra.lastSeen) / 1440,
    together: extra.together,
  };
}

/** Saliencia de `other` para `viewer` ahora (p. ej. al recibir un saludo), sin LLM. */
export async function salienceFor(ctx: SimContext, viewer: Agent, other: Agent, now: number) {
  const last = encountersState(ctx).lastSeen.get(pairKey(viewer.id, other.id));
  return encounterSalience(
    await factorsOf(ctx, viewer, other, now, { intention: false, together: false, lastSeen: last }),
    ctx.deps.memory.config.encounter,
  );
}

/** ¿Lo acaba de ver (o lo ve venir)? Entonces puede saludarle o llamarle aunque aún esté lejos. */
export function sighted(ctx: SimContext, agentId: string, otherId: string, now: number): boolean {
  const s = encountersState(ctx).sightings.get(agentId);
  return Boolean(
    s && s.withId === otherId && s.meetAt >= now - ctx.cognition.params.scanEveryMinutes,
  );
}

/** Un encuentro de quien camina (`agent`) con quien tiene cerca (`other`), que se cruzan en `meetAt`. */
async function encounter(ctx: SimContext, agent: Agent, other: Agent, now: number, meetAt: number) {
  const st = encountersState(ctx);
  const p = ctx.cognition.params;
  const key = `${agent.id}>${other.id}`;
  if ((st.cooldown.get(key) ?? -Infinity) > now) return;
  // En la misma charla, no es un encuentro.
  const conv = activeConversationOf(ctx, agent.id)?.conv;
  if (conv?.members.includes(other.id)) return;
  const together = walkingTogether(ctx, agent, other);
  const pair = pairKey(agent.id, other.id);
  const last = st.lastSeen.get(pair);
  st.lastSeen.set(pair, now);
  st.cooldown.set(key, now + p.pairCooldownMinutes);
  // Van juntos: no es un encuentro, solo la ocasión de hablar andando (`walkingTalk`).
  if (together) {
    if (!conv && walkingTurnFree(ctx, agent.id, now)) {
      st.cues.set(agent.id, {
        withId: other.id,
        meetAt: now,
        score: 1,
        reasons: ["together"],
        reminder: null,
        together: true,
        at: now,
      });
      ctx.wake(agent.id, now);
    }
    return;
  }
  // Se acaban de ver (salían del mismo sitio): no es un encuentro.
  if (last !== undefined && now - last < p.pairCooldownMinutes) return;
  countStat(ctx, "encounters");

  // Memoria prospectiva: ver a esa persona es la pista (con el mecanismo de siempre).
  let reminder: string | null = null;
  const pendingWith = agent.mind.intentions.some(
    (i) => i.personId === other.id && i.status === "pending",
  );
  if (pendingWith) {
    const outcomes = await agent.checkIntentions(now, p.scanEveryMinutes, [other.id]);
    reportIntentions(ctx, agent, outcomes, (o) => {
      if (o.kind !== "kept" || o.intention.personId !== other.id) return false;
      reminder = o.reminder ?? null;
      return true;
    });
  }
  const cfg = ctx.deps.memory.config.encounter;
  const s = encounterSalience(
    await factorsOf(ctx, agent, other, now, {
      intention: reminder !== null,
      together: false,
      lastSeen: last,
    }),
    cfg,
  );
  const seenToday = last !== undefined && Math.floor(last / 1440) === Math.floor(now / 1440);
  const visible = visibleOf(ctx, other);
  const place = ctx.world.publicPlaceNear(tileNow(ctx, agent)).id;
  if (s.salient) countStat(ctx, "salient");
  if (!s.trivial || s.salient) {
    ctx.emit(
      "action",
      agent.id,
      `👀 ${agent.seed.name} se cruza con ${other.seed.name}${s.reasons.length ? ` (${s.reasons.map((r) => SALIENCE_TEXT[r]).join(", ")})` : ""}`,
      [agent.id, other.id],
      undefined,
      {
        action: "encounter",
        ok: true,
        salient: s.salient,
        ...(s.reasons.includes("reunion") ? { reunion: true } : {}),
      },
    );
  }
  // Recuerdo: lo saliente, con algo más de importancia; lo demás, solo la primera vez del día
  // y si no es trivial (para no inflar la memoria con cada vecino que pasa).
  if (s.salient || (!s.trivial && !seenToday)) {
    await agent.deps.memory.tryRemember(
      {
        agentId: agent.id,
        text: `Me crucé con ${other.seed.name} por el camino; ${visible.replace(/^va /, "iba ").replace(/^está /, "estaba ")}.`,
        type: "observation",
        importance: s.salient ? cfg.lowImportance + Math.round(s.score * 4) : cfg.lowImportance,
        emotionalValence: 0,
        people: [other.id],
        placeId: place,
      },
      now,
    );
  }
  if (s.salient && walkingTurnFree(ctx, agent.id, now)) {
    st.sightings.set(agent.id, { withId: other.id, meetAt });
    st.cues.set(agent.id, {
      withId: other.id,
      meetAt,
      score: s.score,
      reasons: s.reasons,
      reminder,
      together,
      at: now,
    });
    ctx.wake(agent.id, now);
  }
}

/** Quién se ve por el camino ahora: posiciones de todos los que están despiertos en el pueblo. */
function positions(ctx: SimContext): { index: CellIndex; live: Agent[] } {
  const index = new CellIndex(ctx.cognition.params.nearRadius);
  const live = [...ctx.agents.values()].filter((a) => awake(ctx, a));
  for (const a of live) index.add(a.id, tileNow(ctx, a));
  return { index, live };
}

/** Los que están en el mismo sitio se han visto (para «hace días que no se ven»). */
function noteSeen(ctx: SimContext, live: Agent[], now: number): void {
  const st = encountersState(ctx);
  const byPlace = new Map<string, string[]>();
  for (const a of live) {
    if (ctx.rt(a.id).travelling) continue;
    byPlace.set(a.state.locationId, [...(byPlace.get(a.state.locationId) ?? []), a.id]);
  }
  for (const ids of byPlace.values()) {
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) st.lastSeen.set(pairKey(ids[i]!, ids[j]!), now);
    }
  }
}

/** En una charla en el camino, quien se aleja más de `callRadius` de todos los demás sale de ella. */
async function leaveByDistance(ctx: SimContext): Promise<void> {
  for (const conv of [...ctx.conversations.values()]) {
    if (!conv.road) continue;
    for (const id of [...conv.members]) {
      const a = ctx.agents.get(id);
      if (!a || !ctx.conversations.has(conv.id)) continue;
      const near = conv.members.some((m) => {
        const b = m !== id ? ctx.agents.get(m) : undefined;
        return b ? inCallRange(ctx, a, b) : false;
      });
      if (near) continue;
      countStat(ctx, "leftByDistance");
      await leaveConversation(ctx, id, `${a.seed.name} se alejó`);
    }
  }
}

/** Minutos del bloque que se mete en el plan si el hueco al que iba ya pasó. */
export const RESUME_MINUTES = 30;

/**
 * Retoma los viajes dejados a medias: al acabar su charla, sigue hacia donde iba (con una ruta
 * nueva). Si el bloque del plan al que iba ya pasó, mete ese rato en el plan (`replan`) antes de
 * ir. Si ya se puso en marcha por su cuenta, el viaje pendiente deja de valer.
 */
export function resumeTrips(ctx: SimContext, now: number): void {
  const st = encountersState(ctx);
  for (const [id, trip] of [...st.trips]) {
    const agent = ctx.agents.get(id);
    const rt = ctx.runtime.get(id);
    // Ya se puso en marcha por su cuenta (o se fue a dormir): el viaje pendiente no vale.
    if (!agent || !rt || !stopped(ctx, id)) {
      st.trips.delete(id);
      continue;
    }
    if (activeConversationOf(ctx, id)) continue;
    st.trips.delete(id);
    if (mayEnter(ctx, agent, trip.destId, now)) {
      rt.travelling = false;
      continue;
    }
    const item = agent.currentPlanItem(now);
    if (trip.planStart !== null && item?.startMinute !== trip.planStart) {
      agent.replan(
        now,
        {
          activity: trip.thenAction,
          activityKind: trip.thenKind,
          placeId: trip.destId,
          spotId: trip.spotId,
        },
        RESUME_MINUTES,
      );
      countStat(ctx, "replanned");
    }
    countStat(ctx, "resumed");
    ctx.emit(
      "action",
      id,
      `🚶 ${agent.seed.name} sigue su camino a ${ctx.world.place(trip.destId).name}`,
      [id],
      undefined,
      { action: "resume_trip", ok: true },
    );
    travel(ctx, agent, trip.destId, trip.spotId, trip.thenAction, trip.thenKind);
  }
}

/**
 * Se para en mitad del camino (para charlar): en su baldosa (o la libre más cercana), en el
 * sitio público más cercano, y guarda a dónde iba para retomarlo. Devuelve si se paró.
 */
export function stopWalking(ctx: SimContext, agent: Agent, now: number): boolean {
  const rt = ctx.rt(agent.id);
  const arrival = rt.arrival;
  if (!rt.travelling || !arrival) return false;
  const here = tileNow(ctx, agent);
  const tile: TilePoint = ctx.world.freeTileNear(here, occupiedTiles(ctx, agent.id));
  const item = agent.currentPlanItem(now);
  encountersState(ctx).trips.set(agent.id, {
    destId: arrival.destId,
    spotId: agent.state.spotId,
    thenAction: arrival.thenAction,
    thenKind: arrival.thenKind,
    planStart: item && item.placeId === arrival.destId ? item.startMinute : null,
    stoppedAt: now,
  });
  stopFollowing(ctx, agent.id, null);
  agent.state.tile = tile;
  agent.state.locationId = ctx.world.publicPlaceNear(tile).id;
  agent.state.targetId = null;
  agent.state.spotId = null;
  agent.state.movement = null;
  // Sigue «de camino» para el resto del pueblo (no está en el sitio más cercano, está en la
  // calle): nadie lo cuenta como presente salvo su charla en el camino, y solo piensa si le
  // hablan. La llegada pendiente deja de valer; al acabar la charla, `resumeTrips`.
  rt.travelling = true;
  rt.arrival = null;
  rt.seenHere.clear();
  return true;
}

/** ¿Está parado en mitad del camino (charlando), con el viaje a medias? */
export function stopped(ctx: SimContext, agentId: string): boolean {
  const rt = ctx.runtime.get(agentId);
  return Boolean(rt?.travelling && !rt.arrival && encountersState(ctx).trips.has(agentId));
}

/** ¿Va andando de verdad? (de camino y moviéndose; quien se paró a charlar, no). */
export function moving(ctx: SimContext, agentId: string): boolean {
  const rt = ctx.runtime.get(agentId);
  return Boolean(rt?.travelling && rt.arrival);
}

/** Si al pararse no llegó a hablar (no debería pasar), al menos que no siga «caminando». */
export function standStill(ctx: SimContext, agent: Agent): void {
  if (agent.state.activityKind === "walk") setAction(ctx, agent, "parado en el camino", "idle");
}

/**
 * Por si acaso: de camino sin llegada ni viaje pendiente (p. ej. al restaurar una instantánea
 * con la cognición apagada), deja de estar de camino. Con todo normal, nunca pasa.
 */
export function unstick(ctx: SimContext, agentId: string): void {
  const rt = ctx.rt(agentId);
  if (rt.travelling && !rt.arrival && !encountersState(ctx).trips.has(agentId)) {
    rt.travelling = false;
  }
}

/**
 * Revisión periódica (cada `scanEveryMinutes`, sin LLM): vistos, charlas en el camino que se
 * deshacen por distancia, viajes que se retoman y encuentros de quien camina.
 */
export async function encountersTick(ctx: SimContext, now: number): Promise<void> {
  const st = encountersState(ctx);
  for (const [k, until] of st.cooldown) if (until <= now) st.cooldown.delete(k);
  for (const [k, g] of st.greeted)
    if (now - g.at > ctx.cognition.params.greetReplyMinutes) st.greeted.delete(k);
  const { index, live } = positions(ctx);
  noteSeen(ctx, live, now);
  await leaveByDistance(ctx);
  resumeTrips(ctx, now);
  const p = ctx.cognition.params;
  for (const [id, x] of st.sightings)
    if (x.meetAt < now - 3 * p.scanEveryMinutes) st.sightings.delete(id);
  // Candidatos: lo que pudieron acercarse desde la revisión anterior y lo que se acercarán en los
  // próximos `decisionLeadMinutes` (sus rutas se conocen); luego, la distancia mínima en esa
  // ventana. Así no se pierde a dos que se cruzan entre revisiones y la respuesta del LLM llega
  // cuando se cruzan (lo que decida antes se hace al cruzarse; ver walking.ts).
  const from = now - p.scanEveryMinutes;
  const to = now + p.decisionLeadMinutes;
  const reach =
    p.nearRadius + 2 * ctx.deps.walkSpeed * (p.scanEveryMinutes + p.decisionLeadMinutes);
  for (const agent of live) {
    if (!ctx.rt(agent.id).travelling) continue;
    const at = index.get(agent.id);
    if (!at) continue;
    for (const n of index.near(at, reach, agent.id)) {
      const other = ctx.agents.get(n.id)!;
      const meet = closestApproach(agent.state, other.state, from, to, 0.25, (t) =>
        canSee(ctx, agent, other, t),
      );
      if (meet.distance > p.nearRadius) continue;
      await encounter(ctx, agent, other, now, Math.max(now, meet.at));
    }
  }
}

/** Anota que una pareja ha hablado (y si era la primera vez y en el camino, lo cuenta). */
export function noteTalk(ctx: SimContext, a: string, b: string, road: boolean): void {
  const st = encountersState(ctx);
  const pair = pairKey(a, b);
  if (st.talked.has(pair)) return;
  st.talked.add(pair);
  if (road) countStat(ctx, "firstTalksOnRoad");
}

/**
 * Pasó de largo ante alguien que le importa (la saliencia le hizo pensar y siguió sin decir
 * nada): cifra y evento (los dramas lo usan si es alguien muy cercano).
 */
export function noteWalkedPast(ctx: SimContext, agent: Agent, cue: WalkCue): void {
  const other = ctx.agents.get(cue.withId);
  if (!other) return;
  countStat(ctx, "passedBy");
  ctx.emit(
    "action",
    agent.id,
    `🚶 ${agent.seed.name} pasa de largo ante ${other.seed.name}`,
    [agent.id, other.id],
    undefined,
    { action: "walk_past", ok: true, score: cue.score },
  );
}
