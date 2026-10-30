import {
  Agent,
  defaultKnownPlaces,
  minorsOf,
  type Decision,
  type MemoryEffect,
} from "@lethetown/agent-core";
import type {
  AgentState,
  Chronicle,
  Drama,
  Item,
  Note,
  SimEvent,
  Weather,
  WorldRunStatus,
} from "@lethetown/shared";
import { exposedTo } from "@lethetown/shared";
import type { GameClock } from "./clock";
import {
  SimContext,
  errorMessage,
  newRuntime,
  type SimSignal,
  type SimulationDeps,
} from "./context";
import { activeConversationOf, endIdleConversations, leaveConversation } from "./conversations";
import { startDemo } from "./demo";
import * as intervention from "./intervention";
import { WEATHER_NOW } from "./intervention";
import { consolidate, maintain, scheduleChronicle, writeChronicle } from "./memory-routines";
import { availableActions, failAction, runAction } from "./actions";
import { agendaLines, fixedPlanFor, meetingsTick, rehearseAgenda } from "./meetings";
import { gatherPerceptions, presentWith } from "./perception";
import { syncKnownPlaces } from "./places";
import { inventorySections, itemsTick, loadItems } from "./items";
import { objectsTick } from "./actions/objects";
import { companySections, companyTick, stopFollowing } from "./company";
import { loadNotes, notesTick } from "./notes";
import { mayEnter, normsTick } from "./norms";
import { goOrDo, scheduleArrival, setAction, travel } from "./routines";
import { SIM_SNAPSHOT_VERSION, type SimSnapshot } from "./snapshot";
import type { WorldMap } from "./world";

export type { SimSignal, SimulationDeps } from "./context";

const SPEECH_BUBBLE_MINUTES = 20;
/** Cada cuántos minutos de juego se revisan las citas. */
const MEETINGS_EVERY = 5;

/**
 * Orquesta la simulación de un mundo: el bucle de cada agente (percibir → guardar → decidir →
 * actuar), instantáneas y API pública. El detalle vive en módulos que comparten `SimContext`:
 * percepción, conversaciones, rutinas sin LLM, memoria (mantenimiento, consolidación, crónica)
 * e intervención del jugador.
 */
export class Simulation {
  private readonly ctx: SimContext;
  /** Llamadas al LLM en curso por agente (para el snapshot). */
  private readonly thinking = new Map<string, number>();
  private restored = false;
  private readonly tickListeners: (() => void)[] = [];
  /** Nivel de detalle: los agentes piensan cada tickMinutes × tickMultiplier (LOD sin público). */
  private tickMultiplier = 1;
  /**
   * Un único tick pendiente por agente: cuándo toca y su generación (un tick programado con otra
   * generación ya no vale; así se adelanta sin duplicar). `busy`: el tick está en curso y, si
   * piden adelantarlo, `wakeAt` dice cuándo debe ser el siguiente.
   */
  private readonly ticks = new Map<
    string,
    { at: number; gen: number; busy: boolean; wakeAt: number | null }
  >();

  constructor(deps: SimulationDeps) {
    const ctx = new SimContext(deps);
    this.ctx = ctx;
    const names = Object.fromEntries(deps.seeds.map((s) => [s.id, s.name]));
    const minors = minorsOf(deps.seeds);
    // Chismosos: lo que cuentan se cree un poco menos (credibilidad de los rumores).
    const gossips = new Set(
      deps.seeds.filter((s) => s.traits.some((t) => /chism|cotill/i.test(t))).map((s) => s.id),
    );
    for (const raw of deps.seeds) {
      // Sin lista en la semilla: lo de quien vive aquí de siempre.
      const seed = {
        ...raw,
        knownPlaces: raw.knownPlaces ?? defaultKnownPlaces(raw, deps.seeds, deps.world.places),
      };
      const agent = new Agent(seed, {
        llm: deps.llm,
        memory: deps.memory,
        places: deps.world.places,
        social: deps.social,
        names,
        minors,
        gossips,
        language: deps.language,
        onError: (agentId, task, error) =>
          ctx.emit("system", agentId, `⚠ Error en "${task}": ${errorMessage(error)}`),
      });
      ctx.agents.set(seed.id, agent);
      ctx.runtime.set(seed.id, newRuntime());
    }
    deps.llm.onCall((e) => {
      if (!e.agentId) return;
      const n = (this.thinking.get(e.agentId) ?? 0) + (e.phase === "start" ? 1 : -1);
      this.thinking.set(e.agentId, Math.max(0, n));
      ctx.signal({ type: "thinking", agentId: e.agentId, task: e.task, phase: e.phase });
    });
    deps.memory.onEffect((e: MemoryEffect) => ctx.signal({ type: "memory_effect", ...e }));
    ctx.wake = (agentId, at) => this.wake(agentId, at);
  }

