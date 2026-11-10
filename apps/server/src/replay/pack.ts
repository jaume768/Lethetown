/**
 * Paquete de repetición a partir de una partida grabada (`record` → messages.jsonl,
 * states.jsonl, positions.jsonl, manifest.json, meta.json; `world:export` → <tabla>.jsonl).
 * Lista blanca: todo pasa por los esquemas de `ReplayBundle` (zod descarta lo que no conoce) y
 * solo se leen las tablas que usan los paneles; nunca llm_calls (salvo el nombre del modelo),
 * moderación, usuarios ni sesiones. Puro salvo `readRecording`/`readExport` (lectura de ficheros).
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { clarityFor, currentStrength, type MemoryConfig } from "@lethetown/agent-core";
import {
  AgentState,
  Goal,
  Lore,
  LoreHolder,
  MemoryAuditEntry,
  MemoryVersion,
  MemoryView,
  REPLAY_FORMAT,
  REPLAY_VERSION,
  ReplayBundle,
  ReplayData,
  ReplayMessage,
  ReplayTrack,
  SkillState,
  SocialProfile,
  SocialProfileChange,
  agentPatch,
  conversationOf,
  STORY_ACTIONS,
  LONG_CONVERSATION_TURNS,
  type ExternalMark,
  type ReplayFrame,
  type ReplayMemory,
  type World,
} from "@lethetown/shared";
import { readJsonl } from "../analysis/study-files";
import { StudyManifest } from "../analysis/manifest";

type Row = Record<string, unknown>;

export interface Recording {
  messages: Row[];
  states: Row[];
  positions: Row[];
  manifest: StudyManifest | null;
  meta: Row | null;
}

/** Tablas de `world:export` que usa la repetición (las demás no se leen). */
export const EXPORT_TABLES = [
  "memories",
  "memory_audit",
  "memory_versions",
  "social_profiles",
  "social_profile_history",
  "goals",
  "skills",
  "lore",
  "lore_holders",
  "knowledge_log",
  "llm_calls",
] as const;
export type ExportRows = Record<(typeof EXPORT_TABLES)[number], Row[]>;

function readJson(file: string): Row | null {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as Row;
  } catch {
    return null;
  }
}

export function readRecording(dir: string): Recording {
  const manifest = StudyManifest.safeParse(readJson(join(dir, "manifest.json")));
  return {
    messages: readJsonl(join(dir, "messages.jsonl")),
    states: readJsonl(join(dir, "states.jsonl")),
    positions: readJsonl(join(dir, "positions.jsonl")),
    manifest: manifest.success ? manifest.data : null,
    meta: readJson(join(dir, "meta.json")),
  };
}

/** La exportación de la BD (en la carpeta o en su subcarpeta bd/), o null si no hay. */
export function readExport(dir: string): ExportRows | null {
  const db = existsSync(join(dir, "bd")) ? join(dir, "bd") : dir;
  if (!existsSync(join(db, "memories.jsonl"))) return null;
  return Object.fromEntries(
    EXPORT_TABLES.map((t) => [t, readJsonl(join(db, `${t}.jsonl`))]),
  ) as ExportRows;
}

/** Claves de una fila de Postgres (snake_case) en camelCase (solo el primer nivel). */
export function camel(row: Row): Row {
  return Object.fromEntries(
    Object.entries(row).map(([k, v]) => [
      k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase()),
      v,
    ]),
  );
}

/** Las filas que encajan en el esquema (las demás se descartan). */
function rows<T>(
  schema: { safeParse(x: unknown): { success: boolean; data?: T } },
  list: Row[],
): T[] {
  return list.flatMap((r) => {
    const parsed = schema.safeParse(camel(r));
    return parsed.success ? [parsed.data as T] : [];
  });
}

/** De hora real (ms) a minuto de juego, con muestras (wallMs, minuto) ordenadas. */
export function clockFrom(samples: { wallMs: number; time: number }[]): (ms: number) => number {
  const s = [...samples].sort((a, b) => a.wallMs - b.wallMs);
  return (ms) => {
    if (!s.length) return 0;
    if (ms <= s[0]!.wallMs) return s[0]!.time;
    let lo = 0;
    let hi = s.length - 1;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (s[mid]!.wallMs <= ms) lo = mid;
      else hi = mid - 1;
    }
    const a = s[lo]!;
    const b = s[lo + 1];
    if (!b || b.wallMs === a.wallMs) return a.time;
    return a.time + ((b.time - a.time) * (ms - a.wallMs)) / (b.wallMs - a.wallMs);
  };
}

/** Acciones de la auditoría que no cuentan nada (archivar, reforzar, debilitar, borrar). */
const AUDIT_NOISE = new Set(["archived", "reinforced", "weakened", "deleted"]);
/** Cada cuánto se muestrea la fuerza de un recuerdo (minutos de juego). */
export const STRENGTH_SAMPLE_MINUTES = 360;
/** Recuerdos que entran siempre (los demás, solo si son de un momento o cambiaron). */
export const MIN_IMPORTANCE = 4;

