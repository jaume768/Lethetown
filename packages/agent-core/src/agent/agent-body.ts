import { encodingStrength, overwhelmed, sleepDebt, sleepQuality } from "../memory/encoding";
import { recallText } from "../memory/retrieval";
import { baselineMood, makeMood, stepMood, stepNeeds } from "./mood";
import type { Agent } from "./agent";

/** Actividades que son una comida, las marque el modelo como las marque. */
const MEAL = /\b(comer|comiendo|desayun\w*|cenar|cenando|merend\w*|almorz\w*)\b/i;

/** Nivel base del ánimo (según su personalidad). */
export function moodBaseline(a: Agent): { valence: number; arousal: number } {
  const cfg = a.deps.memory.config;
  const base = baselineMood(a.seed.personality, cfg.mood);
  // Si durmió mal, ese día su nivel base está más bajo.
  return { ...base, valence: base.valence - cfg.sleep.debtValence * a.mind.sleepDebt };
}

/**
 * Fuerza inicial con la que graba algo ahora (atención y estado) y si solo le queda la
 * esencia (activación extrema). Ver memory/encoding.ts.
 */
export function encoding(
  a: Agent,
  arousal: number,
  distracted: boolean,
): { strength: number; meta?: { gistOnly: true } } {
  const cfg = a.deps.memory.config.encoding;
  const strength = encodingStrength(
    {
      arousal,
      energy: a.state.needs.energy,
      walking: a.state.activityKind === "walk",
      distracted,
      sleepDebt: a.mind.sleepDebt,
    },
    cfg,
  );
  return overwhelmed(arousal, cfg) ? { strength, meta: { gistOnly: true } } : { strength };
}

/**
 * Un recuerdo malo que vuelve sin querer (ver MemorySystem.intrude): entra en la memoria de
 * trabajo y tiñe el ánimo. Devuelve lo que le vino a la cabeza, o null.
 */
export async function ruminate(
  a: Agent,
  now: number,
  minutes: number,
  present: string[],
): Promise<string | null> {
  const memory = a.deps.memory;
  const hit = await memory.intrude({
    agentId: a.id,
    now,
    minutes,
    moodValence: a.state.mood.valence,
    neuroticism: a.seed.personality.neuroticism,
    placeId: a.state.locationId,
    present,
  });
  if (!hit) return null;
  const text = recallText(hit);
  a.workingMemory.push({
    text: `(sin querer, me vino a la cabeza) ${text}`,
    memoryId: hit.memory.id,
    addedAt: now,
  });
  const pull = memory.config.intrusive.moodPull;
  a.state.mood = makeMood(
    a.state.mood.valence + (hit.memory.emotionalValence - a.state.mood.valence) * pull,
    a.state.mood.arousal + (1 - a.state.mood.arousal) * pull,
  );
  return text;
}

/** Al acostarse: lo tenso o preocupado que esté decide cómo dormirá esta noche. */
export function fallAsleep(a: Agent): number {
  const cfg = a.deps.memory.config.sleep;
  a.mind.sleepQuality = sleepQuality(a.state.mood, a.seed.personality.neuroticism, cfg);
  return a.mind.sleepQuality;
}

/**
 * Al despertar: si no recuperó energía suficiente, arrastra una deuda de sueño ese día
 * (peor memoria y peor ánimo). Devuelve la deuda (0 = descansado).
 */
export function wakeUp(a: Agent): number {
  const cfg = a.deps.memory.config.sleep;
  const debt = sleepDebt(a.state.needs.energy, cfg);
  a.mind.sleepDebt = debt;
  a.mind.sleepQuality = 1;
  if (debt > 0) {
    a.state.mood = makeMood(a.state.mood.valence - cfg.debtValence * debt, a.state.mood.arousal);
  }
  return debt;
}

/**
 * El cuerpo con el paso del tiempo (sin LLM): necesidades según lo que hace y su personalidad,
 * y ánimo que vuelve a su nivel base empujado por las necesidades.
 */
export function live(a: Agent, minutes: number, alone: boolean): void {
  const cfg = a.deps.memory.config;
  const extraversion = a.seed.personality.extraversion;
  // Si lo que hace dice que come («cenar en casa y descansar»), come, aunque el modelo la
  // marcara como "sit": en la partida de estudio una cena así no quitaba el hambre.
  const kind =
    a.state.activityKind !== "eat" &&
    a.state.activityKind !== "sleep" &&
    a.state.activityKind !== "walk" &&
    MEAL.test(a.state.action)
      ? "eat"
      : a.state.activityKind;
  a.state.needs = stepNeeds(
    a.state.needs,
    { kind, alone, extraversion, sleepQuality: a.mind.sleepQuality },
    minutes,
    cfg.needs,
  );
  a.state.mood = stepMood(
    a.state.mood,
    {
      needs: a.state.needs,
      sleeping: kind === "sleep",
      baseline: a.moodBaseline,
      extraversion,
    },
    minutes,
    cfg.mood,
  );
}
