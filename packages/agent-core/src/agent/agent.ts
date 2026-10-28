import type {
  ActivityKind,
  AgentSeed,
  AgentState,
  Mood,
  Place,
  PlanItem,
  Spot,
} from "@lethetown/shared";
import type { LLMClient } from "../llm/client";
import type { MemorySystem } from "../memory/memory-system";
import { recallText } from "../memory/retrieval";
import type { MemorySource } from "@lethetown/shared";
import { WorkingMemory } from "../memory/working-memory";
import { inferActivityKind } from "./activity";
import { DecideResponse, ImportanceResponse, PlanResponse, parseWith } from "./parse";
import {
  decidePrompt,
  identityPrompt,
  importancePrompt,
  parseClock,
  planPrompt,
  type DecideContext,
} from "./prompts";

export type Perception =
  | { kind: "arrived"; agentId: string; name: string; action: string; placeId: string }
  | {
      kind: "speech";
      fromId: string;
      fromName: string;
      text: string;
      placeId: string;
      eventId?: string;
    }
  | {
      kind: "overheard";
      /** Quién habló, si el agente lo distingue. */
      fromId: string | null;
      fromName: string;
      toName: string;
      fragment: string;
      placeId: string;
      eventId?: string;
    }
  | { kind: "thought"; text: string }
  | { kind: "world"; text: string; placeId: string | null; eventId?: string };

export type Decision =
  | { kind: "follow_plan" }
  | {
      kind: "react";
      action: string;
      activityKind: ActivityKind;
      placeId: string;
      spotId: string | null;
    }
  | { kind: "talk"; to: string; utterance: string };

export interface AgentDeps {
  llm: LLMClient;
  memory: MemorySystem;
  places: Place[];
  onError?: (agentId: string, task: string, error: unknown) => void;
}

export type DecideInput = Omit<
  DecideContext,
  "now" | "locationId" | "action" | "moodLabel" | "needs" | "planItem" | "workingMemory"
> & { salient: boolean };

const SLEEP_START = 22 * 60;
const DAY_START = 7 * 60;

export function moodLabel(valence: number): string {
  if (valence > 0.5) return "contento";
  if (valence > 0.15) return "tranquilo y de buen humor";
  if (valence > -0.15) return "neutral";
  if (valence > -0.5) return "algo apagado";
  return "triste";
}

/** Plan mínimo sin LLM, usado si la planificación falla. */
export function fallbackPlan(homeId: string): PlanItem[] {
  return [
    {
      startMinute: DAY_START,
      durationMin: SLEEP_START - DAY_START,
      activity: "estar en casa",
      activityKind: "idle",
      placeId: homeId,
      spotId: null,
    },
  ];
}

export class Agent {
  readonly id: string;
  readonly system: string;
  readonly workingMemory = new WorkingMemory();
  state: AgentState;
  private readonly spots: Map<string, Spot>;

  constructor(
    readonly seed: AgentSeed,
    private readonly deps: AgentDeps,
  ) {
    this.id = seed.id;
    this.system = identityPrompt(seed, deps.places);
    this.spots = new Map(deps.places.flatMap((p) => p.objects.map((o) => [o.id, o] as const)));
    const home = deps.places.find((p) => p.id === seed.homeId);
    if (!home) throw new Error(`${seed.id}: casa desconocida ${seed.homeId}`);
    const bed = this.bedSpot();
    const mood: Mood = { valence: 0.1, label: moodLabel(0.1) };
    this.state = {
      id: seed.id,
      name: seed.name,
      locationId: seed.homeId,
      targetId: null,
      spotId: bed?.id ?? null,
      tile: bed?.tile ?? home.anchor,
      facing: "down",
      movement: null,
      action: "durmiendo",
      activityKind: "sleep",
      mood,
      needs: { energy: 0.8, hunger: 0.4, social: 0.5 },
      plan: fallbackPlan(seed.homeId),
      lastUtterance: null,
    };
  }

  /** Su cama: un spot "sleep" de su casa con su id como dueño (o cualquiera de su casa). */
  bedSpot(): Spot | undefined {
    const home = this.deps.places.find((p) => p.id === this.seed.homeId);
    const beds = home?.objects.filter((o) => o.pose === "sleep") ?? [];
    return beds.find((b) => b.owner === this.id) ?? beds.find((b) => !b.owner);
  }

