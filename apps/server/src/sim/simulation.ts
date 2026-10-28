import { Agent, type Decision, type LLMClient, type MemorySystem } from "@lethetown/agent-core";
import type { AgentSeed, AgentState, SimEvent } from "@lethetown/shared";
import type { GameClock } from "./clock";
import type { WorldMap } from "./world";

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
      if (!deps.world.has(seed.homeId))
        throw new Error(`${seed.id}: casa desconocida ${seed.homeId}`);
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
        plan: [...a.state.plan],
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

    // Rutina trivial sin LLM: dormir.
    if (agent.isSleepTime(now)) {
      rt.seenHere.clear();
      rt.inbox = [];
      if (agent.state.locationId !== agent.seed.homeId) {
        this.travel(agent, agent.seed.homeId, "durmiendo");
      } else {
        this.setAction(agent, "durmiendo");
      }
      return;
    }

    const day = Math.floor(now / 1440);
    if (rt.plannedDay !== day) {
      rt.plannedDay = day;
      this.setAction(agent, "pensando en el día");
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
    const decision = await agent.decide(this.clock.now(), {
      present,
      heard,
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
        if (!item) return this.setAction(agent, "tiempo libre");
        if (item.placeId !== agent.state.locationId)
          return this.travel(agent, item.placeId, item.activity);
        return this.setAction(agent, item.activity);
      }
      case "react": {
        rt.overrideUntil = now + 60;
        this.emit("action", agent.id, `${agent.seed.name} cambia de planes: ${decision.action}`);
        if (decision.placeId !== agent.state.locationId) {
          return this.travel(agent, decision.placeId, decision.action);
        }
        return this.setAction(agent, decision.action);
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
    this.setAction(agent, `hablando con ${target.seed.name}`);
    this.emit("speech", agent.id, `${agent.seed.name} → ${target.seed.name}: "${utterance}"`);
    targetRt.inbox.push({ fromId: agent.id, fromName: agent.seed.name, text: utterance });
    void agent.rememberOwnSpeech(toId, target.seed.name, utterance, now);
  }

  // --- Rutinas sin LLM -----------------------------------------------------------------

  private travel(agent: Agent, destId: string, thenAction: string): void {
    const rt = this.runtime.get(agent.id)!;
    const minutes = this.deps.world.travelMinutes(agent.state.locationId, destId);
    const dest = this.deps.world.place(destId);
    rt.travelling = true;
    rt.seenHere.clear();
    agent.state.targetId = destId;
    this.setAction(agent, `caminando a ${dest.name}`);
    this.clock.schedule(this.clock.now() + minutes, () => {
      agent.state.locationId = destId;
      agent.state.targetId = null;
      rt.travelling = false;
      this.setAction(agent, thenAction);
    });
  }

  private updateNeeds(agent: Agent, dt: number): void {
    const n = agent.state.needs;
    const h = dt / 60;
    const sleeping = agent.state.action === "durmiendo";
    const eating = /comer|desayun|cenar|merend|café/i.test(agent.state.action);
    n.energy = clamp01(n.energy + (sleeping ? 0.11 * h : -0.05 * h));
    n.hunger = clamp01(n.hunger + (eating ? -0.5 * h : sleeping ? 0.02 * h : 0.07 * h));
    n.social = clamp01(n.social - 0.04 * h);
  }

  private presentWith(agent: Agent): { id: string; name: string; action: string }[] {
    return [...this.agents.values()]
      .filter((o) => o.id !== agent.id)
      .filter((o) => !this.runtime.get(o.id)!.travelling)
      .filter(
        (o) => o.state.locationId === agent.state.locationId && o.state.action !== "durmiendo",
      )
      .map((o) => ({ id: o.id, name: o.seed.name, action: o.state.action }));
  }

  private setAction(agent: Agent, action: string): void {
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
