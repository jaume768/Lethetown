/**
 * Memoria humana completa (fase G): consolidación nocturna, esencia, reconsolidación,
 * confusión de fuente, fichas sociales y resumen de episodios. Interfaces + implementaciones
 * con LLM (inyectado). Los prompts siguen el formato "TAREA: <nombre>" que entiende el MockProvider.
 */
import {
  AGREEMENT_TYPES,
  Agreement,
  type MemorySource,
  type SocialProfile,
  type SocialProfileChange,
} from "@lethetown/shared";
import { z } from "zod";
import { hasStrongRomance, type MinorGuard } from "../agent/minor-safety";
import { extractJson, parseWith } from "../agent/parse";
import { MAX_TOKENS } from "../llm/limits";
import type { LLMClient } from "../llm/client";
import type { Rng } from "../util/random";
import type { MemoryConfig } from "./config";
import { currentStrength } from "./decay";
import type { MemorySystem } from "./memory-system";
import { IntentionInput } from "./prospective";
import { SocialConfig, classifyRelationship, grudgeAfter, relationshipLabel } from "./social";

const DEFAULT_SOCIAL = SocialConfig.parse({});
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
  /** Lo que devolvió el modelo en el campo de cada parte extra (por `key`; sin validar). */
  extras: Record<string, unknown>;
}

/**
 * Lo que un sistema del servidor añade a la consolidación (sus metas, p. ej.): un texto para el
 * prompt y el campo de la respuesta donde espera lo suyo. Va en la misma llamada.
 */
export interface ConsolidationExtra {
  key: string;
  prompt: string;
}

/** Consolidación nocturna / reflexión (Park et al.) con citas a los recuerdos fuente. */
export interface Consolidator {
  consolidate(
    owner: MemoryOwner,
    from: number,
    now: number,
    extras?: ConsolidationExtra[],
  ): Promise<ConsolidationResult>;
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
  /** Todas las fichas del mundo (red del pueblo). */
  listAll(): Promise<SocialProfile[]>;
  /** Historial de cambios de las fichas. */
  addHistory(change: SocialProfileChange): Promise<void>;
  /**
   * Historial (de una ficha si se pasa `aboutId`, de todas las del dueño si no, o de todo el
   * mundo si `ownerId` es null), del más antiguo al más reciente, a partir de `since`.
   */
  history(
    ownerId: string | null,
    aboutId?: string,
    opts?: { since?: number; limit?: number },
  ): Promise<SocialProfileChange[]>;
}

// --- Fichas sociales ------------------------------------------------------------------------

export class InMemorySocialProfileStore implements SocialProfileStore {
  private readonly profiles = new Map<string, SocialProfile>();
  private readonly changes: SocialProfileChange[] = [];

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

  async listAll() {
    return [...this.profiles.values()].map((p) => ({ ...p }));
  }

  async addHistory(change: SocialProfileChange) {
    this.changes.push({ ...change });
  }

  /**
   * Retención del historial anterior a `before` (minutos de juego): "delete" lo borra y
   * "summarize" deja solo el último cambio de cada pareja y día de juego. Devuelve cuántos quitó.
   */
  pruneHistory(before: number, mode: "delete" | "summarize"): number {
    const lastOfDay = new Map<string, SocialProfileChange>();
    for (const c of this.changes) {
      if (c.at < before) lastOfDay.set(`${c.ownerId}|${c.aboutId}|${Math.floor(c.at / 1440)}`, c);
    }
    const kept = this.changes.filter(
      (c) =>
        c.at >= before ||
        (mode === "summarize" &&
          lastOfDay.get(`${c.ownerId}|${c.aboutId}|${Math.floor(c.at / 1440)}`) === c),
    );
    const removed = this.changes.length - kept.length;
    this.changes.splice(0, this.changes.length, ...kept);
    return removed;
  }

  async history(
    ownerId: string | null,
    aboutId?: string,
    opts: { since?: number; limit?: number } = {},
  ) {
    return this.changes
      .filter(
        (c) =>
          (ownerId === null || c.ownerId === ownerId) &&
          (!aboutId || c.aboutId === aboutId) &&
          c.at >= (opts.since ?? -Infinity),
      )
      .slice(0, opts.limit ?? 1000)
      .map((c) => ({ ...c }));
  }
}

const clamp = (x: number, lo: number, hi: number) =>
  Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : lo;

/** Ficha nueva (alguien de quien aún no sabe nada). */
export function emptyProfile(ownerId: string, aboutId: string, now: number): SocialProfile {
  return {
    ownerId,
    aboutId,
    summary: "",
    affinity: 0,
    trust: 0.5,
    familiarity: 0.1,
    relationshipType: "neighbor",
    bond: null,
    grudge: 0,
    lastUpdated: now,
  };
}

/**
 * Aplica un cambio a la ficha social (crea la ficha si no existe): afinidad, confianza,
 * familiaridad, rencor y tipo de relación, y deja constancia en el historial con su motivo.
 */