  spot(id: string | null): Spot | undefined {
    return id ? this.spots.get(id) : undefined;
  }

  /** Guarda los recuerdos semánticos iniciales del archivo de semillas. */
  async seedMemories(now: number): Promise<void> {
    for (const text of this.seed.initialMemories) {
      await this.deps.memory.remember(
        { agentId: this.id, text, type: "semantic", importance: 6, source: "inferido" },
        now,
      );
    }
  }

  currentPlanItem(now: number): PlanItem | undefined {
    const minute = now % 1440;
    return this.state.plan.find(
      (p) => minute >= p.startMinute && minute < p.startMinute + p.durationMin,
    );
  }

  isSleepTime(now: number): boolean {
    const minute = now % 1440;
    return minute >= SLEEP_START || minute < DAY_START;
  }

  /** Planifica el día con el modelo de reflexión. */
  async planDay(now: number): Promise<PlanItem[]> {
    const recalled = await this.deps.memory.retrieve({
      agentId: this.id,
      query: `${this.seed.name}: qué quiero hacer hoy, mis rutinas y mis planes`,
      now,
      moodValence: this.state.mood.valence,
      k: 5,
    });
    try {
      const res = await this.deps.llm.run({
        kind: "reflection",
        task: "plan",
        agentId: this.id,
        system: this.system,
        prompt: planPrompt({
          now,
          needs: this.state.needs,
          recalled: recalled.map((s) => `- ${recallText(s)}`).join("\n") || "- (nada en especial)",
        }),
      });
      const plan = parseWith(PlanResponse, res.text)
        .plan.map((p): PlanItem | null => {
          const startMinute = parseClock(p.start);
          if (startMinute === null) return null;
          const placeId = this.validPlace(p.placeId) ?? this.seed.homeId;
          const spot = this.spot(p.spotId);
          const spotId = spot && spot.placeId === placeId ? spot.id : null;
          return {
            startMinute,
            durationMin: p.durationMin,
            activity: p.activity,
            activityKind: p.activityKind ?? inferActivityKind(p.activity, spot?.pose),
            placeId,
            spotId,
          };
        })
        .filter((p): p is PlanItem => p !== null)
        .sort((a, b) => a.startMinute - b.startMinute);
      this.state.plan = plan.length ? plan : fallbackPlan(this.seed.homeId);
    } catch (error) {
      this.deps.onError?.(this.id, "plan", error);
      this.state.plan = fallbackPlan(this.seed.homeId);
    }
    await this.deps.memory.remember(
      {
        agentId: this.id,
        text: `Mi plan para hoy: ${this.state.plan.map((p) => p.activity).join(", ")}`,
        type: "plan",
        importance: 3,
      },
      now,
    );
    return this.state.plan;
  }

  /** Percibir → guardar: convierte percepciones en recuerdos con importancia y valencia. */
  async perceive(perceptions: Perception[], now: number): Promise<void> {
    if (!perceptions.length) return;
    const texts = perceptions.map(describePerception);
    const ratings = await this.rate(texts);
    let valenceSum = 0;
    for (const [i, p] of perceptions.entries()) {
      const rating = ratings[i] ?? { importance: 2, valence: 0 };
      valenceSum += rating.valence;
      const record = await this.deps.memory.remember(
        {
          agentId: this.id,
          text: texts[i]!,
          type: "observation",
          importance: p.kind === "thought" ? Math.max(rating.importance, 6) : rating.importance,
          emotionalValence: rating.valence,
          source: sourceOf(p),
          people: peopleOf(p),
          placeId: "placeId" in p ? p.placeId : this.state.locationId,
          eventId: "eventId" in p ? (p.eventId ?? null) : null,
        },
        now,
      );
      this.workingMemory.push({ text: record.text, memoryId: record.id, addedAt: now });
    }
    const v = 0.8 * this.state.mood.valence + 0.2 * (valenceSum / perceptions.length);
    this.state.mood = { valence: clamp(v, -1, 1), label: moodLabel(v) };
  }