  get agents(): Map<string, Agent> {
    return this.ctx.agents;
  }

  get clock(): GameClock {
    return this.ctx.clock;
  }

  get world(): WorldMap {
    return this.ctx.world;
  }

  /** Siembra los recuerdos iniciales de los agentes que aún no tienen ninguno. */
  async seedMemoriesIfEmpty(now: number): Promise<number> {
    let seeded = 0;
    for (const agent of this.agents.values()) {
      const existing = await this.ctx.deps.memory.store.listByAgent(agent.id);
      if (!existing.length) {
        await agent.seedMemories(now);
        seeded++;
      }
      // Relaciones de partida (si aún no piensa nada de nadie).
      if (!(await this.ctx.deps.social.list(agent.id)).length) await agent.seedRelationships(now);
    }
    return seeded;
  }

  /**
   * Programa el primer tick de cada agente (escalonados), las llegadas pendientes (si se
   * restauró una instantánea) y la crónica diaria.
   */
  start(): void {
    const now = this.clock.now();
    [...this.agents.values()].forEach((agent, i) => {
      const rt = this.ctx.rt(agent.id);
      if (!this.restored) rt.lastConsolidation = now;
      if (rt.arrival) scheduleArrival(this.ctx, agent, rt.arrival);
      this.scheduleTick(agent, now + i);
    });
    scheduleChronicle(this.ctx, now);
    this.scheduleMeetings(now);
    if (this.ctx.deps.demoEveryMinutes) startDemo(this.ctx, this.ctx.deps.demoEveryMinutes);
    this.ctx.emit("system", null, `Simulación iniciada con ${this.agents.size} agentes`);
  }

  /** Revisión de las citas cada pocos minutos de juego (quién sale, quién llega, plantones). */
  private scheduleMeetings(from: number): void {
    const next = (Math.floor(from / MEETINGS_EVERY) + 1) * MEETINGS_EVERY;
    this.clock.schedule(next, async () => {
      await meetingsTick(this.ctx, next);
      await itemsTick(this.ctx, next);
      objectsTick(this.ctx, next);
      companyTick(this.ctx, next);
      notesTick(this.ctx, next);
      await normsTick(this.ctx, next);
      this.scheduleMeetings(next);
    });
  }

  /** Guarda lo que conoce cada agente (al arrancar). */
  syncKnownPlaces(): Promise<void> {
    return syncKnownPlaces(this.ctx);
  }

  /** Objetos al arrancar (si no vienen de la instantánea): los guardados o los de las semillas. */
  loadItems(stored: Item[]): void {
    loadItems(this.ctx, stored, this.clock.now());
  }

  /** Notas al arrancar (si no vienen de la instantánea). */
  loadNotes(stored: Note[]): void {
    loadNotes(this.ctx, stored);
  }

  /** Primer id libre de cita (si no se restauró una instantánea, los guardados mandan). */
  setMeetingSeq(seq: number): void {
    this.ctx.meetingSeq = Math.max(this.ctx.meetingSeq, seq);
  }

  onEvent(listener: (e: SimEvent) => void): () => void {
    return this.ctx.onEvent(listener);
  }

  onSignal(listener: (s: SimSignal) => void): () => void {
    return this.ctx.onSignal(listener);
  }

  /** LOD: con multiplicador > 1 los agentes piensan con menos frecuencia (menos llamadas al LLM). */
  setTickMultiplier(n: number): void {
    this.tickMultiplier = Math.max(1, n);
  }

  get tickMinutes(): number {
    return this.ctx.deps.tickMinutes * this.tickMultiplier;
  }

  /** Cada tick de agente ejecutado (para métricas de ticks/s). */
  onTick(listener: () => void): void {
    this.tickListeners.push(listener);
  }

  // --- Instantáneas ----------------------------------------------------------------------