export async function applySocialUpdate(
  store: SocialProfileStore,
  update: {
    ownerId: string;
    aboutId: string;
    summary?: string;
    affinityDelta?: number;
    trustDelta?: number;
    familiarityDelta?: number;
    /** Afinidad absoluta (perdón, semillas); si se pasa, manda sobre `affinityDelta`. */
    affinity?: number;
    now: number;
    /** Por qué cambia (historial). */
    reason?: string;
    eventId?: string | null;
    /** ¿Hay un menor implicado? Entonces la relación nunca es romántica. */
    minorInvolved?: boolean;
    /** La opinión deja claro un interés romántico (solo cuenta entre adultos). */
    romanticHint?: boolean;
    /** Vínculo de base (semillas). */
    bond?: SocialProfile["bond"];
    config?: SocialConfig;
  },
): Promise<SocialProfile> {
  const cfg = update.config ?? DEFAULT_SOCIAL;
  const prev =
    (await store.get(update.ownerId, update.aboutId)) ??
    emptyProfile(update.ownerId, update.aboutId, update.now);
  const affinity = clamp(update.affinity ?? prev.affinity + (update.affinityDelta ?? 0), -1, 1);
  const base = {
    ...prev,
    summary: update.summary?.trim() || prev.summary,
    affinity,
    trust: clamp(prev.trust + (update.trustDelta ?? 0), 0, 1),
    familiarity: clamp(prev.familiarity + (update.familiarityDelta ?? 0), 0, 1),
    grudge: grudgeAfter(prev.grudge, affinity - prev.affinity, cfg),
    bond: update.bond === undefined ? prev.bond : update.bond,
    lastUpdated: update.now,
  };
  const next: SocialProfile = {
    ...base,
    relationshipType: classifyRelationship(
      base,
      {
        minorInvolved: update.minorInvolved ?? false,
        // Un romance que ya existe se mantiene mientras no se rompa (afinidad, rivalidad).
        romanticHint: update.romanticHint || prev.relationshipType === "romantic",
      },
      cfg,
    ),
  };
  await store.upsert(next);
  const changed =
    Math.abs(next.affinity - prev.affinity) >= 0.005 ||
    Math.abs(next.trust - prev.trust) >= 0.005 ||
    Math.abs(next.familiarity - prev.familiarity) >= 0.005 ||
    next.relationshipType !== prev.relationshipType;
  if (changed) {
    await store.addHistory({
      ownerId: next.ownerId,
      aboutId: next.aboutId,
      at: update.now,
      affinity: next.affinity,
      trust: next.trust,
      familiarity: next.familiarity,
      relationshipType: next.relationshipType,
      reason: update.reason ?? "cambio de opinión",
      eventId: update.eventId ?? null,
    });
  }
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
  const known = profile.familiarity < 0.2 ? ", apenas os tratáis" : "";
  return `${name} (${relationshipLabel(profile.relationshipType)}${known}): ${feel}, ${trust}. ${profile.summary}`.trim();
}

/** Un acuerdo que no se entiende se queda vacío (y se descarta), sin tirar los demás. */
const NO_AGREEMENT = Agreement.parse({ type: "" });

const SocialResponse = z.object({
  summary: z.string().default(""),
  affinityDelta: z.coerce.number().default(0),
  trustDelta: z.coerce.number().default(0),
  /** Lo que se ha propuesto hacer a raíz de la charla (memoria prospectiva). */
  intentions: z.array(IntentionInput).catch([]).default([]),
  /** Lo acordado de forma explícita (citas, préstamos…): el motor lo lleva a cabo. */
  agreements: z.array(Agreement.catch(NO_AGREEMENT)).catch([]).default([]),
});

