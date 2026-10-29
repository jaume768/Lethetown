/**
 * Memoria humana completa (fase G): consolidación nocturna, esencia, reconsolidación,
 * confusión de fuente, fichas sociales y resumen de episodios. Interfaces + implementaciones
 * con LLM (inyectado). Los prompts siguen el formato "TAREA: <nombre>" que entiende el MockProvider.
 */
import type { MemorySource, SocialProfile } from "@lethetown/shared";
import { z } from "zod";
import type { MinorGuard } from "../agent/minor-safety";
import { parseWith } from "../agent/parse";
import type { LLMClient } from "../llm/client";
import type { Rng } from "../util/random";
import type { MemoryConfig } from "./config";
import { currentStrength } from "./decay";
import type { MemorySystem } from "./memory-system";
import type { MemoryRecord } from "./types";

/** Quién recuerda: identidad (prompt fijo) y nombre. */
export interface MemoryOwner {
  agentId: string;
  agentName: string;
  system: string;
}

// --- Interfaces -------------------------------------------------------------------------

export interface ConsolidationResult {
  created: MemoryRecord[];
  reinforced: string[];
  weakened: string[];
  questions: string[];
}

/** Consolidación nocturna / reflexión (Park et al.) con citas a los recuerdos fuente. */
export interface Consolidator {
  consolidate(owner: MemoryOwner, from: number, now: number): Promise<ConsolidationResult>;
}

/** Compresión detalle → esencia cuando un recuerdo se debilita. */
export interface GistCompressor {
  compress(owner: MemoryOwner, memory: MemoryRecord): Promise<string>;
}

/** Reconsolidación: al recordar, el recuerdo se reescribe influido por ánimo y relaciones. */
export interface Reconsolidator {
  reconsolidate(
    memory: MemoryRecord,
    context: { now: number; system: string; moodLabel: string; socialSummary: string },
  ): Promise<{ text: string; emotionalValence: number } | null>;
  /**
   * Falso recuerdo: a partir de lo poco que recuerda (`vague`), la mente rellena huecos con
   * detalles plausibles que no vivió. Solo lo pide el código, con baja probabilidad.
   */
  confabulate?(
    memory: MemoryRecord,
    vague: string,
    context: { now: number; system: string; moodLabel: string; socialSummary: string },
  ): Promise<{ text: string; emotionalValence: number } | null>;
}

/** Confusión de fuente: con el tiempo, "me lo contó X" puede pasar a "lo viví" o a otra persona. */
export interface SourceConfuser {
  confuse(memory: MemoryRecord, probability: number, others: string[]): MemorySource | null;
}

/** Resumen de un grupo de episodios relacionados (olvido por presupuesto, paso 2). */
export interface EpisodeSummarizer {
  summarize(owner: MemoryOwner, episodes: MemoryRecord[]): Promise<string>;
}

export interface SocialProfileStore {
  get(ownerId: string, aboutId: string): Promise<SocialProfile | undefined>;
  upsert(profile: SocialProfile): Promise<void>;
  list(ownerId: string): Promise<SocialProfile[]>;
}

// --- Fichas sociales ------------------------------------------------------------------------

export class InMemorySocialProfileStore implements SocialProfileStore {
  private readonly profiles = new Map<string, SocialProfile>();

  async get(ownerId: string, aboutId: string) {
    const p = this.profiles.get(`${ownerId}:${aboutId}`);
    return p && { ...p };
  }

  async upsert(profile: SocialProfile) {
    this.profiles.set(`${profile.ownerId}:${profile.aboutId}`, { ...profile });
  }

  async list(ownerId: string) {
    return [...this.profiles.values()].filter((p) => p.ownerId === ownerId).map((p) => ({ ...p }));
  }
}

const clamp = (x: number, lo: number, hi: number) =>
  Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : lo;