  /** Estado serializable (JSON) del runtime de agentes, conversaciones, objetos, clima y reloj. */
  snapshot(): SimSnapshot {
    const world = this.ctx.world;
    return {
      version: SIM_SNAPSHOT_VERSION,
      time: this.clock.now(),
      speed: this.clock.speed,
      weather: world.weather,
      spots: world.places.flatMap((p) => p.objects.map((o) => ({ id: o.id, state: o.state }))),
      agents: [...this.agents.values()].map((a) => {
        const rt = this.ctx.rt(a.id);
        return {
          id: a.id,
          state: structuredClone(a.state),
          mind: structuredClone(a.mind),
          workingMemory: structuredClone([...a.workingMemory.contents]),
          runtime: {
            ...structuredClone({ ...rt, seenHere: [], knownStates: [] }),
            seenHere: [...rt.seenHere],
            knownStates: [...rt.knownStates],
            utteredAt: finiteOrNull(rt.utteredAt),
            lastMaintenance: finiteOrNull(rt.lastMaintenance),
          },
        };
      }),
      conversations: [...this.ctx.conversations.values()].map((c) => structuredClone(c)),
      meetings: structuredClone([...this.ctx.meetings.values()]),
      meetingSeq: this.ctx.meetingSeq,
      items: structuredClone([...this.ctx.items.values()]),
      itemSeq: this.ctx.itemSeq,
      invitations: structuredClone([...this.ctx.invitations.values()]),
      invitationSeq: this.ctx.invitationSeq,
      notes: structuredClone([...this.ctx.notes.values()]),
      noteSeq: this.ctx.noteSeq,
      guests: Object.fromEntries(
        [...this.ctx.guests].map(([placeId, g]) => [placeId, Object.fromEntries(g)]),
      ),
      objectTimers: Object.fromEntries(structuredClone([...this.ctx.objectTimers])),
    };
  }

  /** Restaura una instantánea antes de `start()`. El reloj ya debe estar en `snapshot.time`. */
  restore(s: SimSnapshot): void {
    const world = this.ctx.world;
    for (const spot of s.spots) {
      if (world.spot(spot.id)) world.setSpotState(spot.id, spot.state);
    }
    world.weather = s.weather;
    for (const saved of s.agents) {
      const agent = this.agents.get(saved.id);
      if (!agent) continue;
      agent.state = saved.state;
      agent.mind = saved.mind;
      agent.workingMemory.replace(saved.workingMemory);
      const r = saved.runtime;
      this.ctx.runtime.set(saved.id, {
        ...r,
        seenHere: new Set(r.seenHere),
        knownStates: new Map(r.knownStates),
        utteredAt: r.utteredAt ?? -Infinity,
        lastMaintenance: r.lastMaintenance ?? -Infinity,
      });
    }
    this.ctx.conversations.clear();
    for (const c of s.conversations) {
      const members = c.members.filter((m) => this.agents.has(m));
      if (members.length >= 2) this.ctx.conversations.set(c.id, { ...c, members });
    }
    this.ctx.meetings.clear();
    for (const m of s.meetings) this.ctx.meetings.set(m.id, m);
    this.ctx.meetingSeq = s.meetingSeq;
    this.ctx.items.clear();
    for (const i of s.items) this.ctx.items.set(i.id, i);
    this.ctx.itemSeq = s.itemSeq;
    this.ctx.invitations.clear();
    for (const v of s.invitations) this.ctx.invitations.set(v.id, v);
    this.ctx.invitationSeq = s.invitationSeq;
    this.ctx.notes.clear();
    for (const n of s.notes) this.ctx.notes.set(n.id, n);
    this.ctx.noteSeq = s.noteSeq;
    this.ctx.guests.clear();
    for (const [placeId, g] of Object.entries(s.guests)) {
      this.ctx.guests.set(placeId, new Map(Object.entries(g)));
    }
    this.ctx.objectTimers.clear();
    for (const [id, t] of Object.entries(s.objectTimers)) this.ctx.objectTimers.set(id, t);
    this.restored = true;
  }

  thinkingAgents(): string[] {
    return [...this.thinking.entries()].filter(([, n]) => n > 0).map(([id]) => id);
  }

  agentStates(): AgentState[] {
    const now = this.clock.now();
    return [...this.agents.values()].map((a) => {
      const rt = this.ctx.rt(a.id);
      return {
        ...a.state,
        tile: { ...a.state.tile },
        plan: [...a.state.plan],
        movement: a.state.movement && {
          ...a.state.movement,
          waypoints: [...a.state.movement.waypoints],
        },
        lastUtterance: now - rt.utteredAt <= SPEECH_BUBBLE_MINUTES ? a.state.lastUtterance : null,
      };
    });
  }

