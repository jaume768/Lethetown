/**
 * Metas (sistema `goals`): el LLM propone y redacta; el motor valida, mide y decide. Cada meta
 * tiene un criterio del catálogo (shared/schemas/goals.ts) que se cuenta aquí: por eventos
 * (charlas, citas, objetos, notas, intenciones, descubrimientos), por revisiones periódicas (horas
 * en un sitio o haciendo algo, visitas) y por la ficha social (relaciones). La psicología
 * (motivación, frustración, abandono, cambio de rumbo) es de agent-core y corre por la noche.
 * Ver docs/decisiones/metas.md.
 */
import {
  abandonProbability,
  applySocialUpdate,
  CRITERIA_CATALOG as CRITERIA,
  criterionCues,
  criterionText,
  frustrationMood,
  goalDay,
  lifeChangeProbability,
  makeMood,
  measuredProgress,
  normalizeText,
  relationshipBaseline,
  relationshipProgress,
  type Agent,
  type GoalsConfig,
} from "@lethetown/agent-core";
import {
  AWAY_LOCATION,
  GoalCriterion,
  seedIsMinor,
  type Departure,
  type Goal,
  type GoalLevel,
  type SeedGoal,
  type SimEvent,
} from "@lethetown/shared";
import { z } from "zod";
import {
  InMemoryDepartureStore,
  InMemoryGoalStore,
  type DepartureStore,
  type GoalStore,
} from "../db/goals";
import { runAction } from "./actions";
import { stopFollowing } from "./company";
import { errorMessage, type SimContext } from "./context";
import { activeConversationOf, leaveConversation } from "./conversations";
import { itemsState, saveItem } from "./items";
import { openMeetingsOf } from "./meetings";
import { setAction } from "./routines";

/** Proyectos de más (sobre los de la semilla) que pide una meta vital de partida. */
const EXTRA_PROJECTS = 2;
/** Historial por meta (lo más antiguo se descarta). */
const MAX_HISTORY = 60;
/** Lo ya contado por meta (personas y conversaciones). */
const MAX_SEEN = 80;
/** Tras sacar el proyecto en una decisión, no vuelve a salir en este rato (min de juego). */
const DECIDE_COOLDOWN = 120;

export interface GoalsState {
  goals: Map<string, Goal>;
  seq: number;
  store: GoalStore;
  departureStore: DepartureStore;
  departures: Map<string, Departure>;
  /** Dónde estaba cada uno en la última revisión (para contar visitas). */
  lastPlace: Map<string, string>;
  /** Parejas de metas en conflicto ya detectadas ("g3|g7"). */
  conflicts: Set<string>;
  /** Cuándo se le mostró su proyecto en una decisión. */
  shownAt: Map<string, number>;
  listening: boolean;
}

export const goalsState = (ctx: SimContext) =>
  ctx.state<GoalsState>("goals", () => ({
    goals: new Map(),
    seq: 0,
    store: ctx.deps.goals ?? new InMemoryGoalStore(),
    departureStore: ctx.deps.departures ?? new InMemoryDepartureStore(),
    departures: new Map(),
    lastPlace: new Map(),
    conflicts: new Set(),
    shownAt: new Map(),
    listening: false,
  }));

const cfgOf = (ctx: SimContext): GoalsConfig => ctx.deps.memory.config.goals;
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const nameOf = (ctx: SimContext, id: string) => ctx.agents.get(id)?.seed.name ?? id;
const firstName = (ctx: SimContext, id: string) => nameOf(ctx, id).split(" ")[0]!;
const placeName = (ctx: SimContext, id: string) =>
  ctx.world.has(id) ? ctx.world.place(id).name : id;
const names = (ctx: SimContext) => ({
  person: (id: string) => nameOf(ctx, id),
  place: (id: string) => placeName(ctx, id),
});

export function goalsOf(ctx: SimContext, agentId: string, status?: Goal["status"]): Goal[] {
  return [...goalsState(ctx).goals.values()].filter(
    (g) => g.agentId === agentId && (!status || g.status === status),
  );
}

/** ¿Está fuera del pueblo (se fue y no está de visita)? */
export function isAway(ctx: SimContext, agentId: string): boolean {
  const d = goalsState(ctx).departures.get(agentId);
  return !!d && !d.visiting;
}

/** Un recuerdo que deja una meta (por la protección de menores, como todos). */
function remember(
  ctx: SimContext,
  input: Parameters<SimContext["deps"]["memory"]["tryRemember"]>[0],
  now: number,
): void {
  ctx.deps.track?.(
    ctx.deps.memory
      .tryRemember(input, now)
      .catch((e: unknown) =>
        ctx.emit("system", input.agentId, `⚠ No se pudo guardar el recuerdo: ${errorMessage(e)}`),
      ),
  );
}

function persist(ctx: SimContext, goal: Goal): void {
  ctx.deps.track?.(
    goalsState(ctx)
      .store.upsert(goal)
      .catch((e: unknown) =>
        ctx.emit("system", goal.agentId, `⚠ No se pudo guardar la meta: ${errorMessage(e)}`),
      ),
  );
}

