import { randomUUID } from "node:crypto";
import {
  Agent,
  inferActivityKind,
  updateSocialAfterConversation,
  writeChronicle,
  type Consolidator,
  type Decision,
  type LLMClient,
  type MemoryEffect,
  type MemoryMaintenance,
  type MemorySystem,
  type Perception,
  type Rng,
  type SocialProfileStore,
  untrusted,
} from "@lethetown/agent-core";
import {
  facingOf,
  pathLength,
  type ActivityKind,
  type AgentSeed,
  type AgentState,
  type Chronicle,
  type ServerMessage,
  type SimEvent,
  type SimEventKind,
  type TilePoint,
  type Weather,
  type WorldRunStatus,
} from "@lethetown/shared";
import type { ChronicleStore, EventStore } from "../db/stores";
import type { GameClock } from "./clock";
import { SIM_SNAPSHOT_VERSION, type SimSnapshot } from "./snapshot";
import { tileKey, type WorldMap } from "./world";

interface Heard {
  fromId: string;
  fromName: string;
  text: string;
  eventId: string;
}

/** Llegada pendiente de un viaje (se reprograma al restaurar una instantánea). */
interface Arrival {
  destId: string;
  goal: TilePoint;
  thenAction: string;
  thenKind: ActivityKind;
  at: number;
}

interface Runtime {
  travelling: boolean;
  arrival: Arrival | null;
  plannedDay: number;
  /** Quién estaba en el mismo lugar en el último tick (para detectar llegadas). */
  seenHere: Set<string>;
  /** Frases dirigidas a este agente. */
  inbox: Heard[];
  /** Otras percepciones pendientes (oído a escondidas, voz interior, cambios del mundo). */
  pending: Perception[];
  /** Estado de los objetos que ya conoce (para notar cambios). */
  knownStates: Map<string, string>;
  /** Hasta cuándo prevalece una reacción/conversación sobre el plan. */
  overrideUntil: number;
  utteredAt: number;
  lastMaintenance: number;
  /** Instante de la última consolidación (los recuerdos posteriores entran en la siguiente). */
  lastConsolidation: number;
  consolidatedNight: number;
}

interface Conversation {
  id: string;
  a: string;
  b: string;
  turns: number;
  lastAt: number;
  transcript: string[];
}

export interface SimulationDeps {
  world: WorldMap;
  seeds: AgentSeed[];
  llm: LLMClient;
  memory: MemorySystem;
  clock: GameClock;
  tickMinutes: number;
  /** Velocidad de paseo en baldosas por minuto de juego. */
  walkSpeed: number;
  social: SocialProfileStore;
  events: EventStore;
  chronicles: ChronicleStore;
  consolidator?: Consolidator;
  maintenance?: MemoryMaintenance;
  rng: Rng;
}

/** Señales que la simulación emite hacia los clientes (además de los eventos del log). */
export type SimSignal = Extract<
  ServerMessage,
  { type: "event" | "thinking" | "memory_effect" | "chronicle" | "world" | "status" }
>;

const SPEECH_BUBBLE_MINUTES = 20;
const MAINTENANCE_EVERY = 60;
const CHRONICLE_MINUTE = 23 * 60;
const WEATHER_TEXT: Record<Weather, string> = {
  sunny: "Salió el sol",
  cloudy: "Se nubló el cielo",
  rain: "Empezó a llover",
};

export class Simulation {
  readonly agents = new Map<string, Agent>();
  private readonly runtime = new Map<string, Runtime>();
  private readonly conversations = new Map<string, Conversation>();
  private readonly eventListeners: ((e: SimEvent) => void)[] = [];
  private readonly signalListeners: ((s: SimSignal) => void)[] = [];
  /** Llamadas al LLM en curso por agente (para el snapshot). */
  private readonly thinking = new Map<string, number>();
  private restored = false;