/** Aplica un cambio a la ficha social (crea la ficha si no existe). */
export async function applySocialUpdate(
  store: SocialProfileStore,
  update: {
    ownerId: string;
    aboutId: string;
    summary?: string;
    affinityDelta?: number;
    trustDelta?: number;
    now: number;
  },
): Promise<SocialProfile> {
  const prev = (await store.get(update.ownerId, update.aboutId)) ?? {
    ownerId: update.ownerId,
    aboutId: update.aboutId,
    summary: "",
    affinity: 0,
    trust: 0.5,
    lastUpdated: update.now,
  };
  const next: SocialProfile = {
    ...prev,
    summary: update.summary?.trim() || prev.summary,
    affinity: clamp(prev.affinity + (update.affinityDelta ?? 0), -1, 1),
    trust: clamp(prev.trust + (update.trustDelta ?? 0), 0, 1),
    lastUpdated: update.now,
  };
  await store.upsert(next);
  return next;
}

/** Texto breve para el prompt: lo que el agente piensa de alguien. */
export function socialNote(profile: SocialProfile, name: string): string {
  const feel =
    profile.affinity > 0.4
      ? "te cae muy bien"
      : profile.affinity > 0.1
        ? "te cae bien"
        : profile.affinity < -0.4
          ? "no lo soportas"
          : profile.affinity < -0.1
            ? "no te convence"
            : "te es indiferente";
  const trust =
    profile.trust > 0.66
      ? "confías en él/ella"
      : profile.trust < 0.33
        ? "no te fías"
        : "confianza media";
  return `${name}: ${feel}, ${trust}. ${profile.summary}`.trim();
}

const SocialResponse = z.object({
  summary: z.string().default(""),
  affinityDelta: z.coerce.number().default(0),
  trustDelta: z.coerce.number().default(0),
});

/** Actualiza la ficha social tras una conversación (modelo "fast"). */
export async function updateSocialAfterConversation(
  llm: LLMClient,
  store: SocialProfileStore,
  opts: {
    owner: MemoryOwner;
    other: { id: string; name: string };
    transcript: string[];
    now: number;
    /** Protección de menores: si la opinión no pasa, la ficha no cambia. */
    guard?: MinorGuard;
  },
): Promise<SocialProfile> {
  const prev = await store.get(opts.owner.agentId, opts.other.id);
  const res = await llm.run({
    kind: "fast",
    task: "social",
    agentId: opts.owner.agentId,
    system: opts.owner.system,
    maxTokens: 400,
    prompt: `TAREA: social
Acabas de hablar con ${opts.other.name} (${opts.other.id}).
Lo que pensabas antes: ${prev?.summary || "(nada)"} (afinidad ${(prev?.affinity ?? 0).toFixed(2)}, confianza ${(prev?.trust ?? 0.5).toFixed(2)})
Conversación:
${opts.transcript.map((l) => `- ${l}`).join("\n")}

Actualiza tu opinión. summary: una frase sobre esa persona. affinityDelta y trustDelta entre -0.3 y 0.3.
Formato:
{"summary":"...","affinityDelta":0.05,"trustDelta":0}`,
  });
  const r = parseWith(SocialResponse, res.text);
  const safe = await opts.guard?.allows(r.summary, {
    kind: "social",
    actors: [opts.owner.agentId, opts.other.id],
    agentId: opts.owner.agentId,
  });
  if (safe === false) {
    return applySocialUpdate(store, {
      ownerId: opts.owner.agentId,
      aboutId: opts.other.id,
      now: opts.now,
    });
  }
  return applySocialUpdate(store, {
    ownerId: opts.owner.agentId,
    aboutId: opts.other.id,
    summary: r.summary,
    affinityDelta: clamp(r.affinityDelta, -0.3, 0.3),
    trustDelta: clamp(r.trustDelta, -0.3, 0.3),
    now: opts.now,
  });
}

// --- Consolidación nocturna ---------------------------------------------------------------

const ConsolidateResponse = z.object({
  questions: z.array(z.string()).default([]),
  insights: z
    .array(
      z.object({
        text: z.string(),
        cites: z.array(z.coerce.number().int()).default([]),
        importance: z.coerce.number().default(6),
        valence: z.coerce.number().default(0),
      }),
    )
    .default([]),
  facts: z
    .array(z.object({ text: z.string(), cites: z.array(z.coerce.number().int()).default([]) }))
    .default([]),
  people: z
    .array(
      z.object({
        id: z.string(),
        summary: z.string().default(""),
        affinityDelta: z.coerce.number().default(0),
        trustDelta: z.coerce.number().default(0),
      }),
    )
    .default([]),
});