function persistDeparture(ctx: SimContext, d: Departure): void {
  ctx.deps.track?.(
    goalsState(ctx)
      .departureStore.upsert(d)
      .catch((e: unknown) =>
        ctx.emit("system", d.agentId, `⚠ No se pudo guardar la partida: ${errorMessage(e)}`),
      ),
  );
}

function audit(ctx: SimContext, goal: Pick<Goal, "agentId" | "id" | "text">, reason: string) {
  ctx.deps.track?.(
    ctx.deps.memory.audit({
      agentId: goal.agentId,
      memoryId: `goal:${goal.id}`,
      memoryText: goal.text,
      action: "goal",
      reason,
      at: ctx.clock.now(),
    }),
  );
}

function historyEntry(goal: Goal, now: number, reason: string): void {
  goal.history = [
    ...goal.history,
    {
      at: now,
      status: goal.status,
      progress: round(goal.progress),
      motivation: round(goal.motivation),
      frustration: round(goal.frustration),
      reason,
    },
  ].slice(-MAX_HISTORY);
  goal.updatedAt = now;
}

const round = (x: number) => Math.round(x * 1000) / 1000;

// --- Crear y validar --------------------------------------------------------------------

export interface GoalInput {
  level: GoalLevel;
  parentId: string | null;
  text: string;
  criterion: GoalCriterion;
  resource?: string | null;
  departure?: { to: string } | null;
}

/**
 * ¿Se puede crear? El motor manda: que se pueda medir con lo que existe (personas y lugares
 * reales), dentro de los topes, y la protección de menores (nada romántico; un menor no puede
 * tener como meta estar en casas ajenas ni irse ahora). Devuelve el motivo si no.
 */
export function goalProblem(ctx: SimContext, agent: Agent, input: GoalInput): string | null {
  const c = input.criterion;
  const cfg = cfgOf(ctx);
  const minor = seedIsMinor(agent.seed);
  const text = input.text.trim();
  if (text.length < 4) return "la meta no dice nada";
  if (text.length > 200) return "la meta es demasiado larga";
  if ("personId" in c && c.personId !== undefined) {
    if (c.personId === agent.id) return "una meta con uno mismo no se puede medir";
    const other = ctx.agents.get(c.personId);
    if (!other) return `no hay nadie con el id ${c.personId}`;
  }
  if ("placeId" in c && c.placeId !== undefined) {
    if (!ctx.world.has(c.placeId)) return `no hay ningún lugar ${c.placeId}`;
    const place = ctx.world.place(c.placeId);
    // Menores: nada en casas ajenas (solo la suya; lo demás, sitios públicos).
    if (minor && place.kind === "home" && place.id !== agent.seed.homeId) {
      return "un menor no puede tener como meta estar en una casa ajena";
    }
  }
  if (c.type === "relationship" && !c.affinity && !c.trust && !c.relationship) {
    return "una meta de relación necesita afinidad, confianza o tipo de relación";
  }
  if (c.type === "projects" && input.level !== "life")
    return "solo una meta vital cuenta proyectos";
  if (input.level !== "life" && c.type === "projects") return "criterio no válido para un proyecto";
  if (input.departure && input.level !== "life") return "irse del pueblo es una meta vital";
  if (input.level === "life" && goalsOf(ctx, agent.id, "active").some((g) => g.level === "life")) {
    return "ya tiene una meta vital";
  }
  if (input.level === "project") {
    if (
      goalsOf(ctx, agent.id, "active").filter((g) => g.level === "project").length >=
      cfg.maxActiveProjects
    ) {
      return `ya tiene ${cfg.maxActiveProjects} proyectos activos`;
    }
  }
  if (input.level === "step") {
    const parent = input.parentId ? goalsState(ctx).goals.get(input.parentId) : undefined;
    if (!parent || parent.agentId !== agent.id || parent.level !== "project") {
      return "un paso tiene que ser de uno de sus proyectos";
    }
    const steps = goalsOf(ctx, agent.id, "active").filter((g) => g.parentId === parent.id);
    if (steps.length >= cfg.maxStepsPerProject) return "ese proyecto ya tiene bastantes pasos";
  }
  if (input.level === "project" && input.parentId) {
    const parent = goalsState(ctx).goals.get(input.parentId);
    if (!parent || parent.agentId !== agent.id || parent.level !== "life") {
      return "un proyecto cuelga de su meta vital";
    }
  }
  const dup = goalsOf(ctx, agent.id, "active").some(
    (g) => normalizeText(g.text) === normalizeText(text),
  );
  if (dup) return "ya tiene esa meta";
  return null;
}

