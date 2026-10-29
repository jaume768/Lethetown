import { reinforce } from "../memory/decay";
import {
  cuePresent,
  recallChance,
  type IntentionInput,
  type IntentionState,
} from "../memory/prospective";
import { currentStrength } from "../memory/decay";
import type { MemoryRecord } from "../memory/types";
import { formatClock, parseClock } from "./prompts";
import type { Agent } from "./agent";
import type { IntentionOutcome } from "./agent-types";

/** "estando con carmen", "en cafe_ola", "a las 10:00". */
function describeCue(i: IntentionState, names: Record<string, string> = {}): string {
  if (i.personId) return `estando con ${names[i.personId] ?? i.personId}`;
  if (i.placeId) return `en ${i.placeId}`;
  if (i.atMinute !== null) return `a las ${formatClock(i.atMinute)}`;
  return "cuando surgió";
}

/**
 * Se propone hacer algo más adelante (memoria prospectiva): un recuerdo de tipo `intention`
 * con sus pistas (persona, lugar, hora) que se lleva en la cabeza (`mind.intentions`).
 * Devuelve false si no se guarda (repetida, protección de menores, desactivado).
 */
/** Devuelve el id del recuerdo de la intención, o null si no se guarda. */
export async function intend(a: Agent, now: number, input: IntentionInput): Promise<string | null> {
  const memory = a.deps.memory;
  const cfg = memory.config.prospective;
  const text = input.text.trim().replace(/[.。]+$/, "");
  if (!cfg.enabled || !text) return null;
  // Solo personas del pueblo (las que conoce por su id).
  const known = (id: string | null | undefined) =>
    id && a.deps.names && id in a.deps.names ? id : null;
  const personId = known(input.personId) ?? null;
  const placeId = a.validPlace(input.placeId ?? undefined) ?? null;
  const atMinute = input.at ? parseClock(input.at) : null;
  const open = a.mind.intentions.filter((i) => i.status === "pending" || i.status === "forgotten");
  if (open.some((i) => i.text.toLowerCase() === text.toLowerCase())) return null;
  const meta = {
    intention: { status: "pending" as const, personId, placeId, atMinute, misses: 0 },
  };
  const record = await memory.tryRemember(
    {
      agentId: a.id,
      text: `Quiero ${text}`,
      type: "intention",
      importance: cfg.importance,
      source: "inferido",
      people: personId ? [personId] : [],
      placeId,
      meta,
    },
    now,
  );
  if (!record) return null;
  a.mind.intentions = [
    ...open,
    {
      memoryId: record.id,
      text,
      personId,
      placeId,
      atMinute,
      status: "pending" as const,
      misses: 0,
      createdAt: now,
      // Nace en su contexto (con esa persona, en ese sitio): la pista tiene que irse y volver.
      cueActive: true,
    },
  ].slice(-cfg.maxOpen);
  return record.id;
}

/**
 * Memoria prospectiva en cada tick (sin LLM): con la pista delante (la persona, el lugar o la
 * hora) se acuerda o no; si se le pasan varias ocasiones, se le olvida, y quizá más tarde cae
 * en la cuenta. Lo que recuerda le llega como percepción para que decida qué hacer.
 */
export async function checkIntentions(
  a: Agent,
  now: number,
  minutes: number,
  present: string[],
): Promise<IntentionOutcome[]> {
  const memory = a.deps.memory;
  const cfg = memory.config.prospective;
  if (!cfg.enabled || !a.mind.intentions.length) return [];
  const out: IntentionOutcome[] = [];
  const profile = memory.profileOf(a.id);
  const ctx = { placeId: a.state.locationId, present, minuteOfDay: Math.floor(now % 1440) };
  const keep: IntentionState[] = [];
  for (const i of a.mind.intentions) {
    const rec = await memory.store.get(i.memoryId);
    if (!rec || rec.status !== "active") continue;
    if (now - i.createdAt > cfg.expireDays * 24 * 60) {
      await closeIntention(a, i, rec, "expired", now, "pasaron los días y ya no lo hizo");
      out.push({ kind: "expired", intention: i });
      continue;
    }
    if (i.status === "forgotten") {
      // Caer en la cuenta, tarde: "¡vaya, se me olvidó!". Vuelve a tenerlo pendiente.
      if (memory.rng() < 1 - Math.pow(1 - cfg.lateRecallPerHour, minutes / 60)) {
        i.status = "pending";
        i.misses = 0;
        await syncIntention(a, i, rec);
        await memory.tryRemember(
          {
            agentId: a.id,
            text: `¡Vaya, se me olvidó ${i.text}!`,
            type: "observation",
            importance: 5,
            emotionalValence: -0.4,
            people: i.personId ? [i.personId] : [],
          },
          now,
        );
        out.push({ kind: "late", intention: i });
      }
      keep.push(i);
      continue;
    }
    const cue = cuePresent(i, ctx, cfg.timeWindowMinutes);
    const appeared = cue && !i.cueActive;
    i.cueActive = cue;
    if (!appeared) {
      keep.push(i);
      continue;
    }
    const strength = currentStrength(rec, now);
    const chance =
      strength < memory.config.retrieval.forgetThreshold
        ? 0
        : recallChance(profile.intentionForgetting, strength, cfg);
    if (memory.rng() < chance) {
      await closeIntention(a, i, rec, "done", now, "se acordó en el momento oportuno");
      await memory.store.update(rec.id, reinforce(rec, now, memory.config.decay));
      const who = i.personId ? a.deps.names?.[i.personId] : undefined;
      a.workingMemory.push({ text: `Quería ${i.text}`, memoryId: rec.id, addedAt: now });
      out.push({
        kind: "kept",
        intention: i,
        reminder: `Te acuerdas de que querías ${i.text}${who ? ` (ahí está ${who})` : ""}.`,
      });
      continue;
    }
    i.misses++;
    if (i.misses >= cfg.maxMisses) {
      i.status = "forgotten";
      await syncIntention(a, i, rec);
      await memory.audit({
        agentId: a.id,
        memoryId: rec.id,
        memoryText: rec.text,
        action: "intention_forgotten",
        reason: `tuvo ${i.misses} ocasiones (${describeCue(i, a.deps.names)}) y no se acordó de ${i.text}`,
        at: now,
      });
      out.push({ kind: "missed", intention: i });
    } else {
      await syncIntention(a, i, rec);
    }
    keep.push(i);
  }
  a.mind.intentions = keep;
  for (const o of out) {
    if (o.kind === "kept" || o.kind === "missed") {
      memory.emitEffect({
        kind: "intention",
        agentId: a.id,
        memoryId: o.intention.memoryId,
        text: o.intention.text,
        importance: cfg.importance,
        outcome: o.kind === "kept" ? "kept" : "forgotten",
        others: o.intention.personId ? [o.intention.personId] : [],
      });
    }
  }
  return out;
}