export interface PackOptions {
  from?: number;
  to?: number;
  world: World;
  map: Row;
  memory: Pick<MemoryConfig, "retrieval" | "skills">;
  /** Semilla de la partida, si el manifiesto no la trae (`--seed`). */
  seed?: number;
}

/** El paquete entero (validado: lo que no pasa el esquema, no entra). */
export function buildBundle(
  rec: Recording,
  exp: ExportRows | null,
  opts: PackOptions,
): ReplayBundle {
  const num = (x: unknown) => (typeof x === "number" ? x : Number(x));
  // El reloj: las fotos y los eventos traen minuto de juego y hora real.
  const samples: { wallMs: number; time: number }[] = [];
  for (const s of rec.states) samples.push({ wallMs: num(s.wallMs), time: num(s.time) });
  for (const m of rec.messages) {
    const ev = m.event as Row | undefined;
    if (m.type === "event" && ev) samples.push({ wallMs: num(m.wallMs), time: num(ev.time) });
  }
  const toGame = clockFrom(samples.filter((s) => Number.isFinite(s.wallMs + s.time)));
  const times = rec.states.map((s) => num(s.time)).filter(Number.isFinite);
  const from = opts.from ?? (times.length ? Math.min(...times) : 0);
  const to = opts.to ?? (times.length ? Math.max(...times) : from);
  const inRange = (t: number) => t >= from && t <= to;

  const messages: ReplayMessage[] = [];
  for (const m of rec.messages) {
    const t =
      m.type === "event"
        ? num((m.event as Row)?.time)
        : m.type === "drama"
          ? num((m.drama as Row)?.time)
          : toGame(num(m.wallMs));
    if (!inRange(t)) continue;
    // De un efecto de memoria el mapa solo usa quién y cuál (el texto ya está en los recuerdos).
    const msg = m.type === "memory_effect" ? { ...m, text: "", others: undefined } : m;
    const parsed = ReplayMessage.safeParse({ t, msg });
    if (parsed.success) messages.push(parsed.data);
  }
  messages.sort((a, b) => a.t - b.t);

  const frames: ReplayFrame[] = [];
  let prev = new Map<string, AgentState>();
  for (const s of [...rec.states].sort((a, b) => num(a.time) - num(b.time))) {
    const time = num(s.time);
    if (!inRange(time)) continue;
    const agents = ((s.agents as unknown[]) ?? []).flatMap((a) => {
      const p = AgentState.safeParse(a);
      return p.success ? [p.data] : [];
    });
    const next = new Map(agents.map((a) => [a.id, a]));
    const patches = agents.flatMap((a) => agentPatch(prev.get(a.id), a) ?? []);
    const removed = [...prev.keys()].filter((id) => !next.has(id));
    frames.push({ time, agents: patches, ...(removed.length ? { removed } : {}) });
    prev = next;
  }
  if (!frames.length) throw new Error("La grabación no tiene fotos (states.jsonl) en ese rango");

  const track = rows<ReplayTrack>(ReplayTrack, rec.positions).filter((p) => inRange(p.time));
  const data = exp ? buildData(exp, { from, to, messages, memory: opts.memory }) : undefined;

  const man = rec.manifest;
  const startedAt = typeof rec.meta?.startedAt === "string" ? rec.meta.startedAt : man?.createdAt;
  // En mock no habló ningún modelo (aunque .env tenga los de Anthropic).
  const models =
    man?.provider === "mock"
      ? ["mock"]
      : man && Object.keys(man.models).length
        ? Object.values(man.models)
        : (exp?.llm_calls ?? []).map((r) => String(r.model));
  return ReplayBundle.parse({
    format: REPLAY_FORMAT,
    version: REPLAY_VERSION,
    meta: {
      seed: opts.seed ?? man?.seed ?? null,
      playedOn: startedAt && /^\d{4}-\d{2}-\d{2}/.test(startedAt) ? startedAt.slice(0, 10) : null,
      models: [...new Set(models)].filter((m) => /^[\w.:-]{1,80}$/.test(m)).slice(0, 10),
      code: man?.sha && /^[0-9a-f]{7,40}$/.test(man.sha) ? man.sha.slice(0, 10) : null,
      from,
      to,
      durationMinutes: to - from,
      walkTilesPerMinute: 6,
      thresholds: {
        forget: opts.memory.retrieval.forgetThreshold,
        vague: opts.memory.retrieval.vagueThreshold,
      },
    },
    world: opts.world,
    map: opts.map,
    messages,
    frames,
    ...(track.length ? { track } : {}),
    ...(data ? { data } : {}),
  });
}