/** Crea una meta ya validada (y pasada por la protección de menores). Null si no se pudo. */
export async function createGoal(
  ctx: SimContext,
  agent: Agent,
  input: GoalInput,
  now: number,
  reason: string,
): Promise<Goal | null> {
  const problem = goalProblem(ctx, agent, input);
  if (problem) {
    audit(ctx, { agentId: agent.id, id: "nueva", text: input.text }, `meta descartada: ${problem}`);
    return null;
  }
  // Lo que escribe el LLM entra en el mundo: protección de menores (y registro de conocimiento).
  const guard = ctx.deps.memory.guard;
  const people =
    "personId" in input.criterion && input.criterion.personId ? [input.criterion.personId] : [];
  if (
    guard &&
    !(await guard.allows(input.text, {
      kind: "plan",
      actors: [agent.id, ...people],
      agentId: agent.id,
    }))
  ) {
    audit(
      ctx,
      { agentId: agent.id, id: "nueva", text: input.text },
      "meta descartada por la protección de menores",
    );
    return null;
  }
  const s = goalsState(ctx);
  const c = input.criterion;
  const profile =
    c.type === "relationship" ? await ctx.deps.social.get(agent.id, c.personId) : undefined;
  const goal: Goal = {
    id: `g${++s.seq}`,
    agentId: agent.id,
    level: input.level,
    parentId: input.parentId,
    text: input.text.trim(),
    status: "active",
    progress: 0,
    motivation: cfgOf(ctx).initialMotivation,
    frustration: 0,
    criterion: c,
    measured: 0,
    baseline: c.type === "relationship" ? relationshipBaseline(c, profile) : null,
    seen: [],
    resource: input.resource ?? null,
    departure: input.departure ?? null,
    createdAt: now,
    updatedAt: now,
    lastProgressAt: now,
    history: [],
  };
  if (c.type === "relationship") {
    goal.progress = relationshipProgress(c, profile, goal.baseline);
    // Una meta que ya se cumple no es una meta (afinidad o confianza ya alcanzadas).
    if (goal.progress >= 1) {
      s.seq--;
      audit(ctx, goal, "meta descartada: ya se cumple (la ficha social ya llega a eso)");
      return null;
    }
  }
  historyEntry(goal, now, reason);
  s.goals.set(goal.id, goal);
  persist(ctx, goal);
  // Lo sabe: la meta vital y los proyectos quedan como recuerdo (con el olvido de siempre).
  if (goal.level !== "step") {
    remember(
      ctx,
      {
        agentId: agent.id,
        text: `Me he propuesto: ${goal.text}.`,
        type: "semantic",
        source: "vivido",
        importance: goal.level === "life" ? 8 : 6,
        emotionalValence: 0.2,
      },
      now,
    );
  }
  audit(ctx, goal, `nueva meta (${goal.level}): ${reason}`);
  return goal;
}

/** Siembra las metas iniciales de la semilla (vital, proyectos y pasos). */
export async function seedGoals(ctx: SimContext, agent: Agent, seed: SeedGoal, now: number) {
  const life = await createGoal(
    ctx,
    agent,
    {
      level: "life",
      parentId: null,
      text: seed.text,
      // Una meta vital es de largo recorrido: hacen falta más proyectos de los de partida (los
      // irá proponiendo al repasar sus días).
      criterion: { type: "projects", count: seed.needs ?? seed.projects.length + EXTRA_PROJECTS },
      departure: seed.departure ?? null,
    },
    now,
    "meta de partida",
  );
  if (!life) return;
  for (const p of seed.projects) {
    const project = await createGoal(
      ctx,
      agent,
      {
        level: "project",
        parentId: life.id,
        text: p.text,
        criterion: p.criterion,
        resource: p.resource ?? null,
      },
      now,
      "proyecto de partida",
    );
    if (!project) continue;
    for (const st of p.steps) {
      await createGoal(
        ctx,
        agent,
        { level: "step", parentId: project.id, text: st.text, criterion: st.criterion },
        now,
        "paso de partida",
      );
    }
  }
}

// --- Medir --------------------------------------------------------------------------------

/** Suma a lo medido de las metas activas de alguien que encajan (`matches`) y recalcula. */
function count(
  ctx: SimContext,
  agentId: string,
  now: number,
  matches: (c: GoalCriterion, g: Goal) => boolean | string,
  amount = 1,
): void {
  for (const g of goalsOf(ctx, agentId, "active")) {
    const hit = matches(g.criterion, g);
    if (!hit) continue;
    // Una clave: se cuenta una vez (la misma conversación, la misma persona).
    if (typeof hit === "string") {
      if (g.seen.includes(hit)) continue;
      g.seen = [...g.seen, hit].slice(-MAX_SEEN);
    }
    g.measured += amount;
    refresh(ctx, g, now);
  }
}

