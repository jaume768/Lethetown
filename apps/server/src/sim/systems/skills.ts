/**
 * Sistema de habilidades: lo que sabe hacer cada vecino, la práctica, el olvido y sus hitos
 * (lógica en sim/skills.ts; cuánto sube y baja, en agent-core/skills). Sin llamadas nuevas al
 * LLM: lo variable va compacto al plan y, como mucho cada 3 h, a la decisión. Ver
 * docs/decisiones/skills.md.
 */
import { formalAction } from "../agreements";
import { SkillState } from "@lethetown/shared";
import { z } from "zod";
import {
  decideSkillsLine,
  labelOf,
  maybeResult,
  sessionsTick,
  teachingLines,
  type PracticeTick,
  type TeachingSession,
  seedSkills,
  skillsCfg,
  skillsLine,
  skillsState,
  skillsTick,
} from "../skills";
import { registerSystem } from "./registry";
import { REVIEW_MINUTES, type AgreementKind } from "./types";

const Session = z.object({
  id: z.string(),
  teacherId: z.string(),
  learnerId: z.string(),
  skill: z.string(),
  proposedBy: z.string(),
  placeId: z.string(),
  status: z.enum(["proposed", "active", "declined", "done", "expired"]),
  createdAt: z.number(),
  until: z.number(),
}) satisfies z.ZodType<TeachingSession>;

/**
 * «¿Me enseñas a revelar?» «Venga, ahora»: ofrecer (o pedir) y aceptar con las acciones formales.
 * `from` enseña a `to`.
 */
const teachAgreement: AgreementKind = {
  type: "teach",
  steps: (ctx, a) => {
    const learner = a.to[0];
    if (!a.skill || !learner) return "falta qué enseñar o a quién";
    return [
      {
        actorId: a.from,
        action: () => formalAction({ type: "teach", who: learner, skill: a.skill! }),
      },
      {
        actorId: learner,
        action: () => {
          const v = [...skillsState(ctx).sessions.values()]
            .filter(
              (x) => x.teacherId === a.from && x.learnerId === learner && x.status === "proposed",
            )
            .at(-1);
          return v
            ? formalAction({ type: "accept_teaching", sessionId: v.id })
            : "no hubo propuesta";
        },
      },
    ];
  },
  covers: (i) => /enseñ|aprend/i.test(i.text),
};

/** «Te echo una mano con eso»: `from` ayuda a `to` ahora. */
const helpAgreement: AgreementKind = {
  type: "help",
  steps: (_ctx, a) =>
    a.to[0]
      ? [{ actorId: a.from, action: () => formalAction({ type: "help", who: a.to[0]! }) }]
      : "falta a quién ayudar",
  covers: (i) => /ayud|mano/i.test(i.text),
};

const Until = z.object({ skill: z.string(), until: z.number() });

/** Lo que pasa al practicar: los resultados (fotos, pan…). Una sola función, para no duplicarla. */
const listen = (p: PracticeTick) => maybeResult(p.ctx, p);

registerSystem({
  id: "skills",
  description: "Habilidades: práctica, maestros, olvido y lo que cambian en el mundo.",
  actions: [
    "practice",
    "ask_to_learn",
    "teach",
    "accept_teaching",
    "decline_teaching",
    "help",
    "show_result",
  ],
  agreements: [teachAgreement, helpAgreement],
  snapshot: {
    version: 1,
    schema: z.object({
      skills: z.array(SkillState),
      sessions: z.array(Session),
      seq: z.number().int().nonnegative(),
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
        sessions: structuredClone([...s.sessions.values()]),
        seq: s.seq,
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
      s.sessions = new Map(d.sessions.map((x) => [x.id, x]));
      s.seq = d.seq;
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
  tick: {
    every: REVIEW_MINUTES,
    run: (ctx, now) => {
      sessionsTick(ctx, now);
      skillsTick(ctx, now, REVIEW_MINUTES);
    },
  },
  // Fijo (cacheable): las ids del catálogo, para practicar, enseñar y aprender.
  identityLines: (_world, deps) => [
    `Habilidades (id = qué es; para practice, teach, ask_to_learn): ${deps.memory.config.skills.catalog.map((s) => `${s.id} = ${s.label}`).join(", ")}.`,
  ],
  planSections: (ctx, agent, now) => {
    const line = skillsCfg(ctx).enabled ? skillsLine(ctx, agent, now) : null;
    return line ? [{ title: "LO QUE SABES HACER", lines: [line], order: 15 }] : [];
  },
  promptSections: (ctx, agent, now) => {
    if (!skillsCfg(ctx).enabled) return [];
    const line = decideSkillsLine(ctx, agent, now);
    const teaching = teachingLines(ctx, agent, now);
    return [
      ...(line ? [{ title: "LO QUE SABES HACER", lines: [line], order: 65 }] : []),
      ...(teaching.length ? [{ title: "ENSEÑAR Y APRENDER", lines: teaching, order: 12 }] : []),
    ];
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
      sessions: skillsState(ctx).counts.sessions,
      helps: skillsState(ctx).counts.helps,
      shown: skillsState(ctx).counts.shown,
      results: skillsState(ctx).results.size,
    };
    for (const s of all) {
      const label = `level.${labelOf(s)}`;
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