  // --- Intervención y avisos ----------------------------------------------------------------

  notifyStatus(status: WorldRunStatus): void {
    intervention.notifyStatus(this.ctx, status);
  }

  /** Publica un drama (rumor, discusión…) a los clientes. */
  notifyDrama(drama: Drama): void {
    this.ctx.signal({ type: "drama", drama });
  }

  injectThought(agentId: string, text: string): void {
    intervention.injectThought(this.ctx, agentId, text);
  }

  setSpotState(spotId: string, state: string): void {
    intervention.setSpotState(this.ctx, spotId, state);
  }

  setWeather(weather: Weather): void {
    intervention.setWeather(this.ctx, weather);
  }

  writeChronicle(day: number): Promise<Chronicle | null> {
    return writeChronicle(this.ctx, day);
  }

  // --- Bucle del agente --------------------------------------------------------------

  /** Programa el (único) siguiente tick del agente; el que hubiera pendiente deja de valer. */
  private scheduleTick(agent: Agent, at: number): void {
    const t = this.ticks.get(agent.id) ?? { at, gen: 0, busy: false, wakeAt: null };
    t.at = at;
    t.gen++;
    this.ticks.set(agent.id, t);
    const gen = t.gen;
    this.clock.schedule(at, () => (t.gen === gen ? this.agentTick(agent) : undefined));
  }

  /**
   * Turno reactivo: que el agente piense como tarde en `at` (le han hablado). Si su tick ya
   * tocaba antes, nada; si está pensando ahora, el siguiente será a esa hora.
   */
  private wake(agentId: string, at: number): void {
    const agent = this.agents.get(agentId);
    const t = this.ticks.get(agentId);
    if (!agent || !t) return;
    if (t.busy) {
      t.wakeAt = Math.min(t.wakeAt ?? Infinity, at);
      return;
    }
    if (t.at > at) this.scheduleTick(agent, at);
  }

  private async agentTick(agent: Agent): Promise<void> {
    for (const l of this.tickListeners) l();
    const t = this.ticks.get(agent.id)!;
    t.busy = true;
    try {
      await this.step(agent);
    } catch (error) {
      this.ctx.emit("system", agent.id, `⚠ Error en el tick: ${errorMessage(error)}`);
    } finally {
      t.busy = false;
      const now = this.clock.now();
      const next = now + this.tickMinutes;
      const woken = t.wakeAt;
      t.wakeAt = null;
      this.scheduleTick(agent, woken === null ? next : Math.min(next, Math.max(now, woken)));
    }
  }