  constructor(private readonly deps: SimulationDeps) {
    const names = Object.fromEntries(deps.seeds.map((s) => [s.id, s.name]));
    for (const seed of deps.seeds) {
      const agent = new Agent(seed, {
        llm: deps.llm,
        memory: deps.memory,
        places: deps.world.places,
        social: deps.social,
        names,
        onError: (agentId, task, error) =>
          this.emit("system", agentId, `⚠ Error en "${task}": ${errorMessage(error)}`),
      });
      this.agents.set(seed.id, agent);
      this.runtime.set(seed.id, {
        travelling: false,
        arrival: null,
        plannedDay: -1,
        seenHere: new Set(),
        inbox: [],
        pending: [],
        knownStates: new Map(),
        overrideUntil: 0,
        utteredAt: -Infinity,
        lastMaintenance: -Infinity,
        lastConsolidation: 0,
        consolidatedNight: -1,
      });
    }
    deps.llm.onCall((e) => {
      if (!e.agentId) return;
      const n = (this.thinking.get(e.agentId) ?? 0) + (e.phase === "start" ? 1 : -1);
      this.thinking.set(e.agentId, Math.max(0, n));
      this.signal({ type: "thinking", agentId: e.agentId, task: e.task, phase: e.phase });
    });
    deps.memory.onEffect((e: MemoryEffect) => this.signal({ type: "memory_effect", ...e }));
  }

  get clock(): GameClock {
    return this.deps.clock;
  }

  get world(): WorldMap {
    return this.deps.world;
  }

