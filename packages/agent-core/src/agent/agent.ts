import type {
  ActivityKind,
  AgentSeed,
  AgentState,
  Place,
  PlanItem,
  Spot,
  Weather,
} from "@lethetown/shared";
import type { LLMClient } from "../llm/client";
import { socialNote, type MemoryOwner, type SocialProfileStore } from "../memory/human";
import { reinforce } from "../memory/decay";
import {
  encodingStrength,
  eventArousal,
  overwhelmed,
  sleepDebt,
  sleepQuality,
} from "../memory/encoding";
import type { MemorySystem, RecallContext } from "../memory/memory-system";
import { dayDiaryText, dueHabits, habitText, recordDay } from "../memory/habits";
import { isYouthMemory } from "../memory/psychology";
import { recallText } from "../memory/retrieval";
import type { MemorySource } from "@lethetown/shared";
import { WorkingMemory } from "../memory/working-memory";
import { inferActivityKind } from "./activity";
import { newMind, type AgentMind } from "./mind";
import {
  baselineMood,
  blendPerceptions,
  describeMood,
  makeMood,
  stepMood,
  stepNeeds,
} from "./mood";
import type { MinorInfo } from "./minor-safety";
import { untrusted } from "./moderation";
import { DecideResponse, ImportanceResponse, PlanResponse, parseWith } from "./parse";
import { replanAt } from "./replan";
import {
  decidePrompt,
  formatClock,
  identityPrompt,
  importancePrompt,
  type PromptLanguage,
  parseClock,
  planPrompt,
  weatherLine,
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

/** Decisión del agente; `reason` es su razonamiento (si lo dio). */
export type Decision = (
  | { kind: "follow_plan" }
  | {
      kind: "react";
      action: string;
      activityKind: ActivityKind;
      placeId: string;
      spotId: string | null;
    }
  | { kind: "talk"; to: string; utterance: string }
) & { reason?: string };

export interface AgentDeps {
  llm: LLMClient;
  memory: MemorySystem;
  places: Place[];
  /** Idioma en el que habla y escribe (por mundo). Por defecto, español. */
  language?: PromptLanguage;
  /** Fichas sociales (lo que piensa de los demás). */
  social?: SocialProfileStore;
  /** Nombres de los demás agentes, para las notas sociales. */
  names?: Record<string, string>;
  /** Menores del pueblo, para la regla fija del prompt de identidad. */
  minors?: MinorInfo[];
  onError?: (agentId: string, task: string, error: unknown) => void;
}

export type DecideInput = Omit<
  DecideContext,
  | "now"
  | "locationId"
  | "action"
  | "moodLabel"
  | "needs"
  | "planItem"
  | "workingMemory"
  | "weather"
  | "innerVoice"
  | "doneToday"
> & {
  salient: boolean;
  /** El tiempo que hace; el agente describe cómo le afecta según dónde está. */
  weather: Weather;
  /** Voz interior recién recibida (texto del jugador, sin delimitar). */
  innerVoice?: string[];
};

const SLEEP_START = 22 * 60;
const DAY_START = 7 * 60;

/** Lo que deja el cierre del día (al dormirse): diario y hábitos. */
export interface DayEndReport {
  diaryMemoryId: string | null;
  habitsFormed: string[];
  habitsReinforced: string[];
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
  /** Estado interno persistente que no viaja al cliente (hábitos, diario). */
  mind: AgentMind = newMind();
  private readonly spots: Map<string, Spot>;

  constructor(
    readonly seed: AgentSeed,
    private readonly deps: AgentDeps,
  ) {
    this.id = seed.id;
    this.system = identityPrompt(seed, deps.places, deps.language, deps.minors);
    this.spots = new Map(deps.places.flatMap((p) => p.objects.map((o) => [o.id, o] as const)));
    const home = deps.places.find((p) => p.id === seed.homeId);
    if (!home) throw new Error(`${seed.id}: casa desconocida ${seed.homeId}`);
    const bed = this.bedSpot();
    const base = baselineMood(seed.personality, deps.memory.config.mood);
    const mood = makeMood(base.valence, base.arousal);
    this.state = {
      id: seed.id,
      name: seed.name,
      appearance: seed.appearance,
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

  get owner(): MemoryOwner {
    return { agentId: this.id, agentName: this.seed.name, system: this.system };
  }

  /** Contexto para que al recordar se pueda reconsolidar (ánimo y opiniones actuales). */
  recallContext(): RecallContext {
    return {
      system: this.system,
      moodLabel: describeMood(this.state.mood),
      socialSummary: async (people) => (await this.socialNotes(people)).join(" "),
    };
  }

  /** Notas de lo que piensa de esas personas (para el prompt). */
  async socialNotes(ids: string[]): Promise<string[]> {
    if (!this.deps.social) return [];
    const notes: string[] = [];
    for (const id of ids) {
      const profile = await this.deps.social.get(this.id, id);
      if (profile) notes.push(socialNote(profile, this.deps.names?.[id] ?? id));
    }
    return notes;
  }

  /** Su cama: un spot "sleep" de su casa con su id como dueño (o cualquiera de su casa). */
  bedSpot(): Spot | undefined {
    const home = this.deps.places.find((p) => p.id === this.seed.homeId);
    const beds = home?.objects.filter((o) => o.pose === "sleep") ?? [];
    return beds.find((b) => b.owner === this.id) ?? beds.find((b) => !b.owner);
  }

  /** El tiempo y cómo le afecta donde está ahora (bajo techo, a cubierto o a la intemperie). */
  weatherHere(weather: Weather): string {
    const place = this.deps.places.find((p) => p.id === this.state.locationId);
    const spot = this.spot(this.state.spotId);
    return weatherLine(weather, place?.indoor ?? true, spot?.shelter ?? false);
  }

  spot(id: string | null): Spot | undefined {
    return id ? this.spots.get(id) : undefined;
  }

  /** Guarda los recuerdos semánticos iniciales del archivo de semillas. */
  async seedMemories(now: number): Promise<void> {
    for (const text of this.seed.initialMemories) {
      await this.deps.memory.remember(
        {
          agentId: this.id,
          text,
          type: "semantic",
          importance: 6,
          source: "inferido",
          // Recuerdos de juventud: los mayores los conservan y evocan más (reminiscencia).
          meta: isYouthMemory(text) ? { youth: true } : {},
        },
        now,
      );
    }
  }

  /**
   * Anota en el diario de hoy (memoria a corto plazo, sin LLM ni recuerdo episódico) una
   * actividad que empieza, si no es la misma que la anterior. Con poca energía el diario falla:
   * a veces no la anota y a veces la anota en el lugar de la anterior (la mezcla).
   */
  noteActivity(now: number, activity: string, placeId: string): void {
    const log = this.state.doneToday ?? [];
    const last = log.at(-1);
    if (last && last.activity === activity && last.placeId === placeId) return;
    const cfg = this.deps.memory.config.diary;
    const energy = this.state.needs.energy;
    let where = placeId;
    if (energy < cfg.lowEnergy) {
      const tiredness = 1 - energy / cfg.lowEnergy;
      const r = this.deps.memory.rng();
      if (r < cfg.maxLossProbability * tiredness) return;
      if (last && r < (cfg.maxLossProbability + cfg.maxMixProbability) * tiredness) {
        where = last.placeId;
      }
    }
    this.state.doneToday = [
      ...log,
      { minute: Math.floor(now % 1440), activity, placeId: where },
    ].slice(-cfg.maxEntries);
  }

  /**
   * Cierre del día (al dormirse, sin LLM): el diario de hoy se guarda como un único recuerdo
   * ("El día N: …", con el olvido de siempre) y alimenta el rastreador de rutinas; lo que se
   * repite en varios días se convierte en un recuerdo semántico de hábito o lo refuerza.
   */
  async endDay(now: number, day: number): Promise<DayEndReport> {
    const report: DayEndReport = { diaryMemoryId: null, habitsFormed: [], habitsReinforced: [] };
    const entries = this.state.doneToday ?? [];
    if (!entries.length) return report;
    const memory = this.deps.memory;
    const cfg = memory.config;
    const placeName = (id: string) => this.deps.places.find((p) => p.id === id)?.name ?? id;
    const diary = await memory.tryRemember(
      {
        agentId: this.id,
        text: dayDiaryText(day, entries, placeName),
        type: "observation",
        importance: cfg.diary.dayImportance,
      },
      now,
    );
    if (diary) {
      report.diaryMemoryId = diary.id;
      this.mind.diaryMemoryIds = [...this.mind.diaryMemoryIds, diary.id].slice(-7);
    }
    if (!cfg.habits.enabled) return report;
    this.mind.habits = recordDay(this.mind.habits, entries, day, cfg.habits.windowDays);
    for (const h of dueHabits(this.mind.habits, day, cfg.habits.minDays)) {
      const existing = h.memoryId ? await memory.store.get(h.memoryId) : undefined;
      if (existing?.status === "active") {
        await memory.store.update(existing.id, {
          ...reinforce(existing, now, cfg.decay),
          forgottenAt: null,
        });
        await memory.audit({
          agentId: this.id,
          memoryId: existing.id,
          memoryText: existing.text,
          action: "reinforced",
          reason: `el hábito se repitió otra vez (${h.days.length} de los últimos ${cfg.habits.windowDays} días)`,
          at: now,
        });
        report.habitsReinforced.push(existing.text);
        continue;
      }
      const created = await memory.tryRemember(
        {
          agentId: this.id,
          text: habitText(h, placeName(h.placeId)),
          type: "semantic",
          source: "inferido",
          importance: cfg.habits.importance,
          placeId: h.placeId,
        },
        now,
      );
      if (!created) continue;
      h.memoryId = created.id;
      await memory.audit({
        agentId: this.id,
        memoryId: created.id,
        memoryText: created.text,
        action: "habit",
        reason: `"${h.activity}" en ${placeName(h.placeId)} se repitió ${h.days.length} de los últimos ${cfg.habits.windowDays} días: ya es una costumbre`,
        at: now,
      });
      report.habitsFormed.push(created.text);
    }
    return report;
  }

  /**
   * Lo que recuerda de ayer y de sus costumbres para planificar: el recuerdo del diario de ayer
   * y los hábitos, recordados con olvido y vaguedad (lo vago sale como esencia; lo olvidado, no).
   */
  private async recallYesterday(now: number): Promise<{ text: string; ids: string[] }> {
    const cfg = this.deps.memory.config.habits;
    const diary = this.mind.diaryMemoryIds.at(-1);
    const habits = Object.values(this.mind.habits)
      .map((h) => h.memoryId)
      .filter((id): id is string => Boolean(id));
    const recalled = await this.deps.memory.recallByIds(
      [...(diary ? [diary] : []), ...habits],
      now,
      this.state.mood.valence,
    );
    const yesterday = recalled.filter((s) => s.memory.id === diary);
    const customs = recalled
      .filter((s) => s.memory.id !== diary)
      .sort((a, b) => b.scores.strength - a.scores.strength)
      .slice(0, cfg.maxInPlan);
    return {
      text: [...yesterday, ...customs].map((s) => `- ${recallText(s)}`).join("\n"),
      ids: [...(diary ? [diary] : []), ...habits],
    };
  }

  /** "- HH:MM actividad (lugar)" de lo hecho hoy (o del diario que se le pase). */
  diaryText(log = this.state.doneToday ?? []): string {
    return log.map((d) => `- ${formatClock(d.minute)} ${d.activity} (${d.placeId})`).join("\n");
  }

  /** Cambio de planes: la nueva actividad entra en el plan del día desde ahora. */
  replan(
    now: number,
    change: Pick<PlanItem, "activity" | "activityKind" | "placeId" | "spotId">,
    minutes: number,
  ): void {
    this.state.plan = replanAt(this.state.plan, now % 1440, change, minutes);
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
  async planDay(now: number, weather: Weather = "sunny"): Promise<PlanItem[]> {
    // Lo que recuerda de ayer y sus costumbres orientan el plan de hoy; se empieza otro diario.
    const yesterday = await this.recallYesterday(now);
    this.state.doneToday = [];
    const recalled = await this.deps.memory.retrieve({
      agentId: this.id,
      query: `${this.seed.name}: qué quiero hacer hoy, mis rutinas y mis planes`,
      now,
      moodValence: this.state.mood.valence,
      k: 5,
      recall: this.recallContext(),
      exclude: yesterday.ids,
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
          weather,
          mood: describeMood(this.state.mood),
          yesterday: yesterday.text,
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
      for (const p of [...plan]) {
        if (!(await this.safe(p.activity, "plan"))) plan.splice(plan.indexOf(p), 1);
      }
      this.state.plan = plan.length ? plan : fallbackPlan(this.seed.homeId);
    } catch (error) {
      this.deps.onError?.(this.id, "plan", error);
      this.state.plan = fallbackPlan(this.seed.homeId);
    }
    await this.deps.memory.tryRemember(
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
    const felt: { importance: number; valence: number }[] = [];
    for (const [i, p] of perceptions.entries()) {
      const rating = ratings[i] ?? { importance: 2, valence: 0 };
      felt.push(rating);
      // Atención: lo que llega de fuera mientras habla con alguien se graba peor.
      const arousal = Math.max(
        this.state.mood.arousal,
        eventArousal(rating.importance, rating.valence),
      );
      const distracted =
        this.state.activityKind === "talk" && (p.kind === "arrived" || p.kind === "overheard");
      const record = await this.deps.memory.tryRemember(
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
          ...this.encoding(arousal, distracted),
        },
        now,
      );
      if (record) this.workingMemory.push({ text: record.text, memoryId: record.id, addedAt: now });
    }
    this.state.mood = blendPerceptions(
      this.state.mood,
      felt,
      this.deps.memory.config.mood.perceptionWeight,
    );
  }

  /** Nivel base del ánimo (según su personalidad). */
  get moodBaseline(): { valence: number; arousal: number } {
    const cfg = this.deps.memory.config;
    const base = baselineMood(this.seed.personality, cfg.mood);
    // Si durmió mal, ese día su nivel base está más bajo.
    return { ...base, valence: base.valence - cfg.sleep.debtValence * this.mind.sleepDebt };
  }

  /**
   * Fuerza inicial con la que graba algo ahora (atención y estado) y si solo le queda la
   * esencia (activación extrema). Ver memory/encoding.ts.
   */
  private encoding(
    arousal: number,
    distracted: boolean,
  ): { strength: number; meta?: { gistOnly: true } } {
    const cfg = this.deps.memory.config.encoding;
    const strength = encodingStrength(
      {
        arousal,
        energy: this.state.needs.energy,
        walking: this.state.activityKind === "walk",
        distracted,
        sleepDebt: this.mind.sleepDebt,
      },
      cfg,
    );
    return overwhelmed(arousal, cfg) ? { strength, meta: { gistOnly: true } } : { strength };
  }

  /**
   * Un recuerdo malo que vuelve sin querer (ver MemorySystem.intrude): entra en la memoria de
   * trabajo y tiñe el ánimo. Devuelve lo que le vino a la cabeza, o null.
   */
  async ruminate(now: number, minutes: number, present: string[]): Promise<string | null> {
    const memory = this.deps.memory;
    const hit = await memory.intrude({
      agentId: this.id,
      now,
      minutes,
      moodValence: this.state.mood.valence,
      neuroticism: this.seed.personality.neuroticism,
      placeId: this.state.locationId,
      present,
    });
    if (!hit) return null;
    const text = recallText(hit);
    this.workingMemory.push({
      text: `(sin querer, me vino a la cabeza) ${text}`,
      memoryId: hit.memory.id,
      addedAt: now,
    });
    const pull = memory.config.intrusive.moodPull;
    this.state.mood = makeMood(
      this.state.mood.valence + (hit.memory.emotionalValence - this.state.mood.valence) * pull,
      this.state.mood.arousal + (1 - this.state.mood.arousal) * pull,
    );
    return text;
  }

  /** Al acostarse: lo tenso o preocupado que esté decide cómo dormirá esta noche. */
  fallAsleep(): number {
    const cfg = this.deps.memory.config.sleep;
    this.mind.sleepQuality = sleepQuality(this.state.mood, this.seed.personality.neuroticism, cfg);
    return this.mind.sleepQuality;
  }

  /**
   * Al despertar: si no recuperó energía suficiente, arrastra una deuda de sueño ese día
   * (peor memoria y peor ánimo). Devuelve la deuda (0 = descansado).
   */
  wakeUp(): number {
    const cfg = this.deps.memory.config.sleep;
    const debt = sleepDebt(this.state.needs.energy, cfg);
    this.mind.sleepDebt = debt;
    this.mind.sleepQuality = 1;
    if (debt > 0) {
      this.state.mood = makeMood(
        this.state.mood.valence - cfg.debtValence * debt,
        this.state.mood.arousal,
      );
    }
    return debt;
  }

  /**
   * El cuerpo con el paso del tiempo (sin LLM): necesidades según lo que hace y su personalidad,
   * y ánimo que vuelve a su nivel base empujado por las necesidades.
   */
  live(minutes: number, alone: boolean): void {
    const cfg = this.deps.memory.config;
    const extraversion = this.seed.personality.extraversion;
    const kind = this.state.activityKind;
    this.state.needs = stepNeeds(
      this.state.needs,
      { kind, alone, extraversion, sleepQuality: this.mind.sleepQuality },
      minutes,
      cfg.needs,
    );
    this.state.mood = stepMood(
      this.state.mood,
      {
        needs: this.state.needs,
        sleeping: kind === "sleep",
        baseline: this.moodBaseline,
        extraversion,
      },
      minutes,
      cfg.mood,
    );
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
      recall: this.recallContext(),
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
          weather: this.weatherHere(input.weather),
          innerVoice: (input.innerVoice ?? []).map(untrusted),
          doneToday: this.diaryText(),
          now,
          locationId: this.state.locationId,
          action: this.state.action,
          moodLabel: describeMood(this.state.mood),
          needs: this.state.needs,
          planItem: this.currentPlanItem(now),
          workingMemory: this.workingMemory.render(),
        }),
      });
      return await this.checked(
        this.toDecision(parseWith(DecideResponse, res.text), input.present),
      );
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
    await this.deps.memory.tryRemember(
      {
        agentId: this.id,
        text: `Le dije a ${toName}: "${utterance}"`,
        type: "observation",
        importance: 3,
        people: [to],
        placeId: this.state.locationId,
        eventId: eventId ?? null,
        ...this.encoding(this.state.mood.arousal, false),
      },
      now,
    );
  }

  /** ¿Pasa la protección de menores? (sin guardián, siempre). */
  private async safe(
    text: string,
    kind: "speech" | "action" | "plan",
    actors: string[] = [],
  ): Promise<boolean> {
    const guard = this.deps.memory.guard;
    return !guard || guard.allows(text, { kind, actors: [this.id, ...actors], agentId: this.id });
  }

  /** Lo que la protección de menores descarta se convierte en seguir el plan. */
  private async checked(d: Decision): Promise<Decision> {
    const reason = d.reason ?? "";
    if (d.kind === "talk" && !(await this.safe(`${d.utterance} ${reason}`, "speech", [d.to]))) {
      return { kind: "follow_plan" };
    }
    if (d.kind === "react" && !(await this.safe(`${d.action} ${reason}`, "action"))) {
      return { kind: "follow_plan" };
    }
    if (d.kind === "follow_plan" && reason && !(await this.safe(reason, "action"))) {
      return { kind: "follow_plan" };
    }
    return d;
  }

  private validPlace(id: string | undefined): string | undefined {
    return id && this.deps.places.some((p) => p.id === id) ? id : undefined;
  }

  private toDecision(r: DecideResponse, present: { id: string }[]): Decision {
    const why = r.reason?.trim().slice(0, 240);
    const reason = why ? { reason: why } : {};
    if (r.choice === "talk" && r.to && r.say && present.some((p) => p.id === r.to)) {
      return { kind: "talk", to: r.to, utterance: r.say, ...reason };
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
        ...reason,
      };
    }
    return { kind: "follow_plan", ...reason };
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
      // La voz interior la escribe un jugador: va delimitada como dato no confiable.
      return `Pensé: ${untrusted(p.text)}`;
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