  /** Decidir: seguir el plan, reaccionar o hablar. Solo llama al LLM si hay algo saliente. */
  async decide(now: number, input: DecideInput): Promise<Decision> {
    if (!input.salient) return { kind: "follow_plan" };

    const cue = [
      ...input.heard.map((h) => `${h.fromName} dice: ${h.text}`),
      ...input.present.map((p) => p.name),
      ...input.objectStates.map((o) => `${o.id} ${o.state}`),
    ].join(". ");
    const recalled = await this.deps.memory.retrieve({
      agentId: this.id,
      query: cue || this.state.action,
      now,
      moodValence: this.state.mood.valence,
      k: 3,
    });
    for (const s of recalled) {
      this.workingMemory.push({ text: recallText(s), memoryId: s.memory.id, addedAt: now });
    }

    try {
      const { salient: _salient, ...context } = input;
      const res = await this.deps.llm.run({
        kind: "fast",
        task: "decide",
        agentId: this.id,
        system: this.system,
        prompt: decidePrompt({
          ...context,
          now,
          locationId: this.state.locationId,
          action: this.state.action,
          moodLabel: this.state.mood.label,
          needs: this.state.needs,
          planItem: this.currentPlanItem(now),
          workingMemory: this.workingMemory.render(),
        }),
      });
      return this.toDecision(parseWith(DecideResponse, res.text), input.present);
    } catch (error) {
      this.deps.onError?.(this.id, "decide", error);
      return { kind: "follow_plan" };
    }
  }

  /** Guarda lo que el propio agente ha dicho. */
  async rememberOwnSpeech(
    to: string,
    toName: string,
    utterance: string,
    now: number,
    eventId?: string,
  ) {
    await this.deps.memory.remember(
      {
        agentId: this.id,
        text: `Le dije a ${toName}: "${utterance}"`,
        type: "observation",
        importance: 3,
        people: [to],
        placeId: this.state.locationId,
        eventId: eventId ?? null,
      },
      now,
    );
  }

  private validPlace(id: string | undefined): string | undefined {
    return id && this.deps.places.some((p) => p.id === id) ? id : undefined;
  }

  private toDecision(r: DecideResponse, present: { id: string }[]): Decision {
    if (r.choice === "talk" && r.to && r.say && present.some((p) => p.id === r.to)) {
      return { kind: "talk", to: r.to, utterance: r.say };
    }
    if (r.choice === "react" && r.action) {
      const placeId = this.validPlace(r.placeId) ?? this.state.locationId;
      const spot = this.spot(r.spotId);
      return {
        kind: "react",
        action: r.action,
        placeId,
        spotId: spot && spot.placeId === placeId ? spot.id : null,
        activityKind: r.activityKind ?? inferActivityKind(r.action, spot?.pose),
      };
    }
    return { kind: "follow_plan" };
  }

  private async rate(texts: string[]): Promise<{ importance: number; valence: number }[]> {
    try {
      const res = await this.deps.llm.run({
        kind: "fast",
        task: "importance",
        agentId: this.id,
        system: this.system,
        prompt: importancePrompt(texts),
        maxTokens: 400,
      });
      return parseWith(ImportanceResponse, res.text).ratings.map((r) => ({
        importance: clamp(r.importance, 1, 10),
        valence: clamp(r.valence, -1, 1),
      }));
    } catch (error) {
      this.deps.onError?.(this.id, "importance", error);
      return texts.map(() => ({ importance: 2, valence: 0 }));
    }
  }
}

export function describePerception(p: Perception): string {
  switch (p.kind) {
    case "arrived":
      return `Vi a ${p.name} llegar a ${p.placeId} (${p.action})`;
    case "speech":
      return `${p.fromName} me dijo: "${p.text}"`;
    case "overheard":
      return `Oí a ${p.fromName} decirle a ${p.toName} algo como: "${p.fragment}"`;
    case "thought":
      return `Pensé: ${p.text}`;
    case "world":
      return p.text;
  }
}

function sourceOf(p: Perception): MemorySource {
  switch (p.kind) {
    case "speech":
      return `contado por ${p.fromId}`;
    case "overheard":
      return `contado por ${p.fromId ?? "alguien"}`;
    case "thought":
      return "inferido";
    default:
      return "vivido";
  }
}

function peopleOf(p: Perception): string[] {
  switch (p.kind) {
    case "arrived":
      return [p.agentId];
    case "speech":
      return [p.fromId];
    case "overheard":
      return p.fromId ? [p.fromId] : [];
    default:
      return [];
  }
}

function clamp(x: number, lo: number, hi: number): number {
  return Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : lo;
}