  private async step(agent: Agent): Promise<void> {
    const ctx = this.ctx;
    const rt = ctx.rt(agent.id);
    if (rt.travelling) return;
    const now = this.clock.now();
    // Necesidades y ánimo (solo: un introvertido recarga pilas en algo tranquilo).
    const around = presentWith(ctx, agent).map((p) => p.id);
    agent.live(this.tickMinutes, around.length === 0);
    endIdleConversations(ctx, now);
    await maintain(ctx, agent, now);

    // Rutina trivial sin LLM: dormir en su cama (y consolidar al dormirse).
    if (agent.isSleepTime(now)) {
      rt.seenHere.clear();
      rt.inbox = [];
      rt.pending = rt.pending.filter((p) => p.kind === "thought");
      const bed = agent.bedSpot();
      const inBed = bed
        ? agent.state.spotId === bed.id
        : agent.state.locationId === agent.seed.homeId;
      if (!inBed)
        return travel(ctx, agent, agent.seed.homeId, bed?.id ?? null, "durmiendo", "sleep");
      setAction(ctx, agent, "durmiendo", "sleep");
      await consolidate(ctx, agent, now);
      return;
    }

    // Mera exposición: el tiempo que pasa en el mismo sitio que otros acerca un poco.
    agent.noteCompany(around, this.tickMinutes);
    const day = Math.floor(now / 1440);
    if (rt.plannedDay !== day) {
      rt.plannedDay = day;
      const debt = agent.wakeUp();
      if (debt > 0.2) {
        ctx.emit(
          "action",
          agent.id,
          `😴 ${agent.seed.name} ha dormido mal (energía ${agent.state.needs.energy.toFixed(2)})`,
          [agent.id],
        );
      }
      setAction(ctx, agent, "pensando en el día", "idle");
      const plan = await agent.planDay(now, ctx.world.weather, fixedPlanFor(ctx, agent.id, day));
      ctx.emit("plan", agent.id, `Plan: ${plan.map((p) => p.activity).join(" → ")}`, [agent.id]);
    }

    warnOutdoorPlan(ctx, agent, now);
    warnConversationPlan(ctx, agent, now);
    // Un recuerdo malo que vuelve sin querer (más con el ánimo bajo o si algo se lo recuerda).
    const intrusive = await agent.ruminate(now, this.tickMinutes, around);
    // Memoria prospectiva: lo que tenía pensado hacer, si aparece la pista.
    for (const o of await agent.checkIntentions(now, this.tickMinutes, around)) {
      const who = o.intention.personId ? ctx.agents.get(o.intention.personId)?.seed.name : null;
      const name = agent.seed.name;
      if (o.kind === "kept") {
        rt.pending.push({ kind: "world", text: o.reminder!, placeId: null });
        ctx.emit("memory", agent.id, `✅ ${name} se acuerda de ${o.intention.text}`, [agent.id]);
      } else if (o.kind === "missed") {
        ctx.emit(
          "memory",
          agent.id,
          `🫥 A ${name} se le pasa ${o.intention.text}${who ? ` (y eso que estaba con ${who})` : ""}`,
          [agent.id],
        );
      } else if (o.kind === "late") {
        ctx.emit("memory", agent.id, `😳 ¡Vaya! A ${name} se le olvidó ${o.intention.text}`, [
          agent.id,
        ]);
      }
    }
    if (intrusive) {
      ctx.emit(
        "memory",
        agent.id,
        `🌩 A ${agent.seed.name} le viene a la cabeza, sin querer: «${intrusive}»`,
        [agent.id],
      );
    }
    // Percibir.
    const { present, heard, place, perceptions } = gatherPerceptions(ctx, agent);
    const innerVoice = perceptions.flatMap((p) => (p.kind === "thought" ? [p.text] : []));
    // Guardar.
    await agent.perceive(perceptions, this.clock.now());
    // Al pararse a pensar, repasa su agenda (las citas que tiene presentes se olvidan menos).
    if (perceptions.length) await rehearseAgenda(ctx, agent, this.clock.now());
    // Decidir.
    // Quien le habla a él o ella (en un grupo, lo que se dice a otros no pide respuesta).
    const speaker = heard.find((h) => !h.toName)?.fromId ?? null;
    const decision = await agent.decide(this.clock.now(), {
      present,
      heard,
      conversationWith: speaker ?? activeConversationOf(ctx, agent.id)?.other ?? null,
      objectStates: place.objects
        .filter((o) => o.state !== "idle")
        .map((o) => ({ id: o.id, state: o.state })),
      weather: ctx.world.weather,
      socialNotes: await agent.socialNotes(present.map((p) => p.id)),
      innerVoice,
      salient: perceptions.length > 0,
      actions: availableActions({ ctx, agent, now: this.clock.now() }),
      agenda: agendaLines(ctx, agent.id, this.clock.now()),
      sections: [...companySections(ctx, agent), ...inventorySections(ctx, agent)],
    });
    if (decision.reason) {
      agent.state.reasoning = {
        text: decision.reason,
        at: this.clock.now(),
        innerVoice: innerVoice.length > 0,
      };
    }
    if (innerVoice.length) reportInnerVoice(ctx, agent, decision);
    // Fin de conversación natural: le hablaron y decidió no contestar a nadie (se marcha).
    const answered = decision.kind === "act" && decision.action.type === "say";
    if (speaker && !answered) {
      await leaveConversation(ctx, agent.id, "decidió no seguir");
    }
    await this.apply(agent, decision);
  }