export class LLMConsolidator implements Consolidator {
  constructor(
    private readonly llm: LLMClient,
    private readonly memory: MemorySystem,
    private readonly social: SocialProfileStore,
    private readonly knownAgents: () => { id: string; name: string }[],
  ) {}

  private get cfg(): MemoryConfig["consolidation"] {
    return this.memory.config.consolidation;
  }

  async consolidate(owner: MemoryOwner, from: number, now: number): Promise<ConsolidationResult> {
    const result: ConsolidationResult = {
      created: [],
      reinforced: [],
      weakened: [],
      questions: [],
    };
    const day = (await this.memory.store.listByAgent(owner.agentId)).filter(
      (m) => m.status === "active" && m.createdAt >= from && m.type !== "reflection",
    );
    if (!day.length || !this.cfg.enabled) return result;
    // Al dormir se repasa sobre todo lo importante y lo emocional.
    const salience = (m: MemoryRecord) => m.importance * (1 + Math.abs(m.emotionalValence));
    const chosen = [...day]
      .sort((a, b) => salience(b) - salience(a) || a.createdAt - b.createdAt)
      .slice(0, this.cfg.maxMemories);
    const people = this.knownAgents().filter((a) => a.id !== owner.agentId);

    const res = await this.llm.run({
      kind: "reflection",
      task: "consolidate",
      agentId: owner.agentId,
      system: owner.system,
      prompt: `TAREA: consolidate
Estás durmiendo y tu mente repasa el día. Recuerdos de hoy (numerados):
${chosen.map((m, i) => `${i + 1}. ${m.text}`).join("\n")}

Personas que conoces: ${people.map((p) => `${p.id}=${p.name}`).join(", ") || "nadie"}

1) Plantea hasta 3 preguntas salientes sobre tu vida a partir de estos recuerdos.
2) Responde con hasta ${this.cfg.maxInsights} reflexiones (insights), citando los números de los recuerdos en que se basan.
3) Extrae hechos estables (facts) que merezca la pena saber a largo plazo, con sus citas.
4) Para las personas que aparezcan, actualiza lo que piensas de ellas.
Formato:
{"questions":["..."],"insights":[{"text":"...","cites":[1,3],"importance":7,"valence":0.2}],"facts":[{"text":"...","cites":[2]}],"people":[{"id":"...","summary":"...","affinityDelta":0.05,"trustDelta":0}]}`,
    });
    const r = parseWith(ConsolidateResponse, res.text);
    result.questions = r.questions;
    const cited = new Set<string>();
    const idsOf = (cites: number[]) =>
      cites.map((n) => chosen[n - 1]?.id).filter((id): id is string => Boolean(id));

    for (const ins of r.insights.slice(0, this.cfg.maxInsights)) {
      const links = idsOf(ins.cites);
      const m = await this.memory.tryRemember(
        {
          agentId: owner.agentId,
          text: ins.text,
          type: "reflection",
          source: "inferido",
          importance: clamp(ins.importance, 1, 10),
          emotionalValence: clamp(ins.valence, -1, 1),
          links,
          people: [
            ...new Set(links.flatMap((id) => chosen.find((c) => c.id === id)?.people ?? [])),
          ],
        },
        now,
      );
      // Lo que descarta la protección de menores no cuenta como cita.
      if (!m) continue;
      links.forEach((id) => cited.add(id));
      result.created.push(m);
      this.memory.emitEffect({
        kind: "consolidate",
        agentId: owner.agentId,
        memoryId: m.id,
        text: m.text,
      });
    }
    for (const fact of r.facts) {
      const links = idsOf(fact.cites);
      const m = await this.memory.tryRemember(
        {
          agentId: owner.agentId,
          text: fact.text,
          type: "semantic",
          source: "inferido",
          importance: 6,
          links,
        },
        now,
      );
      if (!m) continue;
      links.forEach((id) => cited.add(id));
      result.created.push(m);
    }

    // Reforzar lo citado y lo emocional, y debilitar lo trivial no citado, con su auditoría,
    // de forma atómica. El sueño consolida preferentemente los recuerdos con carga emocional.
    const sleep = this.memory.config.sleep;
    const reinforced = chosen.filter((m) => cited.has(m.id));
    const emotional = day.filter(
      (m) => !cited.has(m.id) && Math.abs(m.emotionalValence) >= sleep.emotionalMin,
    );
    const emotionalGain = (m: MemoryRecord) =>
      1 + sleep.emotionalGain * Math.abs(m.emotionalValence);
    const weakened = day.filter(
      (m) =>
        !cited.has(m.id) && !emotional.includes(m) && m.importance <= this.cfg.trivialImportanceMax,
    );
    await this.memory.store.transaction(async (tx) => {
      await tx.updateMany([
        ...reinforced.map((m) => ({
          id: m.id,
          patch: {
            strength: Math.min(1, m.strength * this.cfg.reinforceFactor),
            stability: m.stability * this.cfg.reinforceFactor,
          },
        })),
        ...emotional.map((m) => ({
          id: m.id,
          patch: {
            strength: Math.min(1, m.strength * emotionalGain(m)),
            stability: m.stability * emotionalGain(m),
          },
        })),
        ...weakened.map((m) => ({
          id: m.id,
          patch: { strength: m.strength * this.cfg.weakenFactor },
        })),
      ]);
      for (const m of emotional) {
        await tx.addAudit({
          agentId: owner.agentId,
          memoryId: m.id,
          memoryText: m.text,
          action: "reinforced",
          reason: `el sueño consolida lo emocional (valencia ${m.emotionalValence.toFixed(2)})`,
          at: now,
        });
      }
      for (const m of reinforced) {
        await tx.addAudit({
          agentId: owner.agentId,
          memoryId: m.id,
          memoryText: m.text,
          action: "reinforced",
          reason: "citado en una reflexión nocturna",
          at: now,
        });
      }
      for (const m of weakened) {
        await tx.addAudit({
          agentId: owner.agentId,
          memoryId: m.id,
          memoryText: m.text,
          action: "weakened",
          reason: `trivial (importancia ${m.importance}) y no citado al consolidar`,
          at: now,
        });
      }
    });
    result.reinforced.push(...reinforced.map((m) => m.id), ...emotional.map((m) => m.id));
    result.weakened.push(...weakened.map((m) => m.id));

    const known = new Set(people.map((p) => p.id));
    for (const p of r.people.filter((x) => known.has(x.id))) {
      const safe = await this.memory.guard?.allows(p.summary, {
        kind: "social",
        actors: [owner.agentId, p.id],
        agentId: owner.agentId,
      });
      if (safe === false) continue;
      await applySocialUpdate(this.social, {
        ownerId: owner.agentId,
        aboutId: p.id,
        summary: p.summary,
        affinityDelta: clamp(p.affinityDelta, -0.3, 0.3),
        trustDelta: clamp(p.trustDelta, -0.3, 0.3),
        now,
      });
    }
    return result;
  }
}