  /** Siembra los recuerdos iniciales de los agentes que aún no tienen ninguno. */
  async seedMemoriesIfEmpty(now: number): Promise<number> {
    let seeded = 0;
    for (const agent of this.agents.values()) {
      const existing = await this.deps.memory.store.listByAgent(agent.id);
      if (!existing.length) {
        await agent.seedMemories(now);
        seeded++;
      }
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
      const rt = this.runtime.get(agent.id)!;
      if (!this.restored) rt.lastConsolidation = now;
      if (rt.arrival) this.scheduleArrival(agent, rt.arrival);
      this.clock.schedule(now + i, () => this.agentTick(agent));
    });
    this.scheduleChronicle(now);
    this.emit("system", null, `Simulación iniciada con ${this.agents.size} agentes`);
  }

  onEvent(listener: (e: SimEvent) => void): () => void {
    this.eventListeners.push(listener);
    return () => remove(this.eventListeners, listener);
  }

  onSignal(listener: (s: SimSignal) => void): () => void {
    this.signalListeners.push(listener);
    return () => remove(this.signalListeners, listener);
  }

  // --- Instantáneas ----------------------------------------------------------------------

  /** Estado serializable (JSON) del runtime de agentes, conversaciones, objetos, clima y reloj. */
  snapshot(): SimSnapshot {
    return {
      version: SIM_SNAPSHOT_VERSION,
      time: this.clock.now(),
      speed: this.clock.speed,
      weather: this.deps.world.weather,
      spots: this.deps.world.places.flatMap((p) =>
        p.objects.map((o) => ({ id: o.id, state: o.state })),
      ),
      agents: [...this.agents.values()].map((a) => {
        const rt = this.runtime.get(a.id)!;
        return {
          id: a.id,
          state: structuredClone(a.state),
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
      conversations: [...this.conversations.entries()].map(([key, c]) => ({
        key,
        ...structuredClone(c),
      })),
    };
  }

  /** Restaura una instantánea antes de `start()`. El reloj ya debe estar en `snapshot.time`. */
  restore(s: SimSnapshot): void {
    for (const spot of s.spots) {
      if (this.deps.world.spot(spot.id)) this.deps.world.setSpotState(spot.id, spot.state);
    }
    this.deps.world.weather = s.weather;
    for (const saved of s.agents) {
      const agent = this.agents.get(saved.id);
      if (!agent) continue;
      agent.state = saved.state;
      agent.workingMemory.replace(saved.workingMemory);
      const r = saved.runtime;
      this.runtime.set(saved.id, {
        ...r,
        seenHere: new Set(r.seenHere),
        knownStates: new Map(r.knownStates),
        utteredAt: r.utteredAt ?? -Infinity,
        lastMaintenance: r.lastMaintenance ?? -Infinity,
      });
    }
    this.conversations.clear();
    for (const { key, ...c } of s.conversations) {
      if (this.agents.has(c.a) && this.agents.has(c.b)) this.conversations.set(key, c);
    }
    this.restored = true;
  }

  thinkingAgents(): string[] {
    return [...this.thinking.entries()].filter(([, n]) => n > 0).map(([id]) => id);
  }

  agentStates(): AgentState[] {
    const now = this.clock.now();
    return [...this.agents.values()].map((a) => {
      const rt = this.runtime.get(a.id)!;
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

  /** Avisa de que el mundo se pausó o se reanudó (presupuesto, kill switch, manual...). */
  notifyStatus(status: WorldRunStatus): void {
    const text =
      status.state === "running"
        ? "▶ El mundo se reanuda"
        : `⏸ Mundo en pausa: ${status.detail ?? status.reason}`;
    this.emit("system", null, text);
    this.signal({ type: "status", status });
  }

  // --- Intervención del jugador -------------------------------------------------------------

  /** "Voz interior": un pensamiento que el agente percibe como propio. */
  injectThought(agentId: string, text: string): void {
    const agent = this.agents.get(agentId);
    if (!agent) throw new Error(`Agente desconocido: ${agentId}`);
    this.runtime.get(agentId)!.pending.push({ kind: "thought", text });
    this.emit("thought", agentId, `💭 Voz interior de ${agent.seed.name}: "${text}"`, [agentId]);
  }

  /** Cambia el estado de un objeto; quien esté en el lugar lo percibe ya, el resto al llegar. */
  setSpotState(spotId: string, state: string): void {
    const spot = this.deps.world.setSpotState(spotId, state);
    const place = this.deps.world.place(spot.placeId);
    const witnesses = [...this.agents.values()].filter(
      (a) => a.state.locationId === place.id && !this.runtime.get(a.id)!.travelling,
    );
    const eventId = randomUUID();
    for (const a of witnesses) {
      const rt = this.runtime.get(a.id)!;
      rt.knownStates.set(spot.id, state);
      rt.pending.push({
        kind: "world",
        text: `Noté que ${spot.name} (${place.name}) está: ${untrusted(state)}`,
        placeId: place.id,
        eventId,
      });
    }
    this.emit(
      "world",
      null,
      `🔧 ${spot.name} de ${place.name}: ${state}`,
      witnesses.map((a) => a.id),
      eventId,
    );
    this.signalWorld();
  }

  setWeather(weather: Weather): void {
    this.deps.world.weather = weather;
    const eventId = randomUUID();
    for (const [id, rt] of this.runtime) {
      if (this.agents.get(id)!.state.activityKind === "sleep") continue;
      rt.pending.push({ kind: "world", text: WEATHER_TEXT[weather], placeId: null, eventId });
    }
    this.emit("world", null, `🌦 ${WEATHER_TEXT[weather]}`, [...this.agents.keys()], eventId);
    this.signalWorld();
  }

  // --- Bucle del agente --------------------------------------------------------------

  private async agentTick(agent: Agent): Promise<void> {
    try {
      await this.step(agent);
    } catch (error) {
      this.emit("system", agent.id, `⚠ Error en el tick: ${errorMessage(error)}`);
    } finally {
      this.clock.schedule(this.clock.now() + this.deps.tickMinutes, () => this.agentTick(agent));
    }
  }

  private async step(agent: Agent): Promise<void> {
    const rt = this.runtime.get(agent.id)!;
    if (rt.travelling) return;
    const now = this.clock.now();
    this.updateNeeds(agent, this.deps.tickMinutes);
    this.endIdleConversations(now);
    await this.maintain(agent, now);

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
        return this.travel(agent, agent.seed.homeId, bed?.id ?? null, "durmiendo", "sleep");
      this.setAction(agent, "durmiendo", "sleep");
      await this.consolidate(agent, now);
      return;
    }

    const day = Math.floor(now / 1440);
    if (rt.plannedDay !== day) {
      rt.plannedDay = day;
      this.setAction(agent, "pensando en el día", "idle");
      const plan = await agent.planDay(now);
      this.emit("plan", agent.id, `Plan: ${plan.map((p) => p.activity).join(" → ")}`, [agent.id]);
    }

    // Percibir.
    const present = this.presentWith(agent);
    const arrivals = present.filter((p) => !rt.seenHere.has(p.id));
    rt.seenHere = new Set(present.map((p) => p.id));
    const heard = rt.inbox.splice(0);
    const place = this.deps.world.place(agent.state.locationId);
    for (const o of place.objects) {
      const known = rt.knownStates.get(o.id) ?? "idle";
      if (o.state !== known) {
        rt.knownStates.set(o.id, o.state);
        if (o.state !== "idle") {
          rt.pending.push({
            kind: "world",
            text: `Noté que ${o.name} está: ${untrusted(o.state)}`,
            placeId: place.id,
          });
        }
      }
    }
    const perceptions: Perception[] = [
      ...arrivals.map((p) => ({
        kind: "arrived" as const,
        agentId: p.id,
        name: p.name,
        action: p.action,
        placeId: agent.state.locationId,
      })),
      ...heard.map((h) => ({ kind: "speech" as const, ...h, placeId: agent.state.locationId })),
      ...rt.pending.splice(0),
    ];
    // Guardar.
    await agent.perceive(perceptions, this.clock.now());
    // Decidir.
    const speaker = heard[0]?.fromId ?? null;
    const decision = await agent.decide(this.clock.now(), {
      present,
      heard,
      conversationWith: speaker ?? this.activeConversationOf(agent.id)?.other ?? null,
      objectStates: place.objects
        .filter((o) => o.state !== "idle")
        .map((o) => ({ id: o.id, state: o.state })),
      weather: this.deps.world.weather,
      socialNotes: await agent.socialNotes(present.map((p) => p.id)),
      salient: perceptions.length > 0,
    });
    // Fin de conversación natural: le hablaron y decidió no contestar a esa persona.
    if (speaker && !(decision.kind === "talk" && decision.to === speaker)) {
      await this.endConversation(convKey(agent.id, speaker), "decidió no seguir");
    }
    this.apply(agent, decision);
  }

  private apply(agent: Agent, decision: Decision): void {
    const rt = this.runtime.get(agent.id)!;
    const now = this.clock.now();
    switch (decision.kind) {
      case "follow_plan": {
        if (now < rt.overrideUntil) return;
        const item = agent.currentPlanItem(now);
        if (!item) return this.setAction(agent, "tiempo libre", "idle");
        return this.goOrDo(agent, item.placeId, item.spotId, item.activity, item.activityKind);
      }
      case "react": {
        rt.overrideUntil = now + 60;
        this.emit("action", agent.id, `${agent.seed.name} cambia de planes: ${decision.action}`, [
          agent.id,
        ]);
        return this.goOrDo(
          agent,
          decision.placeId,
          decision.spotId,
          decision.action,
          decision.activityKind,
        );
      }
      case "talk":
        return this.talk(agent, decision.to, decision.utterance);
    }
  }

  // --- Conversaciones -----------------------------------------------------------------------

  private activeConversationOf(agentId: string): { conv: Conversation; other: string } | undefined {
    for (const conv of this.conversations.values()) {
      if (conv.a === agentId) return { conv, other: conv.b };
      if (conv.b === agentId) return { conv, other: conv.a };
    }
    return undefined;
  }

  private talk(agent: Agent, toId: string, utterance: string): void {
    const target = this.agents.get(toId);
    const targetRt = this.runtime.get(toId);
    if (
      !target ||
      !targetRt ||
      target.state.locationId !== agent.state.locationId ||
      targetRt.travelling
    ) {
      return;
    }
    const now = this.clock.now();
    const key = convKey(agent.id, toId);
    let conv = this.conversations.get(key);
    if (!conv) {
      conv = { id: randomUUID(), a: agent.id, b: toId, turns: 0, lastAt: now, transcript: [] };
      this.conversations.set(key, conv);
    }
    const max = this.deps.memory.config.conversation.safetyMaxTurns;
    if (conv.turns >= max) {
      void this.endConversation(key, `máximo de seguridad (${max} turnos)`);
      return;
    }
    conv.turns++;
    conv.lastAt = now;
    conv.transcript.push(`${agent.seed.name}: "${utterance}"`);

    const rt = this.runtime.get(agent.id)!;
    rt.overrideUntil = now + 15;
    rt.utteredAt = now;
    agent.state.lastUtterance = utterance;
    agent.state.needs.social = Math.min(1, agent.state.needs.social + 0.08);
    this.setAction(agent, `hablando con ${target.seed.name}`, "talk");
    agent.state.facing = facingOf(agent.state.tile, target.state.tile);
    targetRt.inbox.push({
      fromId: agent.id,
      fromName: agent.seed.name,
      text: utterance,
      eventId: conv.id,
    });
    const overhearers = this.eavesdrop(agent, target, utterance, conv.id);
    this.emit(
      "speech",
      agent.id,
      `${agent.seed.name} → ${target.seed.name}: "${utterance}"`,
      [agent.id, toId, ...overhearers],
      `${conv.id}:${conv.turns}`,
    );
    void agent.rememberOwnSpeech(toId, target.seed.name, utterance, now, conv.id);
  }

  /** Quien esté cerca puede captar fragmentos (con fuente difusa): así se propagan rumores. */
  private eavesdrop(speaker: Agent, target: Agent, utterance: string, eventId: string): string[] {
    const cfg = this.deps.memory.config.eavesdrop;
    const rng = this.deps.rng;
    const out: string[] = [];
    for (const other of this.agents.values()) {
      if (other.id === speaker.id || other.id === target.id) continue;
      const rt = this.runtime.get(other.id)!;
      if (rt.travelling || other.state.locationId !== speaker.state.locationId) continue;
      if (other.state.activityKind === "sleep" || rng() >= cfg.probability) continue;
      const words = utterance.split(/\s+/);
      const keep = Math.max(1, Math.round(words.length * cfg.fragmentRatio));
      const start = Math.floor(rng() * Math.max(1, words.length - keep + 1));
      const recognized = rng() < cfg.recognizeSpeaker;
      rt.pending.push({
        kind: "overheard",
        fromId: recognized ? speaker.id : null,
        fromName: recognized ? speaker.seed.name : "alguien",
        toName: target.seed.name,
        fragment: `…${words.slice(start, start + keep).join(" ")}…`,
        placeId: speaker.state.locationId,
        eventId,
      });
      out.push(other.id);
    }
    return out;
  }

  private endIdleConversations(now: number): void {
    const idle = this.deps.memory.config.conversation.idleMinutes;
    for (const [key, conv] of this.conversations) {
      if (now - conv.lastAt > idle) void this.endConversation(key, "se quedaron sin tema");
    }
  }

  /** Cierra la conversación y actualiza la ficha social de ambos. */
  private async endConversation(key: string, reason: string): Promise<void> {
    const conv = this.conversations.get(key);
    if (!conv) return;
    this.conversations.delete(key);
    const a = this.agents.get(conv.a)!;
    const b = this.agents.get(conv.b)!;
    this.emit(
      "action",
      null,
      `${a.seed.name} y ${b.seed.name} terminan de hablar (${conv.turns} turnos; ${reason})`,
      [a.id, b.id],
    );
    const now = this.clock.now();
    for (const [owner, other] of [
      [a, b],
      [b, a],
    ] as const) {
      try {
        await updateSocialAfterConversation(this.deps.llm, this.deps.social, {
          owner: owner.owner,
          other: { id: other.id, name: other.seed.name },
          transcript: conv.transcript,
          now,
        });
      } catch (error) {
        this.emit("system", owner.id, `⚠ Error en "social": ${errorMessage(error)}`);
      }
    }
  }

  // --- Memoria humana: mantenimiento, consolidación y crónica ---------------------------------

  private async maintain(agent: Agent, now: number): Promise<void> {
    const rt = this.runtime.get(agent.id)!;
    if (!this.deps.maintenance || now - rt.lastMaintenance < MAINTENANCE_EVERY) return;
    rt.lastMaintenance = now;
    const others = [...this.agents.keys()].filter((id) => id !== agent.id);
    const report = await this.deps.maintenance.run(agent.owner, now, others);
    const n = report.deleted.length + report.archived.length;
    if (n) {
      this.emit(
        "memory",
        agent.id,
        `🧠 ${agent.seed.name} olvida ${report.deleted.length} recuerdos y resume ${report.archived.length} (presupuesto de memoria)`,
        [agent.id],
      );
    }
  }

  private async consolidate(agent: Agent, now: number): Promise<void> {
    const rt = this.runtime.get(agent.id)!;
    const night = Math.floor((now - 7 * 60) / 1440);
    if (!this.deps.consolidator || rt.consolidatedNight === night) return;
    rt.consolidatedNight = night;
    try {
      const r = await this.deps.consolidator.consolidate(agent.owner, rt.lastConsolidation, now);
      rt.lastConsolidation = now;
      // Nada que consolidar (p. ej. al arrancar de madrugada): no ensuciar el log.
      if (!r.created.length && !r.reinforced.length && !r.weakened.length) return;
      this.emit(
        "memory",
        agent.id,
        `🌙 ${agent.seed.name} consolida el día: ${r.created.length} reflexiones/hechos, refuerza ${r.reinforced.length} y debilita ${r.weakened.length} recuerdos`,
        [agent.id],
      );
    } catch (error) {
      this.emit("system", agent.id, `⚠ Error en "consolidate": ${errorMessage(error)}`);
    }
  }

  private scheduleChronicle(now: number): void {
    const day = Math.floor(now / 1440);
    const at = day * 1440 + CHRONICLE_MINUTE;
    const next = at > now ? at : at + 1440;
    this.clock.schedule(next, async () => {
      await this.writeChronicle(Math.floor(next / 1440));
      this.scheduleChronicle(this.clock.now() + 1);
    });
  }

  async writeChronicle(day: number): Promise<Chronicle | null> {
    try {
      const events = await this.deps.events.range(day * 1440, (day + 1) * 1440, 2000);
      const lines = events
        .filter((e) => ["speech", "action", "world", "thought", "memory"].includes(e.kind))
        .map((e) => e.text);
      const chronicle = await writeChronicle(this.deps.llm, day, lines);
      await this.deps.chronicles.add(chronicle);
      this.emit("chronicle", null, `📜 Crónica del día ${day}: ${chronicle.title}`);
      this.signal({ type: "chronicle", chronicle });
      return chronicle;
    } catch (error) {
      this.emit("system", null, `⚠ Error en "chronicle": ${errorMessage(error)}`);
      return null;
    }
  }

  // --- Rutinas sin LLM -----------------------------------------------------------------

  /** Si ya está en el sitio, hace la actividad; si no, se pone en camino. */
  private goOrDo(
    agent: Agent,
    placeId: string,
    spotId: string | null,
    action: string,
    kind: ActivityKind,
  ): void {
    const there = agent.state.locationId === placeId && (!spotId || agent.state.spotId === spotId);
    if (!there) return this.travel(agent, placeId, spotId, action, kind);
    this.setAction(agent, action, kind);
  }

  /** Ruta A* hasta el spot (o una baldosa libre del lugar) con llegada programada. */
  private travel(
    agent: Agent,
    destId: string,
    spotId: string | null,
    thenAction: string,
    thenKind: ActivityKind,
  ): void {
    const rt = this.runtime.get(agent.id)!;
    const now = this.clock.now();
    const world = this.deps.world;
    const spot = spotId ? world.spot(spotId) : undefined;
    const goal = world.restingTile(destId, spot?.tile ?? null, this.occupiedTiles(agent.id));
    const waypoints = world.route(agent.state.tile, goal) ?? [agent.state.tile, goal];
    const minutes = Math.max(1, Math.round(pathLength(waypoints) / this.deps.walkSpeed));
    const dest = world.place(destId);

    rt.travelling = true;
    rt.seenHere.clear();
    agent.state.targetId = destId;
    agent.state.spotId = spot && spot.tile.x === goal.x && spot.tile.y === goal.y ? spot.id : null;
    agent.state.movement = { waypoints, startTime: now, endTime: now + minutes };
    if (waypoints.length > 1) agent.state.facing = facingOf(waypoints[0]!, waypoints[1]!);
    this.setAction(agent, `caminando a ${dest.name}`, "walk");
    rt.arrival = { destId, goal, thenAction, thenKind, at: now + minutes };
    this.scheduleArrival(agent, rt.arrival);
  }

  private scheduleArrival(agent: Agent, arrival: Arrival): void {
    const rt = this.runtime.get(agent.id)!;
    this.clock.schedule(arrival.at, () => {
      const prev = agent.state.movement?.waypoints.at(-2);
      if (prev) agent.state.facing = facingOf(prev, arrival.goal);
      agent.state.tile = arrival.goal;
      agent.state.locationId = arrival.destId;
      agent.state.targetId = null;
      agent.state.movement = null;
      rt.travelling = false;
      rt.arrival = null;
      this.setAction(agent, arrival.thenAction, arrival.thenKind);
    });
  }

  /** Baldosas ocupadas por agentes quietos o reservadas como destino de un viaje. */
  private occupiedTiles(exceptId: string): Set<string> {
    const occupied = new Set<string>();
    for (const a of this.agents.values()) {
      if (a.id === exceptId) continue;
      occupied.add(tileKey(a.state.movement?.waypoints.at(-1) ?? a.state.tile));
    }
    return occupied;
  }

  private updateNeeds(agent: Agent, dt: number): void {
    const n = agent.state.needs;
    const h = dt / 60;
    const sleeping = agent.state.activityKind === "sleep";
    const eating = agent.state.activityKind === "eat";
    n.energy = clamp01(n.energy + (sleeping ? 0.11 * h : -0.05 * h));
    n.hunger = clamp01(n.hunger + (eating ? -0.5 * h : sleeping ? 0.02 * h : 0.07 * h));
    n.social = clamp01(n.social - 0.04 * h);
  }

  private presentWith(agent: Agent): { id: string; name: string; action: string }[] {
    return [...this.agents.values()]
      .filter((o) => o.id !== agent.id)
      .filter((o) => !this.runtime.get(o.id)!.travelling)
      .filter(
        (o) => o.state.locationId === agent.state.locationId && o.state.activityKind !== "sleep",
      )
      .map((o) => ({ id: o.id, name: o.seed.name, action: o.state.action }));
  }

  private setAction(agent: Agent, action: string, kind?: ActivityKind): void {
    const spot = agent.spot(agent.state.spotId);
    agent.state.activityKind = kind ?? inferActivityKind(action, spot?.pose);
    if (agent.state.action === action) return;
    agent.state.action = action;
    this.emit("action", agent.id, `${agent.seed.name}: ${action}`, [agent.id]);
  }

  private signalWorld(): void {
    this.signal({
      type: "world",
      weather: this.deps.world.weather,
      spots: this.deps.world.places.flatMap((p) =>
        p.objects.map((o) => ({ id: o.id, state: o.state })),
      ),
    });
  }

  private signal(s: SimSignal): void {
    for (const l of this.signalListeners) l(s);
  }

  private emit(
    kind: SimEventKind,
    agentId: string | null,
    text: string,
    participants: string[] = [],
    id: string = randomUUID(),
  ): void {
    const event: SimEvent = { id, time: this.clock.now(), agentId, kind, text, participants };
    for (const l of this.eventListeners) l(event);
    this.signal({ type: "event", event });
  }
}

function remove<T>(list: T[], item: T): void {
  const i = list.indexOf(item);
  if (i >= 0) list.splice(i, 1);
}

function finiteOrNull(x: number): number | null {
  return Number.isFinite(x) ? x : null;
}

function convKey(a: string, b: string): string {
  return [a, b].sort().join("|");
}

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