/** Lo que pasa en el pueblo y cuenta para las metas. */
export function goalsOnEvent(ctx: SimContext, e: SimEvent): void {
  const now = e.time;
  const ok = e.meta?.ok === true;
  const action = e.meta?.action;
  if (e.kind === "speech" && e.agentId && e.participants[1]) {
    const conv = e.id.includes(":") ? e.id.slice(0, e.id.lastIndexOf(":")) : e.id;
    const a = e.agentId;
    const b = e.participants[1];
    const place = ctx.agents.get(a)?.state.locationId;
    for (const [me, other] of [
      [a, b],
      [b, a],
    ] as const) {
      count(ctx, me, now, (c) => {
        if (c.type !== "conversations") return false;
        if (c.personId && c.personId !== other) return false;
        if (c.placeId && c.placeId !== place) return false;
        // Con N personas distintas: cuenta cada persona una vez; si no, cada conversación.
        return c.people ? `p:${other}` : `c:${conv}`;
      });
    }
    return;
  }
  if (action === "meeting" && ok && e.text.startsWith("🤝")) {
    for (const me of e.participants) {
      for (const other of e.participants.filter((x) => x !== me)) {
        count(ctx, me, now, (c) => {
          if (c.type !== "meetings") return false;
          if (c.personId && c.personId !== other) return false;
          return c.people ? `p:${other}` : `m:${e.id}`;
        });
      }
    }
    return;
  }
  if (!e.agentId) return;
  if (ok && action && ["use_object", "return_item", "give_item", "lend_item"].includes(action)) {
    count(ctx, e.agentId, now, (c) => c.type === "items" && c.action === action);
  } else if (ok && (action === "post_note" || action === "leave_note")) {
    count(ctx, e.agentId, now, (c) => c.type === "notes");
  } else if (ok && action === "discover") {
    count(ctx, e.agentId, now, (c) => c.type === "places_discovered");
  } else if (e.kind === "memory" && e.text.startsWith("✅")) {
    count(ctx, e.agentId, now, (c) => c.type === "intentions_kept");
  }
}

/** Revisión periódica (5 min): horas en un sitio o haciendo algo, y visitas. */
export function measureTick(ctx: SimContext, now: number, minutes: number): void {
  const s = goalsState(ctx);
  for (const agent of ctx.agents.values()) {
    if (isAway(ctx, agent.id)) continue;
    const rt = ctx.rt(agent.id);
    const here = agent.state.locationId;
    const asleep = agent.state.activityKind === "sleep";
    if (!rt.travelling && !asleep) {
      const action = normalizeText(agent.state.action);
      count(ctx, agent.id, now, (c) => c.type === "place_time" && c.placeId === here, minutes);
      count(
        ctx,
        agent.id,
        now,
        (c) =>
          c.type === "activity_hours" && c.keywords.some((k) => action.includes(normalizeText(k))),
        minutes,
      );
      if (s.lastPlace.get(agent.id) !== here) {
        s.lastPlace.set(agent.id, here);
        count(ctx, agent.id, now, (c) => c.type === "visits" && c.placeId === here);
      }
    }
  }
}

/** Metas de relación: según la ficha social de ahora (cada hora). */
export async function relationshipTick(ctx: SimContext, now: number): Promise<void> {
  for (const g of [...goalsState(ctx).goals.values()]) {
    const c = g.criterion;
    if (g.status !== "active" || c.type !== "relationship") continue;
    const profile = await ctx.deps.social.get(g.agentId, c.personId);
    const p = relationshipProgress(c, profile, g.baseline);
    if (p !== g.progress) setProgress(ctx, g, p, now);
  }
}

/** Recalcula el progreso de una meta medida por cuenta u horas. */
function refresh(ctx: SimContext, g: Goal, now: number): void {
  if (g.criterion.type === "relationship" || g.criterion.type === "projects") return;
  setProgress(ctx, g, measuredProgress(g.criterion, g.measured), now);
}

function setProgress(ctx: SimContext, g: Goal, progress: number, now: number): void {
  const p = clamp01(progress);
  if (p > g.progress) g.lastProgressAt = now;
  g.progress = p;
  g.updatedAt = now;
  if (p >= 1 && g.status === "active") {
    achieve(ctx, g, now);
    return;
  }
  persist(ctx, g);
  if (g.parentId) refreshParent(ctx, g.parentId, now);
}

/** Una meta vital avanza con sus proyectos (los conseguidos cuentan entero). */
function refreshParent(ctx: SimContext, parentId: string, now: number): void {
  const parent = goalsState(ctx).goals.get(parentId);
  if (!parent || parent.status !== "active" || parent.criterion.type !== "projects") return;
  const kids = [...goalsState(ctx).goals.values()].filter(
    (g) => g.parentId === parent.id && g.status !== "abandoned",
  );
  const sum = kids.reduce((a, k) => a + (k.status === "achieved" ? 1 : k.progress), 0);
  setProgress(ctx, parent, sum / parent.criterion.count, now);
}

// --- Conseguir, abandonar, aplazar --------------------------------------------------------

function moodBy(agent: Agent, delta: number): void {
  if (!delta) return;
  const m = agent.state.mood;
  agent.state.mood = makeMood(Math.max(-1, Math.min(1, m.valence + delta)), m.arousal);
}

const LEVEL_LABEL: Record<GoalLevel, string> = {
  life: "su meta vital",
  project: "su proyecto",
  step: "un paso",
};

