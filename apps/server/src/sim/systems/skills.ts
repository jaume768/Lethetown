/**
 * Sistema de habilidades: lo que sabe hacer cada vecino, la práctica, el olvido y sus hitos
 * (lógica en sim/skills.ts; cuánto sube y baja, en agent-core/skills). Sin llamadas nuevas al
 * LLM: lo variable va compacto al plan y, como mucho cada 3 h, a la decisión. Ver
 * docs/decisiones/skills.md.
 */
import { levelLabel } from "@lethetown/agent-core";
import { SkillState } from "@lethetown/shared";
import { z } from "zod";
import {
  decideSkillsLine,
  maybeResult,
  type PracticeTick,
  seedSkills,
  skillsCfg,
  skillsLine,
  skillsState,
  skillsTick,
} from "../skills";
import { registerSystem } from "./registry";
import { REVIEW_MINUTES } from "./types";

const Until = z.object({ skill: z.string(), until: z.number() });

/** Lo que pasa al practicar: los resultados (fotos, pan…). Una sola función, para no duplicarla. */
const listen = (p: PracticeTick) => maybeResult(p.ctx, p);

registerSystem({
  id: "skills",
  description: "Habilidades: práctica, maestros, olvido y lo que cambian en el mundo.",
  snapshot: {
    version: 1,
    schema: z.object({
      skills: z.array(SkillState),
      practicing: z.record(z.string(), Until),
      coached: z.record(z.string(), Until.extend({ masterId: z.string().nullable() })),
      lastDecayDay: z.number(),
      practiceMinutes: z.number(),
      streak: z.record(z.string(), z.object({ skill: z.string(), minutes: z.number() })),
      results: z.record(
        z.string(),
        z.object({ quality: z.number(), makerId: z.string(), skill: z.string() }),
      ),
    }),
    save: (ctx) => {
      const s = skillsState(ctx);
      return {
        skills: structuredClone([...s.skills.values()]),
        practicing: Object.fromEntries(s.practicing),
        coached: Object.fromEntries(s.coached),
        lastDecayDay: s.lastDecayDay,
        practiceMinutes: s.practiceMinutes,
        streak: Object.fromEntries(s.streak),
        results: Object.fromEntries(s.results),
      };
    },
    restore: (ctx, d) => {
      const s = skillsState(ctx);
      s.skills = new Map(d.skills.map((x) => [`${x.agentId}:${x.skill}`, x]));
      s.practicing = new Map(Object.entries(d.practicing));
      s.coached = new Map(Object.entries(d.coached));
      s.lastDecayDay = d.lastDecayDay;
      s.practiceMinutes = d.practiceMinutes;
      s.streak = new Map(Object.entries(d.streak));
      s.results = new Map(Object.entries(d.results));
    },
  },
  load: async (ctx, { restored, now }) => {
    const s = skillsState(ctx);
    if (!s.onPractice.includes(listen)) s.onPractice.push(listen);
    if (restored) return;
    const stored = await s.store.list();
    if (stored.length) s.skills = new Map(stored.map((x) => [`${x.agentId}:${x.skill}`, x]));
    else seedSkills(ctx, now);
  },
  tick: { every: REVIEW_MINUTES, run: (ctx, now) => skillsTick(ctx, now, REVIEW_MINUTES) },
  planSections: (ctx, agent, now) => {
    const line = skillsCfg(ctx).enabled ? skillsLine(ctx, agent, now) : null;
    return line ? [{ title: "LO QUE SABES HACER", lines: [line], order: 15 }] : [];
  },
  promptSections: (ctx, agent, now) => {
    const line = skillsCfg(ctx).enabled ? decideSkillsLine(ctx, agent, now) : null;
    return line ? [{ title: "LO QUE SABES HACER", lines: [line], order: 65 }] : [];
  },
  retention: {
    table: "skills",
    keep: "una fila por agente y habilidad (pocas); el historial de cada una ya va acotado",
  },
  metrics: (ctx) => {
    const all = [...skillsState(ctx).skills.values()];
    const out: Record<string, number> = {
      practiceHours: Math.round(skillsState(ctx).practiceMinutes / 6) / 10,
      tracked: all.length,
    };
    for (const s of all) {
      const label = `level.${levelLabel(s.level)}`;
      out[label] = (out[label] ?? 0) + 1;
      out[`mean.${s.skill}`] = (out[`mean.${s.skill}`] ?? 0) + s.level;
      out[`n.${s.skill}`] = (out[`n.${s.skill}`] ?? 0) + 1;
    }
    for (const k of Object.keys(out).filter((k) => k.startsWith("mean."))) {
      const id = k.slice(5);
      out[k] = Math.round((out[k]! / out[`n.${id}`]!) * 100) / 100;
      delete out[`n.${id}`];
    }
    return out;
  },
  admin: (ctx) => [...skillsState(ctx).skills.values()],
});