/** Tipos de acuerdo para el prompt de la tarea social (una línea por tipo). */
const AGREEMENT_LINES = Object.entries(AGREEMENT_TYPES)
  .map(([type, what]) => `  · ${type}: ${what}`)
  .join("\n");

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
    /** Intenciones que surgen de la charla (promesas, quedadas…). */
    onIntentions?: (intentions: IntentionInput[]) => Promise<void>;
    /**
     * Acuerdos explícitos de la charla (puente a las acciones del motor). Se llama antes que
     * `onIntentions`, para que las intenciones de un compromiso ya creado se enlacen a él.
     */
    onAgreements?: (agreements: Agreement[]) => Promise<void>;
    /** Líneas de contexto para los acuerdos (p. ej. los objetos que lleváis y sus ids). */
    context?: string[];
    /** Conversación (para el historial de la ficha). */
    eventId?: string;
    config?: SocialConfig;
  },
): Promise<SocialProfile> {
  const prev = await store.get(opts.owner.agentId, opts.other.id);
  const res = await llm.run({
    kind: "fast",
    task: "social",
    agentId: opts.owner.agentId,
    system: opts.owner.system,
    maxTokens: MAX_TOKENS.social,
    prompt: `TAREA: social
Acabas de hablar con ${opts.other.name} (${opts.other.id}).
Lo que pensabas antes: ${prev?.summary || "(nada)"} (afinidad ${(prev?.affinity ?? 0).toFixed(2)}, confianza ${(prev?.trust ?? 0.5).toFixed(2)})
Conversación:
${opts.transcript.map((l) => `- ${l}`).join("\n")}

Actualiza tu opinión. summary: una frase sobre esa persona. affinityDelta y trustDelta entre -0.3 y 0.3.
Si en la charla has quedado en algo o te has propuesto hacer algo más adelante (una promesa, una quedada, devolver algo), ponlo en intentions: text en infinitivo y, si aplica, personId, placeId o la hora (at, "HH:MM"). Si no, [].
Si habéis acordado algo concreto entre los dos (no solo mencionado: que el otro haya dicho que sí), ponlo también en agreements, con type, from (id de quien lo propone, da o invita), to (ids de los demás), los datos que hagan falta y quote (la frase que lo cierra). Si no, [].
${AGREEMENT_LINES}${opts.context?.length ? `\n${opts.context.join("\n")}` : ""}
Formato:
{"summary":"...","affinityDelta":0.05,"trustDelta":0,"intentions":[{"text":"...","personId":"...","placeId":null,"at":null}],"agreements":[{"type":"meeting","from":"...","to":["..."],"placeId":"...","at":"17:00","day":"mañana","itemId":null,"what":"tomar algo","quote":"Vale, a las cinco."}]}`,
  });
  const r = parseWith(SocialResponse, res.text);
  const agreements = r.agreements.filter((a) => a.type);
  if (agreements.length) await opts.onAgreements?.(agreements);
  if (r.intentions.length) await opts.onIntentions?.(r.intentions);
  const safe = await opts.guard?.allows(r.summary, {
    kind: "social",
    actors: [opts.owner.agentId, opts.other.id],
    agentId: opts.owner.agentId,
  });
  const cfg = opts.config ?? DEFAULT_SOCIAL;
  const common = {
    ownerId: opts.owner.agentId,
    aboutId: opts.other.id,
    now: opts.now,
    // Hablar acerca: cada conversación suma familiaridad.
    familiarityDelta: cfg.conversationFamiliarity,
    eventId: opts.eventId ?? null,
    minorInvolved:
      (opts.guard?.isMinor(opts.owner.agentId) || opts.guard?.isMinor(opts.other.id)) ?? false,
    config: cfg,
  };
  if (safe === false) return applySocialUpdate(store, { ...common, reason: "hablaron" });
  return applySocialUpdate(store, {
    ...common,
    summary: r.summary,
    affinityDelta: clamp(r.affinityDelta, -0.3, 0.3),
    trustDelta: clamp(r.trustDelta, -0.3, 0.3),
    reason: `hablaron: ${r.summary || "sin más"}`,
    romanticHint: hasStrongRomance(r.summary),
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

  async consolidate(
    owner: MemoryOwner,
    from: number,
    now: number,
    extras: ConsolidationExtra[] = [],
  ): Promise<ConsolidationResult> {
    const result: ConsolidationResult = {
      created: [],
      reinforced: [],
      weakened: [],
      questions: [],
      extras: {},
    };
    const day = (await this.memory.store.listActive(owner.agentId)).filter(
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
4) Para las personas que aparezcan, actualiza lo que piensas de ellas.${extras.map((e, i) => `\n${i + 5}) ${e.prompt}`).join("")}
Formato:
{"questions":["..."],"insights":[{"text":"...","cites":[1,3],"importance":7,"valence":0.2}],"facts":[{"text":"...","cites":[2]}],"people":[{"id":"...","summary":"...","affinityDelta":0.05,"trustDelta":0}]${extras.map((e) => `,"${e.key}":…`).join("")}}`,
    });
    const r = parseWith(ConsolidateResponse, res.text);
    result.questions = r.questions;
    if (extras.length) {
      // Lo de cada sistema, tal cual: lo valida y lo aplica el motor (nunca el modelo).
      const raw = extractJson(res.text) as Record<string, unknown>;
      for (const e of extras) result.extras[e.key] = raw[e.key];
    }
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
        reason: `al repasar el día: ${p.summary || "sin más"}`,
        minorInvolved:
          (this.memory.guard?.isMinor(owner.agentId) || this.memory.guard?.isMinor(p.id)) ?? false,
        romanticHint: hasStrongRomance(p.summary),
        config: this.memory.config.social,
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
      maxTokens: MAX_TOKENS.gist,
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
      maxTokens: MAX_TOKENS.reconsolidate,
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
      maxTokens: MAX_TOKENS.confabulate,
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
      maxTokens: MAX_TOKENS.summarize,
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