  /** Actuar: seguir el plan o una acción del catálogo (que el motor comprueba y ejecuta). */
  private async apply(agent: Agent, decision: Decision): Promise<void> {
    const ctx = this.ctx;
    const rt = ctx.rt(agent.id);
    const now = this.clock.now();
    const c = { ctx, agent, now };
    switch (decision.kind) {
      case "follow_plan": {
        if (now < rt.overrideUntil) return;
        const item = agent.currentPlanItem(now);
        if (!item) return setAction(ctx, agent, "tiempo libre", "idle");
        // Las normas: una casa ajena sin invitación o un sitio cerrado no entran en el plan.
        const barred =
          item.placeId !== agent.state.locationId && mayEnter(ctx, agent, item.placeId, now);
        if (barred) {
          const key = `${item.startMinute}:${item.placeId}`;
          if (rt.normWarned !== key) {
            rt.normWarned = key;
            rt.pending.push({ kind: "world", text: `No puedo ir: ${barred}.`, placeId: null });
          }
          return setAction(ctx, agent, "tiempo libre", "idle");
        }
        // Si se va a otro sitio a media conversación, la conversación se cierra (no queda colgada).
        const conv = activeConversationOf(ctx, agent.id);
        if (conv && item.placeId !== agent.state.locationId) {
          const place = ctx.world.place(item.placeId).name;
          void leaveConversation(ctx, agent.id, `${agent.seed.name} se fue a ${place}`);
        }
        return goOrDo(ctx, agent, item.placeId, item.spotId, item.activity, item.activityKind);
      }
      case "act":
        // Irse por su cuenta deja de acompañar a quien acompañaba.
        if (["do_activity", "explore", "invite"].includes(decision.action.type)) {
          stopFollowing(ctx, agent.id, null);
        }
        await runAction(c, decision.action);
        return;
      case "invalid":
        return failAction(c, "hacer eso", decision.error, "invalid");
    }
  }
}

/** Respuesta a la voz interior en el log: si le hace caso o no, y por qué. */
function reportInnerVoice(ctx: SimContext, agent: Agent, decision: Decision): void {
  const a = decision.kind === "act" ? decision.action : null;
  const outcome =
    a?.type === "do_activity"
      ? `le hace caso: ${a.activity}`
      : a?.type === "say"
        ? `se lo comenta a ${ctx.agents.get(a.to)?.seed.name ?? a.to}`
        : a
          ? "le hace caso"
          : "no le hace caso";
  const why = decision.reason ? ` — «${decision.reason}»` : "";
  ctx.emit("action", agent.id, `💭 ${agent.seed.name} ${outcome}${why}`, [agent.id]);
}

/**
 * Si está conversando y su plan dice que toca irse a otro sitio, se le avisa una vez por bloque
 * del plan: así decide (con el LLM y según sus necesidades) si se despide, se queda un rato más
 * (y cambia el plan) o se va ya, en vez de dejar la conversación a medias sin más.
 */
function warnConversationPlan(ctx: SimContext, agent: Agent, now: number): void {
  const conv = activeConversationOf(ctx, agent.id);
  if (!conv) return;
  const item = agent.currentPlanItem(now);
  if (!item || item.placeId === agent.state.locationId) return;
  const rt = ctx.rt(agent.id);
  const key = `${item.startMinute}:${conv.conv.id}`;
  if (rt.convWarned === key) return;
  rt.convWarned = key;
  const other = conv.others.map((id) => ctx.agents.get(id)?.seed.name ?? id).join(", ");
  rt.pending.push({
    kind: "world",
    text: `Según tu plan ahora toca ${item.activity} en ${ctx.world.place(item.placeId).name}, pero estás hablando con ${other}.`,
    placeId: null,
  });
}

/**
 * Con mal tiempo, si lo que toca en su plan es al aire libre (y no a cubierto), se le avisa
 * una vez por hora de juego: así decide (con el LLM) si va igualmente, se queda o cambia de sitio.
 */
function warnOutdoorPlan(ctx: SimContext, agent: Agent, now: number): void {
  const weather = ctx.world.weather;
  const say = WEATHER_NOW[weather];
  const rt = ctx.rt(agent.id);
  if (!say || now < rt.overrideUntil) return;
  const item = agent.currentPlanItem(now);
  if (!item) return;
  const dest = ctx.world.place(item.placeId);
  const spot = item.spotId ? ctx.world.spot(item.spotId) : undefined;
  if (!exposedTo(weather, dest.indoor, spot?.shelter ?? false)) return;
  const key = `${Math.floor(now / 60)}:${weather}`;
  if (rt.weatherChecked === key) return;
  rt.weatherChecked = key;
  rt.pending.push({
    kind: "world",
    text: `${say} y lo que tenías previsto (${item.activity}) es al aire libre, en ${dest.name}.`,
    placeId: null,
  });
}

function finiteOrNull(x: number): number | null {
  return Number.isFinite(x) ? x : null;
}