// --- Esencia, reconsolidación y resumen ---------------------------------------------------

const GistResponse = z.object({ gist: z.string().min(1) });

export class LLMGistCompressor implements GistCompressor {
  constructor(private readonly llm: LLMClient) {}

  async compress(owner: MemoryOwner, memory: MemoryRecord): Promise<string> {
    const res = await this.llm.run({
      kind: "fast",
      task: "gist",
      agentId: owner.agentId,
      system: owner.system,
      maxTokens: 200,
      prompt: `TAREA: gist
Este recuerdo se está desvaneciendo. Quédate solo con la esencia, en pocas palabras y sin detalles concretos (nombres exactos, cifras, frases literales).
Recuerdo: "${memory.text}"
Formato:
{"gist":"..."}`,
    });
    return parseWith(GistResponse, res.text).gist;
  }
}

const ReconsolidateResponse = z.object({
  text: z.string().min(1),
  valence: z.coerce.number().default(0),
});

export class LLMReconsolidator implements Reconsolidator {
  constructor(private readonly llm: LLMClient) {}

  async reconsolidate(
    memory: MemoryRecord,
    ctx: { now: number; system: string; moodLabel: string; socialSummary: string },
  ) {
    const res = await this.llm.run({
      kind: "fast",
      task: "reconsolidate",
      agentId: memory.agentId,
      system: ctx.system,
      maxTokens: 300,
      prompt: `TAREA: reconsolidate
Estás recordando esto: "${memory.text}"
Tu ánimo ahora: ${ctx.moodLabel}. Lo que piensas de los implicados: ${ctx.socialSummary || "(nada)"}
Los recuerdos cambian un poco cada vez que se evocan. Reescríbelo con UN cambio sutil coherente con tu ánimo y tus opiniones (un matiz, un detalle que exageras o suavizas). Mantén la longitud y la primera persona.
Formato:
{"text":"...","valence":0.1}`,
    });
    const r = parseWith(ReconsolidateResponse, res.text);
    return { text: r.text, emotionalValence: clamp(r.valence, -1, 1) };
  }

