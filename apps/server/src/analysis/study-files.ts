/**
 * Lee una partida grabada (`record` → messages.jsonl; `world:export` → <tabla>.jsonl, en la
 * carpeta o en su subcarpeta bd/) y la convierte en la entrada del análisis de evolución.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Goal } from "@lethetown/shared";
import type {
  AgentSeed,
  MemoryAuditAction,
  MemoryAuditEntry,
  SimEvent,
  SimEventKind,
  SocialProfileChange,
} from "@lethetown/shared";
import type { EvolutionInput, KnowledgeRow, LlmCallRow } from "./evolution";

type Row = Record<string, unknown>;

/** Filas de un JSONL (las líneas que no se entienden se saltan). */
export function readJsonl(file: string): Row[] {
  if (!existsSync(file)) return [];
  const out: Row[] = [];
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as Row);
    } catch {
      // Una línea cortada (p. ej. al parar la grabación) no tira el análisis.
    }
  }
  return out;
}

const num = (x: unknown) => (typeof x === "number" ? x : Number(x ?? 0));
const str = (x: unknown) => (typeof x === "string" ? x : x == null ? "" : String(x));

/** Un evento de `sim_events` (columnas en snake_case) o del WebSocket. */
function toEvent(r: Row): SimEvent {
  return {
    id: str(r.id),
    time: num(r.time),
    agentId: (r.agent_id ?? r.agentId ?? null) as string | null,
    kind: str(r.kind) as SimEventKind,
    text: str(r.text),
    participants: (r.participants as string[] | null) ?? [],
    ...(r.meta ? { meta: r.meta as SimEvent["meta"] } : {}),
  };
}

/** De hora real (ms) a minuto de juego, con los eventos grabados (los más cercanos antes). */
function clockMap(samples: { wallMs: number; time: number }[]): (ms: number) => number | null {
  const sorted = [...samples].sort((a, b) => a.wallMs - b.wallMs);
  return (ms) => {
    if (!sorted.length || ms < sorted[0]!.wallMs) return null;
    let lo = 0;
    let hi = sorted.length - 1;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (sorted[mid]!.wallMs <= ms) lo = mid;
      else hi = mid - 1;
    }
    return sorted[lo]!.time;
  };
}

export function loadStudy(dir: string, seeds: AgentSeed[]): EvolutionInput {
  const db = existsSync(join(dir, "bd")) ? join(dir, "bd") : dir;
  // Lo que llegó por el WebSocket: eventos con su hora real.
  const wallMs = new Map<string, number>();
  const wsEvents: SimEvent[] = [];
  const samples: { wallMs: number; time: number }[] = [];
  for (const m of readJsonl(join(dir, "messages.jsonl"))) {
    if (m.type !== "event" || !m.event) continue;
    const e = toEvent(m.event as Row);
    wsEvents.push(e);
    wallMs.set(e.id, num(m.wallMs));
    samples.push({ wallMs: num(m.wallMs), time: e.time });
  }
  // La BD tiene todos los eventos (el WebSocket se pierde lo que pasa mientras está caído).
  const dbEvents = readJsonl(join(db, "sim_events.jsonl")).map(toEvent);
  const events = dbEvents.length ? dbEvents : wsEvents;
  const audits: MemoryAuditEntry[] = readJsonl(join(db, "memory_audit.jsonl")).map((r) => ({
    agentId: str(r.agent_id),
    memoryId: str(r.memory_id),
    memoryText: str(r.memory_text),
    action: str(r.action) as MemoryAuditAction,
    reason: str(r.reason),
    at: num(r.at),
  }));
  const socialHistory = readJsonl(join(db, "social_profile_history.jsonl")).map(
    (r) =>
      ({
        ownerId: str(r.owner_id),
        aboutId: str(r.about_id),
        at: num(r.at),
        affinity: num(r.affinity),
        trust: num(r.trust),
        familiarity: num(r.familiarity),
        relationshipType: str(r.relationship_type),
        reason: str(r.reason),
        eventId: (r.event_id ?? null) as string | null,
      }) as SocialProfileChange,
  );
  const toGame = clockMap(samples);
  const llmCalls: LlmCallRow[] = readJsonl(join(db, "llm_calls.jsonl")).map((r) => ({
    task: str(r.task),
    model: str(r.model),
    usd: num(r.usd),
    inputTokens: num(r.input_tokens),
    outputTokens: num(r.output_tokens),
    cacheReadTokens: num(r.cache_read_tokens),
    cacheWriteTokens: num(r.cache_write_tokens),
    time: r.at ? toGame(new Date(str(r.at)).getTime()) : null,
  }));
  const knowledge: KnowledgeRow[] = readJsonl(join(db, "knowledge_log.jsonl")).map((r) => ({
    at: num(r.at),
    agentId: (r.agent_id ?? null) as string | null,
    kind: str(r.kind),
    term: str(r.term),
    label: str(r.label),
    text: str(r.text),
    source: str(r.source),
  }));
  const goals: Goal[] = readJsonl(join(db, "goals.jsonl")).flatMap((r) => {
    const parsed = Goal.safeParse({
      id: r.id,
      agentId: r.agent_id,
      level: r.level,
      parentId: r.parent_id ?? null,
      text: r.text,
      status: r.status,
      progress: r.progress,
      motivation: r.motivation,
      frustration: r.frustration,
      criterion: r.criterion,
      measured: r.measured,
      baseline: r.baseline ?? null,
      seen: r.seen ?? [],
      resource: r.resource ?? null,
      departure: r.departure ?? null,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      lastProgressAt: r.last_progress_at,
      history: r.history ?? [],
    });
    return parsed.success ? [parsed.data] : [];
  });
  return { seeds, events, wallMs, audits, socialHistory, llmCalls, knowledge, goals };
}