function achieve(ctx: SimContext, g: Goal, now: number): void {
  const agent = ctx.agents.get(g.agentId);
  if (!agent) return;
  const cfg = cfgOf(ctx);
  // Irse del pueblo: un menor no puede; la meta queda aplazada hasta que sea mayor de edad.
  if (g.departure && seedIsMinor(agent.seed)) {
    g.status = "postponed";
    historyEntry(g, now, "preparada, pero aún es menor de edad: queda aplazada hasta que lo sea");
    persist(ctx, g);
    audit(ctx, g, "meta de irse del pueblo aplazada: es menor de edad");
    ctx.rt(agent.id).pending.push({
      kind: "thought",
      text: `Ya lo tengo todo para ${g.text.toLowerCase()}, pero aún no tengo edad: tendrá que esperar.`,
    });
    return;
  }
  g.status = "achieved";
  g.motivation = clamp01(g.motivation + 0.2);
  g.frustration = 0;
  historyEntry(g, now, "conseguida (el motor midió el criterio)");
  persist(ctx, g);
  audit(ctx, g, `conseguida: ${criterionText(g.criterion, g.measured, names(ctx))}`);
  moodBy(agent, cfg.achievedMood);
  ctx.emit(
    "action",
    agent.id,
    `🏆 ${agent.seed.name} consigue ${LEVEL_LABEL[g.level]}: «${g.text}»`,
    [agent.id],
    undefined,
    { action: g.level === "life" ? "goal_life" : "goal", ok: true },
  );
  ctx
    .rt(agent.id)
    .pending.push({ kind: "world", text: `¡Lo he conseguido!: ${g.text}.`, placeId: null });
  remember(
    ctx,
    {
      agentId: agent.id,
      text: `Lo conseguí: ${g.text}.`,
      type: "semantic",
      source: "vivido",
      importance: g.level === "life" ? 9 : 7,
      emotionalValence: 0.6,
    },
    now,
  );
  // Quien quería lo contrario (metas en conflicto) lo nota.
  for (const other of rivalsOf(ctx, g)) {
    other.frustration = clamp01(other.frustration + 0.3);
    historyEntry(other, now, `${nameOf(ctx, g.agentId)} consiguió lo suyo a costa de esto`);
    persist(ctx, other);
    void applySocialUpdate(ctx.deps.social, {
      ownerId: other.agentId,
      aboutId: g.agentId,
      affinityDelta: -0.1,
      now,
      reason: `se salió con la suya: «${g.text}»`,
      config: ctx.deps.memory.config.social,
    });
  }
  if (g.parentId) refreshParent(ctx, g.parentId, now);
  if (g.level === "life" && g.departure) depart(ctx, agent, g, now);
}

export function abandonGoal(ctx: SimContext, g: Goal, now: number, reason: string): void {
  const agent = ctx.agents.get(g.agentId);
  if (!agent || g.status === "abandoned" || g.status === "achieved") return;
  g.status = "abandoned";
  g.frustration = clamp01(g.frustration - 0.3);
  historyEntry(g, now, `abandonada: ${reason}`);
  persist(ctx, g);
  audit(ctx, g, `abandonada: ${reason}`);
  moodBy(agent, -cfgOf(ctx).abandonedMood);
  ctx.emit(
    "action",
    agent.id,
    `🏳 ${agent.seed.name} abandona ${LEVEL_LABEL[g.level]}: «${g.text}» (${reason})`,
    [agent.id],
    undefined,
    { action: g.level === "life" ? "goal_life" : "goal", ok: false },
  );
  // Sus proyectos y pasos se quedan sin sentido.
  for (const kid of goalsOf(ctx, g.agentId, "active").filter((k) => k.parentId === g.id)) {
    abandonGoal(ctx, kid, now, "ya no persigue la meta de la que colgaba");
  }
  if (g.parentId) refreshParent(ctx, g.parentId, now);
}

function setStatus(ctx: SimContext, g: Goal, status: Goal["status"], now: number, reason: string) {
  g.status = status;
  historyEntry(g, now, reason);
  persist(ctx, g);
  audit(ctx, g, reason);
}

// --- Conflictos -----------------------------------------------------------------------------

/** Metas activas de otros que compiten por lo mismo (mismo `resource`). */
function rivalsOf(ctx: SimContext, g: Goal): Goal[] {
  if (!g.resource) return [];
  return [...goalsState(ctx).goals.values()].filter(
    (o) => o.status === "active" && o.agentId !== g.agentId && o.resource === g.resource,
  );
}

/** Detecta las metas en conflicto nuevas y lo refleja en las fichas sociales (y un drama). */
export async function detectConflicts(ctx: SimContext, now: number): Promise<void> {
  const s = goalsState(ctx);
  for (const g of s.goals.values()) {
    if (g.status !== "active") continue;
    for (const o of rivalsOf(ctx, g)) {
      const key = [g.id, o.id].sort().join("|");
      if (s.conflicts.has(key)) continue;
      s.conflicts.add(key);
      ctx.emit(
        "action",
        g.agentId,
        `⚔ Las metas de ${firstName(ctx, g.agentId)} y ${firstName(ctx, o.agentId)} chocan: «${g.text}» frente a «${o.text}»`,
        [g.agentId, o.agentId],
        undefined,
        { action: "goal_conflict", ok: true },
      );
      for (const [me, them] of [
        [g, o],
        [o, g],
      ] as const) {
        await applySocialUpdate(ctx.deps.social, {
          ownerId: me.agentId,
          aboutId: them.agentId,
          affinityDelta: -0.05,
          now,
          reason: `quiere lo contrario que yo: «${them.text}»`,
          config: ctx.deps.memory.config.social,
        });
      }
    }
  }
}

