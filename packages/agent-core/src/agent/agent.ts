import type { AgentSeed, AgentState, PlanItem, Spot, Weather } from "@lethetown/shared";
import { type MemoryOwner } from "../memory/human";
import type { RecallContext } from "../memory/memory-system";
import { WorkingMemory } from "../memory/working-memory";
import { newMind, type AgentMind } from "./mind";
import { type IntentionInput } from "../memory/prospective";
import { baselineMood, describeMood, makeMood } from "./mood";
import { replanAt } from "./replan";
import { formatClock, identityPrompt, weatherLine } from "./prompts";
import * as _social from "./agent-social";
import * as _intentions from "./agent-intentions";
import * as _planning from "./agent-planning";
import * as _body from "./agent-body";
import * as _perception from "./agent-perception";
import * as _decision from "./agent-decision";
import { fallbackPlan, SLEEP_START, DAY_START } from "./agent-planning";
import type {
  Perception,
  Decision,
  AgentDeps,
  DecideInput,
  IntentionOutcome,
  DayEndReport,
} from "./agent-types";

export * from "./agent-types";
export { fallbackPlan } from "./agent-planning";
export { describePerception } from "./agent-perception";

/**
 * Un habitante del pueblo. La clase es una fachada: el detalle vive en módulos (cuerpo y ánimo,
 * planificación y diario, percepción, decisión, intenciones y lo social) que reciben el agente.
 */
export class Agent {
  readonly id: string;
  readonly system: string;
  readonly workingMemory = new WorkingMemory();
  state: AgentState;
  /** Estado interno persistente que no viaja al cliente (hábitos, diario). */
  mind: AgentMind = newMind();
  readonly spots: Map<string, Spot>;

  constructor(
    readonly seed: AgentSeed,
    readonly deps: AgentDeps,
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
  socialNotes(ids: string[]): Promise<string[]> {
    return _social.socialNotes(this, ids);
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
  seedMemories(now: number): Promise<void> {
    return _planning.seedMemories(this, now);
  }

  /** Siembra lo que piensa de los demás al empezar (relaciones de las semillas). */
  seedRelationships(now: number): Promise<void> {
    return _social.seedRelationships(this, now);
  }

  /** Mera exposición: anota el tiempo que pasa en el mismo sitio que otros (sin LLM). */
  noteCompany(present: string[], minutes: number): void {
    return _social.noteCompany(this, present, minutes);
  }

  /**
   * Se propone hacer algo más adelante (memoria prospectiva): un recuerdo de tipo `intention`
   * con sus pistas (persona, lugar, hora) que se lleva en la cabeza (`mind.intentions`).
   * Devuelve false si no se guarda (repetida, protección de menores, desactivado).
   */
  intend(now: number, input: IntentionInput): Promise<string | null> {
    return _intentions.intend(this, now, input);
  }

  /** Repasa una intención (mirar la agenda la refuerza). */
  rehearseIntention(memoryId: string, now: number): Promise<boolean> {
    return _intentions.rehearseIntention(this, memoryId, now);
  }

  /** Intenta recordar ahora una intención concreta (una cita…). Devuelve si se acordó. */
  recallIntentionNow(memoryId: string, now: number): Promise<boolean> {
    return _intentions.recallIntentionNow(this, memoryId, now);
  }

  /**
   * Memoria prospectiva en cada tick (sin LLM): con la pista delante (la persona, el lugar o la
   * hora) se acuerda o no; si se le pasan varias ocasiones, se le olvida, y quizá más tarde cae
   * en la cuenta. Lo que recuerda le llega como percepción para que decida qué hacer.
   */
  checkIntentions(now: number, minutes: number, present: string[]): Promise<IntentionOutcome[]> {
    return _intentions.checkIntentions(this, now, minutes, present);
  }

  /**
   * Anota en el diario de hoy (memoria a corto plazo, sin LLM ni recuerdo episódico) una
   * actividad que empieza, si no es la misma que la anterior. Con poca energía el diario falla:
   * a veces no la anota y a veces la anota en el lugar de la anterior (la mezcla).
   */
  noteActivity(now: number, activity: string, placeId: string): void {
    return _planning.noteActivity(this, now, activity, placeId);
  }

  /**
   * Cierre del día (al dormirse, sin LLM): el diario de hoy se guarda como un único recuerdo
   * ("El día N: …", con el olvido de siempre) y alimenta el rastreador de rutinas; lo que se
   * repite en varios días se convierte en un recuerdo semántico de hábito o lo refuerza.
   */
  endDay(now: number, day: number): Promise<DayEndReport> {
    return _planning.endDay(this, now, day);
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
  /** Planifica el día; `fixed` son compromisos (citas) que el plan debe respetar. */
  planDay(now: number, weather: Weather = "sunny", fixed: PlanItem[] = []): Promise<PlanItem[]> {
    return _planning.planDay(this, now, weather, fixed);
  }

  /** Percibir → guardar: convierte percepciones en recuerdos con importancia y valencia. */
  perceive(perceptions: Perception[], now: number): Promise<void> {
    return _perception.perceive(this, perceptions, now);
  }

  /** Nivel base del ánimo (según su personalidad). */
  get moodBaseline(): { valence: number; arousal: number } {
    return _body.moodBaseline(this);
  }

  /**
   * Un recuerdo malo que vuelve sin querer (ver MemorySystem.intrude): entra en la memoria de
   * trabajo y tiñe el ánimo. Devuelve lo que le vino a la cabeza, o null.
   */
  ruminate(now: number, minutes: number, present: string[]): Promise<string | null> {
    return _body.ruminate(this, now, minutes, present);
  }

  /** Al acostarse: lo tenso o preocupado que esté decide cómo dormirá esta noche. */
  fallAsleep(): number {
    return _body.fallAsleep(this);
  }

  /**
   * Al despertar: si no recuperó energía suficiente, arrastra una deuda de sueño ese día
   * (peor memoria y peor ánimo). Devuelve la deuda (0 = descansado).
   */
  wakeUp(): number {
    return _body.wakeUp(this);
  }

  /**
   * El cuerpo con el paso del tiempo (sin LLM): necesidades según lo que hace y su personalidad,
   * y ánimo que vuelve a su nivel base empujado por las necesidades.
   */
  live(minutes: number, alone: boolean): void {
    return _body.live(this, minutes, alone);
  }

  /** Decidir: seguir el plan, reaccionar o hablar. Solo llama al LLM si hay algo saliente. */
  decide(now: number, input: DecideInput): Promise<Decision> {
    return _decision.decide(this, now, input);
  }

  /** Guarda lo que el propio agente ha dicho. */
  rememberOwnSpeech(to: string, toName: string, utterance: string, now: number, eventId?: string) {
    return _perception.rememberOwnSpeech(this, to, toName, utterance, now, eventId);
  }

  validPlace(id: string | undefined): string | undefined {
    return id && this.deps.places.some((p) => p.id === id) ? id : undefined;
  }
}
