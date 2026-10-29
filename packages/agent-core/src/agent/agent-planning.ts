import type { PlanItem, Weather } from "@lethetown/shared";
import { reinforce } from "../memory/decay";
import { dayDiaryText, dueHabits, habitText, recordDay } from "../memory/habits";
import { isYouthMemory } from "../memory/psychology";
import { recallText } from "../memory/retrieval";
import { inferActivityKind } from "./activity";
import { describeMood } from "./mood";
import { PlanResponse, parseWith } from "./parse";
import { parseClock, planPrompt } from "./prompts";
import type { Agent } from "./agent";
import { formatClock } from "./prompts";
import { replanAt } from "./replan";
import type { DayEndReport } from "./agent-types";
import { socialDayEnd } from "./agent-social";
import { safe } from "./agent-decision";

export const SLEEP_START = 22 * 60;
export const DAY_START = 7 * 60;

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

/** Guarda los recuerdos semánticos iniciales del archivo de semillas. */
export async function seedMemories(a: Agent, now: number): Promise<void> {
  for (const text of a.seed.initialMemories) {
    await a.deps.memory.remember(
      {
        agentId: a.id,
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
  for (const i of a.seed.initialIntentions) await a.intend(now, i);
}

/**
 * Anota en el diario de hoy (memoria a corto plazo, sin LLM ni recuerdo episódico) una
 * actividad que empieza, si no es la misma que la anterior. Con poca energía el diario falla:
 * a veces no la anota y a veces la anota en el lugar de la anterior (la mezcla).
 */
export function noteActivity(a: Agent, now: number, activity: string, placeId: string): void {
  const log = a.state.doneToday ?? [];
  const last = log.at(-1);
  if (last && last.activity === activity && last.placeId === placeId) return;
  const cfg = a.deps.memory.config.diary;
  const energy = a.state.needs.energy;
  let where = placeId;
  if (energy < cfg.lowEnergy) {
    const tiredness = 1 - energy / cfg.lowEnergy;
    const r = a.deps.memory.rng();
    if (r < cfg.maxLossProbability * tiredness) return;
    if (last && r < (cfg.maxLossProbability + cfg.maxMixProbability) * tiredness) {
      where = last.placeId;
    }
  }
  a.state.doneToday = [...log, { minute: Math.floor(now % 1440), activity, placeId: where }].slice(
    -cfg.maxEntries,
  );
}

/**
 * Cierre del día (al dormirse, sin LLM): el diario de hoy se guarda como un único recuerdo
 * ("El día N: …", con el olvido de siempre) y alimenta el rastreador de rutinas; lo que se
 * repite en varios días se convierte en un recuerdo semántico de hábito o lo refuerza.
 */
export async function endDay(a: Agent, now: number, day: number): Promise<DayEndReport> {
  const report: DayEndReport = { diaryMemoryId: null, habitsFormed: [], habitsReinforced: [] };
  await socialDayEnd(a, now);
  const entries = a.state.doneToday ?? [];
  if (!entries.length) return report;
  const memory = a.deps.memory;
  const cfg = memory.config;
  const placeName = (id: string) => a.deps.places.find((p) => p.id === id)?.name ?? id;
  const diary = await memory.tryRemember(
    {
      agentId: a.id,
      text: dayDiaryText(day, entries, placeName),
      type: "observation",
      importance: cfg.diary.dayImportance,
    },
    now,
  );
  if (diary) {
    report.diaryMemoryId = diary.id;
    a.mind.diaryMemoryIds = [...a.mind.diaryMemoryIds, diary.id].slice(-7);
  }
  if (!cfg.habits.enabled) return report;
  a.mind.habits = recordDay(a.mind.habits, entries, day, cfg.habits.windowDays);
  for (const h of dueHabits(a.mind.habits, day, cfg.habits.minDays)) {
    const existing = h.memoryId ? await memory.store.get(h.memoryId) : undefined;
    if (existing?.status === "active") {
      await memory.store.update(existing.id, {
        ...reinforce(existing, now, cfg.decay),
        forgottenAt: null,
      });
      await memory.audit({
        agentId: a.id,
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
        agentId: a.id,
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
      agentId: a.id,
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
export async function recallYesterday(
  a: Agent,
  now: number,
): Promise<{ text: string; ids: string[] }> {
  const cfg = a.deps.memory.config.habits;
  const diary = a.mind.diaryMemoryIds.at(-1);
  const habits = Object.values(a.mind.habits)
    .map((h) => h.memoryId)
    .filter((id): id is string => Boolean(id));
  const recalled = await a.deps.memory.recallByIds(
    [...(diary ? [diary] : []), ...habits],
    now,
    a.state.mood.valence,
    // Lo vago de ayer puede reconstruirse (y rellenarse) al recordarlo.
    a.recallContext(),
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

/** Planifica el día con el modelo de reflexión. */
export async function planDay(
  a: Agent,
  now: number,
  weather: Weather = "sunny",
  /** Compromisos (citas) de hoy: van al prompt y se respetan en el plan. */
  fixed: PlanItem[] = [],
): Promise<PlanItem[]> {
  // Lo que recuerda de ayer y sus costumbres orientan el plan de hoy; se empieza otro diario.
  const yesterday = await recallYesterday(a, now);
  a.state.doneToday = [];
  const recalled = await a.deps.memory.retrieve({
    agentId: a.id,
    query: `${a.seed.name}: qué quiero hacer hoy, mis rutinas y mis planes`,
    now,
    moodValence: a.state.mood.valence,
    k: 5,
    recall: a.recallContext(),
    exclude: yesterday.ids,
  });
  try {
    const res = await a.deps.llm.run({
      kind: "reflection",
      task: "plan",
      agentId: a.id,
      system: a.system,
      prompt: planPrompt({
        now,
        needs: a.state.needs,
        recalled: recalled.map((s) => `- ${recallText(s)}`).join("\n") || "- (nada en especial)",
        weather,
        mood: describeMood(a.state.mood),
        yesterday: yesterday.text,
        fixed: fixed.map(
          (f) =>
            `- ${formatClock(f.startMinute)} ${f.activity} (${f.placeId}, ${f.durationMin} min)`,
        ),
      }),
    });
    const plan = parseWith(PlanResponse, res.text)
      .plan.map((p): PlanItem | null => {
        const startMinute = parseClock(p.start);
        if (startMinute === null) return null;
        const placeId = a.validPlace(p.placeId) ?? a.seed.homeId;
        const spot = a.spot(p.spotId);
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
      if (!(await safe(a, p.activity, "plan"))) plan.splice(plan.indexOf(p), 1);
    }
    a.state.plan = plan.length ? plan : fallbackPlan(a.seed.homeId);
  } catch (error) {
    a.deps.onError?.(a.id, "plan", error);
    a.state.plan = fallbackPlan(a.seed.homeId);
  }
  // Las citas mandan sobre lo planeado (aunque el modelo no las haya respetado).
  for (const f of fixed) a.state.plan = replanAt(a.state.plan, f.startMinute, f, f.durationMin);
  await a.deps.memory.tryRemember(
    {
      agentId: a.id,
      text: `Mi plan para hoy: ${a.state.plan.map((p) => p.activity).join(", ")}`,
      type: "plan",
      importance: 3,
    },
    now,
  );
  return a.state.plan;
}