// --- La noche: psicología y lo que propone el modelo --------------------------------------

export const GoalProposal = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("add"),
    level: z.enum(["life", "project", "step"]),
    parent: z.string().nullish(),
    text: z.string(),
    criterion: GoalCriterion,
    resource: z.string().max(40).nullish(),
  }),
  z.object({
    op: z.enum(["postpone", "abandon", "resume"]),
    id: z.string(),
    reason: z.string().default(""),
  }),
]);
export type GoalProposal = z.infer<typeof GoalProposal>;

/** Repaso nocturno de las metas de un agente (sin LLM): motivación, frustración, ánimo, azar. */
export function reviewNight(ctx: SimContext, agent: Agent, now: number): void {
  const cfg = cfgOf(ctx);
  if (!cfg.enabled) return;
  const rng = ctx.deps.rng;
  const p = agent.seed.personality;
  let mood = 0;
  const active = goalsOf(ctx, agent.id, "active");
  for (const g of active) {
    const last = g.history.at(-1);
    const gained = Math.max(0, g.progress - (last?.progress ?? 0));
    const stagnant = (now - g.lastProgressAt) / 1440;
    const r = goalDay(g, gained, stagnant, p, cfg);
    g.motivation = r.motivation;
    g.frustration = r.frustration;
    mood += r.moodDelta;
    historyEntry(g, now, `repaso nocturno: ${r.reason}`);
    persist(ctx, g);
    if (gained > 0 || stagnant >= cfg.stagnantAfterDays) audit(ctx, g, r.reason);
    // Abandonar (proyectos y pasos) o cambiar de rumbo (la vital), según cómo es.
    const chance =
      g.level === "life"
        ? lifeChangeProbability(g.frustration, p, agent.seed.age, cfg)
        : abandonProbability(g.frustration, p, cfg);
    if (chance > 0 && rng() < chance) {
      const why =
        g.level === "life"
          ? `cambio de rumbo tras mucha frustración (apertura ${p.openness.toFixed(2)}, ${agent.seed.age} años)`
          : `frustración ${g.frustration.toFixed(2)} (responsabilidad ${p.conscientiousness.toFixed(2)}, neuroticismo ${p.neuroticism.toFixed(2)})`;
      abandonGoal(ctx, g, now, why);
    }
  }
  mood += frustrationMood(
    goalsOf(ctx, agent.id, "active").map((g) => g.frustration),
    cfg,
  );
  moodBy(agent, mood);
}

/** Aplica lo que propuso el modelo al consolidar (el motor valida cada cosa). */
export async function applyProposals(
  ctx: SimContext,
  agent: Agent,
  raw: unknown,
  now: number,
): Promise<void> {
  if (!Array.isArray(raw)) return;
  const hadLife = goalsOf(ctx, agent.id).some(
    (g) => g.level === "life" && g.status === "abandoned",
  );
  for (const item of raw.slice(0, 4)) {
    const parsed = GoalProposal.safeParse(item);
    if (!parsed.success) {
      audit(
        ctx,
        { agentId: agent.id, id: "nueva", text: JSON.stringify(item).slice(0, 120) },
        "propuesta descartada: no es medible con el catálogo",
      );
      continue;
    }
    const prop = parsed.data;
    if (prop.op === "add") {
      const parentId =
        prop.level === "life"
          ? null
          : (prop.parent ??
            (prop.level === "project"
              ? (goalsOf(ctx, agent.id, "active").find((g) => g.level === "life")?.id ?? null)
              : null));
      const created = await createGoal(
        ctx,
        agent,
        {
          level: prop.level,
          parentId,
          text: prop.text,
          criterion: prop.criterion,
          resource: prop.resource ?? null,
        },
        now,
        "la propuso al repasar el día",
      );
      if (created?.level === "life" && hadLife) {
        ctx.emit(
          "action",
          agent.id,
          `🔄 ${agent.seed.name} cambia de rumbo: «${created.text}»`,
          [agent.id],
          undefined,
          { action: "goal_life_change", ok: true },
        );
      }
      continue;
    }
    const g = goalsState(ctx).goals.get(prop.id);
    if (!g || g.agentId !== agent.id) {
      audit(
        ctx,
        { agentId: agent.id, id: prop.id, text: prop.id },
        `propuesta descartada: no tiene la meta ${prop.id}`,
      );
      continue;
    }
    const why = prop.reason ? `: ${prop.reason}` : "";
    if (prop.op === "abandon") abandonGoal(ctx, g, now, `lo decidió al repasar el día${why}`);
    else if (prop.op === "postpone" && g.status === "active") {
      setStatus(ctx, g, "postponed", now, `aplazada al repasar el día${why}`);
    } else if (prop.op === "resume" && g.status === "postponed") {
      // Una meta de irse aplazada por ser menor sigue aplazada.
      if (g.departure && seedIsMinor(agent.seed)) continue;
      g.lastProgressAt = now;
      setStatus(ctx, g, "active", now, `la retoma${why}`);
    }
  }
}

