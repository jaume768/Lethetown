import { applySocialUpdate, socialNote } from "../memory/human";
import { exposureDelta, forgive } from "../memory/social";
import type { Agent } from "./agent";

/** Notas de lo que piensa de esas personas (para el prompt). */
export async function socialNotes(a: Agent, ids: string[]): Promise<string[]> {
  if (!a.deps.social) return [];
  const notes: string[] = [];
  for (const id of ids) {
    const profile = await a.deps.social.get(a.id, id);
    if (profile) notes.push(socialNote(profile, a.deps.names?.[id] ?? id));
  }
  return notes;
}

/** Siembra lo que piensa de los demás al empezar (relaciones de las semillas). */
export async function seedRelationships(a: Agent, now: number): Promise<void> {
  const social = a.deps.social;
  if (!social) return;
  for (const r of a.seed.relationships) {
    if (!a.deps.names || !(r.with in a.deps.names)) continue;
    await applySocialUpdate(social, {
      ownerId: a.id,
      aboutId: r.with,
      summary: r.summary,
      affinity: r.affinity,
      trustDelta: r.trust - 0.5,
      familiarityDelta: r.familiarity - 0.1,
      bond: r.bond ?? null,
      now,
      reason: "relación de partida",
      minorInvolved: involvesMinor(a, r.with),
      config: a.deps.memory.config.social,
    });
  }
}

/** ¿Es menor él o la otra persona? (para que nunca haya romance). */
export function involvesMinor(a: Agent, otherId: string): boolean {
  const guard = a.deps.memory.guard;
  return Boolean(guard?.isMinor(a.id) || guard?.isMinor(otherId));
}

/** Mera exposición: anota el tiempo que pasa en el mismo sitio que otros (sin LLM). */
export function noteCompany(a: Agent, present: string[], minutes: number): void {
  const exposure = { ...a.mind.exposure };
  for (const id of present) exposure[id] = (exposure[id] ?? 0) + minutes;
  a.mind.exposure = exposure;
}

/**
 * Lo social al cerrar el día (sin LLM): coincidir a menudo acerca un poco (mera exposición)
 * y la afinidad negativa se suaviza con el tiempo (perdón), salvo el rencor de las ofensas
 * importantes. Todo queda en el historial de las fichas.
 */
export async function socialDayEnd(a: Agent, now: number, days = 1): Promise<void> {
  const social = a.deps.social;
  if (!social) return;
  const cfg = a.deps.memory.config.social;
  for (const [id, minutes] of Object.entries(a.mind.exposure)) {
    const prev = await social.get(a.id, id);
    const d = exposureDelta(minutes, prev?.affinity ?? 0, cfg);
    if (!d.familiarityDelta && !d.affinityDelta) continue;
    await applySocialUpdate(social, {
      ownerId: a.id,
      aboutId: id,
      ...d,
      now,
      reason: `coincidieron ${(minutes / 60).toFixed(1)} h en el pueblo`,
      minorInvolved: involvesMinor(a, id),
      config: cfg,
    });
  }
  a.mind.exposure = {};
  for (const p of await social.list(a.id)) {
    const affinity = forgive(p, days, a.seed.personality.agreeableness, cfg);
    if (affinity - p.affinity < 0.005) continue;
    await applySocialUpdate(social, {
      ownerId: a.id,
      aboutId: p.aboutId,
      affinity,
      now,
      reason:
        p.grudge > 0
          ? `con el tiempo le perdona un poco (aunque le guarda algo de rencor: ${p.grudge.toFixed(2)})`
          : "con el tiempo le perdona un poco",
      minorInvolved: involvesMinor(a, p.aboutId),
      config: cfg,
    });
  }
}