/** Refleja en el recuerdo (meta) el estado de una intención. */
export async function syncIntention(a: Agent, i: IntentionState, rec: MemoryRecord) {
  await a.deps.memory.store.update(rec.id, {
    meta: {
      ...rec.meta,
      intention: {
        status: i.status,
        personId: i.personId,
        placeId: i.placeId,
        atMinute: i.atMinute,
        misses: i.misses,
      },
    },
  });
}

export async function closeIntention(
  a: Agent,
  i: IntentionState,
  rec: MemoryRecord,
  status: "done" | "expired",
  now: number,
  why: string,
) {
  i.status = status;
  await syncIntention(a, i, rec);
  await a.deps.memory.audit({
    agentId: a.id,
    memoryId: rec.id,
    memoryText: rec.text,
    action: status === "done" ? "intention_kept" : "intention_expired",
    reason: `${i.text}: ${why}`,
    at: now,
  });
}

/**
 * Repasar una intención (p. ej. al mirar la agenda): recordarla la refuerza, como cualquier
 * recuerdo. Devuelve si seguía ahí.
 */
export async function rehearseIntention(a: Agent, memoryId: string, now: number): Promise<boolean> {
  const memory = a.deps.memory;
  const rec = await memory.store.get(memoryId);
  if (!rec || rec.status !== "active") return false;
  if (currentStrength(rec, now) < memory.config.retrieval.forgetThreshold) return false;
  await memory.store.update(memoryId, reinforce(rec, now, memory.config.decay));
  return true;
}

/**
 * Intento de recordar ahora una intención concreta (p. ej. una cita, un rato antes): misma
 * probabilidad que con una pista (perfil y nitidez del recuerdo). Se cierra como cumplida o
 * olvidada, con su auditoría. Devuelve si se acordó.
 */
export async function recallIntentionNow(
  a: Agent,
  memoryId: string,
  now: number,
): Promise<boolean> {
  const memory = a.deps.memory;
  const cfg = memory.config.prospective;
  const i = a.mind.intentions.find((x) => x.memoryId === memoryId);
  const rec = await memory.store.get(memoryId);
  if (!i || !rec || rec.status !== "active") return false;
  const strength = currentStrength(rec, now);
  const chance =
    strength < memory.config.retrieval.forgetThreshold
      ? 0
      : recallChance(
          memory.profileOf(a.id).intentionForgetting,
          strength,
          cfg,
          cfg.appointmentRecall,
        );
  const kept = memory.rng() < chance;
  if (kept) {
    await closeIntention(a, i, rec, "done", now, "se acordó a tiempo");
    a.mind.intentions = a.mind.intentions.filter((x) => x !== i);
  } else {
    i.status = "forgotten";
    i.misses = cfg.maxMisses;
    await syncIntention(a, i, rec);
    await memory.audit({
      agentId: a.id,
      memoryId: rec.id,
      memoryText: rec.text,
      action: "intention_forgotten",
      reason: `llegado el momento, no se acordó de ${i.text}`,
      at: now,
    });
  }
  memory.emitEffect({
    kind: "intention",
    agentId: a.id,
    memoryId,
    text: i.text,
    importance: cfg.importance,
    outcome: kept ? "kept" : "forgotten",
  });
  return kept;
}