/** Lo que entra en la consolidación: sus metas y cómo proponer cambios. */
export function consolidationPrompt(ctx: SimContext, agent: Agent): string {
  const mine = goalsOf(ctx, agent.id).filter(
    (g) => g.status === "active" || g.status === "postponed",
  );
  const lines = mine.map((g) => {
    const parent = g.parentId ? ` de ${g.parentId}` : "";
    const label =
      g.level === "life" ? "vital" : g.level === "project" ? `proyecto${parent}` : `paso${parent}`;
    const state = g.status === "postponed" ? ", aplazada" : "";
    return `- ${g.id} [${label}${state}] ${g.text}: ${criterionText(g.criterion, g.measured, names(ctx))} — ${Math.round(g.progress * 100)} %, motivación ${g.motivation.toFixed(1)}, frustración ${g.frustration.toFixed(1)}`;
  });
  const noLife = !mine.some((g) => g.level === "life");
  return `Tus metas (el progreso lo mide la vida, no tú):
${lines.join("\n") || "- (ninguna)"}${noLife ? "\nAhora mismo no tienes meta vital: si te sale una, propónla (level life, criterio projects con el número de proyectos)." : ""}
Si hoy ha cambiado algo, propón (pocos, medibles y propios de tu vida en ${ctx.deps.bible?.year ?? "tu época"}): un proyecto nuevo o un paso de un proyecto, aplazar, abandonar o retomar. Criterios: ${CRITERIA}.
En "goals": [{"op":"add","level":"project|step","parent":"g…","text":"…","criterion":{"type":"…",…}},{"op":"abandon|postpone|resume","id":"g…","reason":"…"}] ([] si nada cambia).`;
}

// --- Secciones del prompt --------------------------------------------------------------------

/** Plan del día: sus metas y proyectos ahora (compacto). */
export function planLines(ctx: SimContext, agent: Agent): string[] {
  const active = goalsOf(ctx, agent.id, "active");
  const life = active.find((g) => g.level === "life");
  const projects = active.filter((g) => g.level === "project").slice(0, 3);
  return [
    ...(life ? [`Vital: ${life.text} (${Math.round(life.progress * 100)} %)`] : []),
    ...projects.map((g) => {
      const step = active.find((s) => s.parentId === g.id);
      return `Proyecto: ${g.text} — ${criterionText(g.criterion, g.measured, names(ctx))}${step ? `; siguiente paso: ${step.text}` : ""}`;
    }),
  ];
}

/**
 * Decisión: el proyecto que viene a cuento (alguien de él está aquí, está en su sitio o no tiene
 * nada que hacer), con su siguiente paso. No en cada decisión: como mucho cada dos horas.
 */
export function decideLine(
  ctx: SimContext,
  agent: Agent,
  now: number,
  present: string[],
): string | null {
  const s = goalsState(ctx);
  const last = s.shownAt.get(agent.id);
  if (last !== undefined && now - last < DECIDE_COOLDOWN) return null;
  const idle = !agent.currentPlanItem(now) || agent.state.action === "tiempo libre";
  const active = goalsOf(ctx, agent.id, "active").filter((g) => g.level !== "life");
  const relevant = active.find((g) => {
    const cue = criterionCues(g.criterion);
    return (
      (cue.personId && present.includes(cue.personId)) ||
      (cue.placeId && cue.placeId === agent.state.locationId)
    );
  });
  const pick = relevant ?? (idle ? active.find((g) => g.level === "project") : undefined);
  if (!pick) return null;
  s.shownAt.set(agent.id, now);
  const step = active.find((x) => x.parentId === pick.id);
  return `${pick.text} — ${criterionText(pick.criterion, pick.measured, names(ctx))}${step ? `; siguiente paso: ${step.text}` : ""}`;
}

// --- Marcharse y volver de visita -------------------------------------------------------------

