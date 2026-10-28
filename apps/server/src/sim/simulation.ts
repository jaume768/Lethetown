import {
  Agent,
  inferActivityKind,
  type Decision,
  type LLMClient,
  type MemorySystem,
} from "@lethetown/agent-core";
import {
  facingOf,
  pathLength,
  type ActivityKind,
  type AgentSeed,
  type AgentState,
  type SimEvent,
} from "@lethetown/shared";
import type { GameClock } from "./clock";
import { tileKey, type WorldMap } from "./world";

interface Heard {
  fromId: string;
  fromName: string;
  text: string;
}

interface Runtime {
  travelling: boolean;
  plannedDay: number;
  /** Quién estaba en el mismo lugar en el último tick (para detectar llegadas). */
  seenHere: Set<string>;
  inbox: Heard[];
  /** Hasta cuándo prevalece una reacción/conversación sobre el plan. */
  overrideUntil: number;
  utteredAt: number;
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
}

/** Turnos máximos de una conversación entre dos agentes antes de dejarla. */
const MAX_TURNS = 6;
const CONVERSATION_WINDOW = 60;
const SPEECH_BUBBLE_MINUTES = 20;

export class Simulation {
  readonly agents = new Map<string, Agent>();
  private readonly runtime = new Map<string, Runtime>();
  private readonly conversations = new Map<string, { turns: number; lastAt: number }>();
  private readonly listeners: ((e: SimEvent) => void)[] = [];
  private eventSeq = 0;

  constructor(private readonly deps: SimulationDeps) {
    for (const seed of deps.seeds) {
      const agent = new Agent(seed, {
        llm: deps.llm,
        memory: deps.memory,
        places: deps.world.places,
        onError: (agentId, task, error) =>
          this.emit("system", agentId, `⚠ Error en "${task}": ${errorMessage(error)}`),
      });
      this.agents.set(seed.id, agent);
      this.runtime.set(seed.id, {
        travelling: false,
        plannedDay: -1,
        seenHere: new Set(),
        inbox: [],
        overrideUntil: 0,
        utteredAt: -Infinity,
      });
    }
  }

  get clock(): GameClock {
    return this.deps.clock;
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

  /** Programa el primer tick de cada agente (escalonados para repartir llamadas). */
  start(): void {
    const now = this.clock.now();
    [...this.agents.values()].forEach((agent, i) => {
      this.clock.schedule(now + i, () => this.agentTick(agent));
    });
    this.emit("system", null, `Simulación iniciada con ${this.agents.size} agentes`);
  }

  onEvent(listener: (e: SimEvent) => void): void {
    this.listeners.push(listener);
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

    // Rutina trivial sin LLM: dormir en su cama.
    if (agent.isSleepTime(now)) {
      rt.seenHere.clear();
      rt.inbox = [];
      const bed = agent.bedSpot();
      const inBed = bed
        ? agent.state.spotId === bed.id
        : agent.state.locationId === agent.seed.homeId;
      if (!inBed) this.travel(agent, agent.seed.homeId, bed?.id ?? null, "durmiendo", "sleep");
      else this.setAction(agent, "durmiendo", "sleep");
      return;
    }

    const day = Math.floor(now / 1440);
    if (rt.plannedDay !== day) {
      rt.plannedDay = day;
      this.setAction(agent, "pensando en el día", "idle");
      const plan = await agent.planDay(now);
      this.emit("plan", agent.id, `Plan: ${plan.map((p) => p.activity).join(" → ")}`);
    }

    // Percibir.
    const present = this.presentWith(agent);
    const arrivals = present.filter((p) => !rt.seenHere.has(p.id));
    rt.seenHere = new Set(present.map((p) => p.id));
    const heard = rt.inbox.splice(0);
    const perceptions = [
      ...arrivals.map((p) => ({
        kind: "arrived" as const,
        agentId: p.id,
        name: p.name,
        action: p.action,
        placeId: agent.state.locationId,
      })),
      ...heard.map((h) => ({ kind: "speech" as const, ...h, placeId: agent.state.locationId })),
    ];
    // Guardar.
    await agent.perceive(perceptions, this.clock.now());
    // Decidir.
    const place = this.deps.world.place(agent.state.locationId);
    const decision = await agent.decide(this.clock.now(), {
      present,
      heard,
      conversationWith: heard[0]?.fromId ?? null,
      objectStates: place.objects
        .filter((o) => o.state !== "idle")
        .map((o) => ({ id: o.id, state: o.state })),
      weather: this.deps.world.weather,
      socialNotes: [],
      salient: perceptions.length > 0,
    });
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
        this.emit("action", agent.id, `${agent.seed.name} cambia de planes: ${decision.action}`);
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
    const key = [agent.id, toId].sort().join("|");
    const conv = this.conversations.get(key);
    const turns = conv && now - conv.lastAt < CONVERSATION_WINDOW ? conv.turns : 0;
    if (turns >= MAX_TURNS) return;
    this.conversations.set(key, { turns: turns + 1, lastAt: now });

    const rt = this.runtime.get(agent.id)!;
    rt.overrideUntil = now + 15;
    rt.utteredAt = now;
    agent.state.lastUtterance = utterance;
    agent.state.needs.social = Math.min(1, agent.state.needs.social + 0.08);
    this.setAction(agent, `hablando con ${target.seed.name}`, "talk");
    agent.state.facing = facingOf(agent.state.tile, target.state.tile);
    this.emit("speech", agent.id, `${agent.seed.name} → ${target.seed.name}: "${utterance}"`);
    targetRt.inbox.push({ fromId: agent.id, fromName: agent.seed.name, text: utterance });
    void agent.rememberOwnSpeech(toId, target.seed.name, utterance, now);
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
    this.clock.schedule(now + minutes, () => {
      const prev = waypoints.at(-2);
      if (prev) agent.state.facing = facingOf(prev, goal);
      agent.state.tile = goal;
      agent.state.locationId = destId;
      agent.state.targetId = null;
      agent.state.movement = null;
      rt.travelling = false;
      this.setAction(agent, thenAction, thenKind);
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
    this.emit("action", agent.id, `${agent.seed.name}: ${action}`);
  }

  private emit(kind: SimEvent["kind"], agentId: string | null, text: string): void {
    const event: SimEvent = {
      id: `e${++this.eventSeq}`,
      time: this.clock.now(),
      agentId,
      kind,
      text,
    };
    for (const l of this.listeners) l(event);
  }
}

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
