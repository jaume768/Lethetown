import { Agent, type Decision, type MemoryEffect } from "@lethetown/agent-core";
import type { AgentState, Chronicle, SimEvent, Weather, WorldRunStatus } from "@lethetown/shared";
import type { GameClock } from "./clock";
import {
  SimContext,
  convKey,
  errorMessage,
  newRuntime,
  type SimSignal,
  type SimulationDeps,
} from "./context";
import { activeConversationOf, endConversation, endIdleConversations, talk } from "./conversations";
import * as intervention from "./intervention";
import { consolidate, maintain, scheduleChronicle, writeChronicle } from "./memory-routines";
import { gatherPerceptions } from "./perception";
import { goOrDo, scheduleArrival, setAction, travel, updateNeeds } from "./routines";
import { SIM_SNAPSHOT_VERSION, type SimSnapshot } from "./snapshot";
import type { WorldMap } from "./world";

export type { SimSignal, SimulationDeps } from "./context";

const SPEECH_BUBBLE_MINUTES = 20;

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

  constructor(deps: SimulationDeps) {
    const ctx = new SimContext(deps);
    this.ctx = ctx;
    const names = Object.fromEntries(deps.seeds.map((s) => [s.id, s.name]));
    for (const seed of deps.seeds) {
      const agent = new Agent(seed, {
        llm: deps.llm,
        memory: deps.memory,
        places: deps.world.places,
        social: deps.social,
        names,
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
      this.clock.schedule(now + i, () => this.agentTick(agent));
    });
    scheduleChronicle(this.ctx, now);
    this.ctx.emit("system", null, `Simulación iniciada con ${this.agents.size} agentes`);
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
      conversations: [...this.ctx.conversations.entries()].map(([key, c]) => ({
        key,
        ...structuredClone(c),
      })),
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
    for (const { key, ...c } of s.conversations) {
      if (this.agents.has(c.a) && this.agents.has(c.b)) this.ctx.conversations.set(key, c);
    }
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

  private async agentTick(agent: Agent): Promise<void> {
    for (const l of this.tickListeners) l();
    try {
      await this.step(agent);
    } catch (error) {
      this.ctx.emit("system", agent.id, `⚠ Error en el tick: ${errorMessage(error)}`);
    } finally {
      this.clock.schedule(this.clock.now() + this.tickMinutes, () => this.agentTick(agent));
    }
  }

  private async step(agent: Agent): Promise<void> {
    const ctx = this.ctx;
    const rt = ctx.rt(agent.id);
    if (rt.travelling) return;
    const now = this.clock.now();
    updateNeeds(agent, this.tickMinutes);
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

    const day = Math.floor(now / 1440);
    if (rt.plannedDay !== day) {
      rt.plannedDay = day;
      setAction(ctx, agent, "pensando en el día", "idle");
      const plan = await agent.planDay(now);
      ctx.emit("plan", agent.id, `Plan: ${plan.map((p) => p.activity).join(" → ")}`, [agent.id]);
    }

    // Percibir.
    const { present, heard, place, perceptions } = gatherPerceptions(ctx, agent);
    // Guardar.
    await agent.perceive(perceptions, this.clock.now());
    // Decidir.
    const speaker = heard[0]?.fromId ?? null;
    const decision = await agent.decide(this.clock.now(), {
      present,
      heard,
      conversationWith: speaker ?? activeConversationOf(ctx, agent.id)?.other ?? null,
      objectStates: place.objects
        .filter((o) => o.state !== "idle")
        .map((o) => ({ id: o.id, state: o.state })),
      weather: ctx.world.weather,
      socialNotes: await agent.socialNotes(present.map((p) => p.id)),
      salient: perceptions.length > 0,
    });
    // Fin de conversación natural: le hablaron y decidió no contestar a esa persona.
    if (speaker && !(decision.kind === "talk" && decision.to === speaker)) {
      await endConversation(ctx, convKey(agent.id, speaker), "decidió no seguir");
    }
    this.apply(agent, decision);
  }

  /** Actuar: seguir el plan, reaccionar o hablar. */
  private apply(agent: Agent, decision: Decision): void {
    const ctx = this.ctx;
    const rt = ctx.rt(agent.id);
    const now = this.clock.now();
    switch (decision.kind) {
      case "follow_plan": {
        if (now < rt.overrideUntil) return;
        const item = agent.currentPlanItem(now);
        if (!item) return setAction(ctx, agent, "tiempo libre", "idle");
        return goOrDo(ctx, agent, item.placeId, item.spotId, item.activity, item.activityKind);
      }
      case "react": {
        rt.overrideUntil = now + 60;
        ctx.emit("action", agent.id, `${agent.seed.name} cambia de planes: ${decision.action}`, [
          agent.id,
        ]);
        return goOrDo(
          ctx,
          agent,
          decision.placeId,
          decision.spotId,
          decision.action,
          decision.activityKind,
        );
      }
      case "talk":
        return talk(ctx, agent, decision.to, decision.utterance);
    }
  }
}

function finiteOrNull(x: number): number | null {
  return Number.isFinite(x) ? x : null;
}