  async confabulate(
    memory: MemoryRecord,
    vague: string,
    ctx: { now: number; system: string; moodLabel: string; socialSummary: string },
  ) {
    const res = await this.llm.run({
      kind: "fast",
      task: "confabulate",
      agentId: memory.agentId,
      system: ctx.system,
      maxTokens: 300,
      prompt: `TAREA: confabulate
Intentas recordar algo de lo que apenas te acuerdas: "${vague}"
Tu ánimo ahora: ${ctx.moodLabel}. Lo que piensas de los implicados: ${ctx.socialSummary || "(nada)"}
Sin darte cuenta, tu mente rellena los huecos: reescribe el recuerdo en primera persona añadiendo uno o dos detalles concretos y plausibles (un lugar, una frase, un gesto) que en realidad no recuerdas, pero que ahora crees ciertos. Que encaje con lo poco que sí recuerdas, con tu ánimo y con lo que piensas de los demás.
Formato:
{"text":"...","valence":0.1}`,
    });
    const r = parseWith(ReconsolidateResponse, res.text);
    return { text: r.text, emotionalValence: clamp(r.valence, -1, 1) };
  }
}

const SummaryResponse = z.object({ summary: z.string().min(1) });

export class LLMEpisodeSummarizer implements EpisodeSummarizer {
  constructor(private readonly llm: LLMClient) {}

  async summarize(owner: MemoryOwner, episodes: MemoryRecord[]): Promise<string> {
    const res = await this.llm.run({
      kind: "reflection",
      task: "summarize",
      agentId: owner.agentId,
      system: owner.system,
      maxTokens: 400,
      prompt: `TAREA: summarize
Resume en una o dos frases, en primera persona, lo que tienen en común estos recuerdos (como recordarías esa época en general):
${episodes.map((m, i) => `${i + 1}. ${m.text}`).join("\n")}
Formato:
{"summary":"..."}`,
    });
    return parseWith(SummaryResponse, res.text).summary;
  }
}

// --- Confusión de fuente --------------------------------------------------------------------

export class RandomSourceConfuser implements SourceConfuser {
  constructor(
    private readonly rng: Rng,
    private readonly toLivedShare: number,
  ) {}

  confuse(memory: MemoryRecord, probability: number, others: string[]): MemorySource | null {
    if (!memory.source.startsWith("contado por ")) return null;
    if (this.rng() >= probability) return null;
    const teller = memory.source.slice("contado por ".length);
    const alternatives = others.filter((o) => o !== teller);
    if (this.rng() < this.toLivedShare || !alternatives.length) return "vivido";
    return `contado por ${alternatives[Math.floor(this.rng() * alternatives.length)]}`;
  }
}

/** Fuerza actual helper re-exportado para quien implemente políticas. */
export { currentStrength };