/** Los datos de los paneles: recuerdos con su fuerza muestreada, fichas, metas, saberes… */
export function buildData(
  exp: ExportRows,
  opts: {
    from: number;
    to: number;
    messages: readonly ReplayMessage[];
    memory: Pick<MemoryConfig, "retrieval" | "skills">;
  },
): ReplayData {
  const { from, to } = opts;
  const auditAll = rows<MemoryAuditEntry>(MemoryAuditEntry, exp.memory_audit).filter(
    (a) => a.at <= to,
  );
  const archivedAt = new Map<string, number>();
  for (const a of auditAll) {
    if (a.action === "archived" && !archivedAt.has(a.memoryId)) archivedAt.set(a.memoryId, a.at);
  }
  const versions = rows<MemoryVersion>(MemoryVersion, exp.memory_versions).filter(
    (v) => v.at <= to,
  );
  const changed = new Set(versions.map((v) => v.memoryId));
  // Los que tienen historia (se vuelven vagos, cambian de fuente, se olvidan…): la tarjeta
  // «así muere un recuerdo» necesita su texto y su curva.
  const storied = new Set(
    auditAll.filter((a) => STORY_ACTIONS.includes(a.action)).map((a) => a.memoryId),
  );
  // Recuerdos de los momentos (dramas y conversaciones largas, para la vista Rashomon).
  const keyEvents = new Set<string>();
  const turns = new Map<string, number>();
  for (const { msg } of opts.messages) {
    if (msg.type === "drama" && msg.drama.eventId) keyEvents.add(conversationOf(msg.drama.eventId));
    if (msg.type === "event" && msg.event.kind === "speech") {
      const id = conversationOf(msg.event.id);
      turns.set(id, (turns.get(id) ?? 0) + 1);
    }
  }
  for (const [id, n] of turns) if (n >= LONG_CONVERSATION_TURNS) keyEvents.add(id);
  const stability = new Map(exp.memories.map((r) => [String(r.id), Number(r.stability ?? 1)]));
  const memories: ReplayMemory[] = rows<MemoryView>(MemoryView, exp.memories)
    .filter((m) => m.createdAt <= to)
    .filter(
      (m) =>
        m.importance >= MIN_IMPORTANCE ||
        changed.has(m.id) ||
        storied.has(m.id) ||
        (m.eventId !== null && keyEvents.has(m.eventId)),
    )
    .map((m) => ({
      ...m,
      strengthAt: strengthSamples(
        { ...m, stability: stability.get(m.id) ?? 1 },
        from,
        to,
        opts.memory.retrieval,
      ),
      archivedAt: archivedAt.get(m.id) ?? null,
    }));
  const kept = new Set(memories.map((m) => m.id));
  return ReplayData.parse({
    memories,
    audit: auditAll.filter((a) => !AUDIT_NOISE.has(a.action)),
    versions: versions.filter((v) => kept.has(v.memoryId)),
    profiles: rows<SocialProfile>(SocialProfile, exp.social_profiles),
    history: rows<SocialProfileChange>(SocialProfileChange, exp.social_profile_history).filter(
      (c) => c.at <= to,
    ),
    goals: rows<Goal>(Goal, exp.goals).filter((g) => g.createdAt <= to),
    skills: rows<SkillState>(SkillState, exp.skills),
    skillLabels: Object.fromEntries(opts.memory.skills.catalog.map((s) => [s.id, s.label])),
    lore: rows<Lore>(Lore, exp.lore).filter((l) => l.createdAt <= to),
    holders: rows<LoreHolder>(LoreHolder, exp.lore_holders).filter((h) => h.learnedAt <= to),
  });
}

/**
 * Fuerza de un recuerdo cada `STRENGTH_SAMPLE_MINUTES`, con la curva de olvido del motor, desde
 * que se recordó por última vez (antes no se sabe: no se guarda la historia de la fuerza).
 */
export function strengthSamples(
  m: { strength: number; stability: number; lastAccessedAt: number; createdAt: number },
  from: number,
  to: number,
  retrieval: MemoryConfig["retrieval"],
): ReplayMemory["strengthAt"] {
  const start = Math.max(m.createdAt, m.lastAccessedAt, from);
  const out: ReplayMemory["strengthAt"] = [];
  for (let t = start; ; t = Math.min(to, t + STRENGTH_SAMPLE_MINUTES)) {
    const s = Math.min(1, Math.max(0, currentStrength(m, t)));
    out.push([
      Math.round(t * 100) / 100,
      Math.round(s * 10_000) / 10_000,
      clarityFor(s, retrieval),
    ]);
    // Olvidado: ya no hay más que contar.
    if (t >= to || out[out.length - 1]![2] === "forgotten") break;
  }
  return out;
}

/** Nombres que marcó el `PersonGuard` o el registro de referencias externas (knowledge_log). */
export function externalMarks(exp: ExportRows | null, from: number, to: number): ExternalMark[] {
  return (exp?.knowledge_log ?? []).flatMap((r) => {
    const at = Number(r.at);
    if (!(at >= from && at <= to) || typeof r.agent_id !== "string") return [];
    return [
      {
        at,
        agentId: r.agent_id,
        term: String(r.term ?? ""),
        label: String(r.label ?? ""),
        text: String(r.text ?? ""),
      },
    ];
  });
}