/** Un adulto que consigue irse: sale de la simulación, se despide y el pueblo lo recuerda. */
function depart(ctx: SimContext, agent: Agent, g: Goal, now: number): void {
  const s = goalsState(ctx);
  const to = g.departure!.to;
  const cfg = cfgOf(ctx).departure;
  // Antes de irse: deja la charla, de acompañar a nadie, sus citas y lo que tenía prestado.
  if (activeConversationOf(ctx, agent.id)) {
    void leaveConversation(ctx, agent.id, `${agent.seed.name} se despide: se va a vivir a ${to}`);
  }
  if (ctx.rt(agent.id).following) stopFollowing(ctx, agent.id, null);
  for (const m of openMeetingsOf(ctx, agent.id)) {
    void runAction(
      { ctx, agent, now },
      { type: "cancel_meeting", meetingId: m.id, reason: `me voy a vivir a ${to}` },
    );
  }
  for (const item of itemsState(ctx).items.values()) {
    if (item.holderId === agent.id && item.ownerId && item.ownerId !== agent.id) {
      item.holderId = item.ownerId;
      item.loan = null;
      saveItem(ctx, item);
    }
  }
  ctx.emit(
    "action",
    agent.id,
    `🚌 ${agent.seed.name} se despide del pueblo: se va a vivir a ${to}`,
    [agent.id],
    undefined,
    { action: "departure", ok: true },
  );
  leaveTown(ctx, agent, `se ha ido a vivir a ${to}`);
  const d: Departure = {
    agentId: agent.id,
    to,
    leftAt: now,
    goalId: g.id,
    visits: 0,
    nextVisitAt: cfg.visitEveryDays > 0 ? visitAt(now, cfg.visitEveryDays, cfg.visitStart) : null,
    visiting: false,
  };
  s.departures.set(agent.id, d);
  persistDeparture(ctx, d);
  // El pueblo lo recuerda (con el olvido de siempre).
  for (const other of ctx.agents.values()) {
    if (other.id === agent.id || isAway(ctx, other.id)) continue;
    remember(
      ctx,
      {
        agentId: other.id,
        text: `${agent.seed.name} se ha ido a vivir a ${to}.`,
        type: "semantic",
        source: "vivido",
        importance: cfg.memoryImportance,
        people: [agent.id],
      },
      now,
    );
  }
}

/** Primer día de visita a la hora de llegar, pasados `days` días. */
function visitAt(now: number, days: number, start: number): number {
  return (Math.floor(now / 1440) + Math.ceil(days)) * 1440 + start;
}

function leaveTown(ctx: SimContext, agent: Agent, action: string): void {
  const rt = ctx.rt(agent.id);
  rt.travelling = false;
  rt.arrival = null;
  rt.inbox = [];
  rt.pending = [];
  agent.state.locationId = AWAY_LOCATION;
  agent.state.targetId = null;
  agent.state.spotId = null;
  agent.state.movement = null;
  agent.state.companionId = null;
  agent.state.action = action;
  agent.state.activityKind = "idle";
}

/** Visitas: quien se fue vuelve un día (configurable) con sus recuerdos, y se va por la tarde. */
export function visitsTick(ctx: SimContext, now: number): void {
  const s = goalsState(ctx);
  const cfg = cfgOf(ctx).departure;
  const minute = now % 1440;
  for (const d of s.departures.values()) {
    const agent = ctx.agents.get(d.agentId);
    if (!agent) continue;
    if (!d.visiting && d.nextVisitAt !== null && now >= d.nextVisitAt && minute < cfg.visitEnd) {
      d.visiting = true;
      d.visits++;
      const plaza = ctx.world.has("plaza")
        ? "plaza"
        : ctx.world.places.find((p) => p.kind === "park")?.id;
      if (!plaza) continue;
      const occupied = new Set(
        [...ctx.agents.values()]
          .filter((a) => a.state.locationId === plaza)
          .map((a) => `${a.state.tile.x},${a.state.tile.y}`),
      );
      agent.state.tile = ctx.world.restingTile(plaza, null, occupied);
      agent.state.locationId = plaza;
      ctx.rt(agent.id).plannedDay = -1;
      setAction(ctx, agent, `de visita en el pueblo (viene de ${d.to})`, "idle");
      persistDeparture(ctx, d);
      ctx.emit(
        "action",
        agent.id,
        `🧳 ${agent.seed.name} vuelve de visita desde ${d.to}`,
        [agent.id],
        undefined,
        { action: "visit", ok: true },
      );
    } else if (d.visiting && minute >= cfg.visitEnd) {
      d.visiting = false;
      d.nextVisitAt =
        cfg.visitEveryDays > 0 ? visitAt(now, cfg.visitEveryDays, cfg.visitStart) : null;
      if (activeConversationOf(ctx, agent.id)) {
        void leaveConversation(ctx, agent.id, `${agent.seed.name} vuelve a ${d.to}`);
      }
      ctx.emit(
        "action",
        agent.id,
        `🚌 ${agent.seed.name} vuelve a ${d.to}`,
        [agent.id],
        undefined,
        {
          action: "visit_end",
          ok: true,
        },
      );
      leaveTown(ctx, agent, `vive en ${d.to}`);
      persistDeparture(ctx, d);
    }
  }
}

/** Al abrir el mundo sin instantánea: quien se había ido sigue fuera. */
export function restoreAway(ctx: SimContext): void {
  for (const d of goalsState(ctx).departures.values()) {
    const agent = ctx.agents.get(d.agentId);
    if (agent && !d.visiting) leaveTown(ctx, agent, `vive en ${d.to}`);
  }
}
