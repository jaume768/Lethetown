import type { Clarity, MemoryScores } from "@lethetown/shared";
import { currentStrength } from "./decay";
import type { MemoryRecord } from "./types";

export interface RetrievalWeights {
  recency: number;
  importance: number;
  relevance: number;
  moodMatch: number;
}

export interface RetrievalConfig {
  weights: RetrievalWeights;
  /** Factor de recencia por hora de juego (Park et al. usan 0.995). */
  recencyDecayPerHour: number;
  /** Por debajo de esta fuerza el recuerdo está olvidado: no se recupera. */
  forgetThreshold: number;
  /** Por debajo de esta fuerza solo se recuerda la esencia. */
  vagueThreshold: number;
}

export const DEFAULT_RETRIEVAL: RetrievalConfig = {
  weights: { recency: 1, importance: 1, relevance: 1, moodMatch: 0.5 },
  recencyDecayPerHour: 0.995,
  forgetThreshold: 0.05,
  vagueThreshold: 0.3,
};

export interface RetrievalQuery {
  embedding: number[];
  now: number;
  /** Ánimo actual del agente (-1..1): favorece recuerdos de la misma valencia. */
  moodValence: number;
}

export interface ScoredMemory {
  memory: MemoryRecord;
  scores: MemoryScores;
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

export function clarityFor(strength: number, config: RetrievalConfig = DEFAULT_RETRIEVAL): Clarity {
  if (strength < config.forgetThreshold) return "forgotten";
  if (strength < config.vagueThreshold) return "vague";
  return "clear";
}

/**
 * Puntuación = media ponderada de recencia, importancia, relevancia y coincidencia de ánimo
 * (todas en 0..1), multiplicada por la fuerza actual del recuerdo.
 */
export function scoreMemory(
  memory: MemoryRecord,
  query: RetrievalQuery,
  config: RetrievalConfig = DEFAULT_RETRIEVAL,
  /** Similitud ya calculada (p. ej. por pgvector); si no, el coseno de los embeddings. */
  precomputedRelevance?: number,
): ScoredMemory {
  const hours = Math.max(0, query.now - memory.lastAccessedAt) / 60;
  const recency = Math.pow(config.recencyDecayPerHour, hours);
  const importance = memory.importance / 10;
  const relevance = Math.max(0, precomputedRelevance ?? cosine(memory.embedding, query.embedding));
  const moodMatch = 1 - Math.abs(memory.emotionalValence - query.moodValence) / 2;
  const strength = currentStrength(memory, query.now);
  const w = config.weights;
  const weighted =
    (w.recency * recency +
      w.importance * importance +
      w.relevance * relevance +
      w.moodMatch * moodMatch) /
    (w.recency + w.importance + w.relevance + w.moodMatch);
  return {
    memory,
    scores: {
      recency,
      importance,
      relevance,
      moodMatch,
      strength,
      total: weighted * strength,
      clarity: clarityFor(strength, config),
    },
  };
}

/** Puntúa y ordena todos los candidatos (incluye los olvidados: útil para el inspector). */
export function rankMemories(
  memories: MemoryRecord[],
  query: RetrievalQuery,
  config: RetrievalConfig = DEFAULT_RETRIEVAL,
): ScoredMemory[] {
  return memories
    .map((m) => scoreMemory(m, query, config))
    .sort((a, b) => b.scores.total - a.scores.total);
}

/** Lo que el agente "ve" de un recuerdo: el texto completo, o solo la esencia si es vago. */
export function recallText(scored: ScoredMemory): string {
  const { memory, scores } = scored;
  if (scores.clarity !== "vague") return memory.text;
  return memory.gist ?? vagueGist(memory.text);
}

/**
 * Esencia provisional mientras el GistCompressor (human.ts) no haya generado `gist`:
 * conserva las primeras palabras y marca la vaguedad.
 */
export function vagueGist(text: string, words = 6): string {
  const parts = text.split(/\s+/);
  const head = parts.slice(0, words).join(" ");
  return parts.length > words ? `(vagamente) ${head}…` : `(vagamente) ${head}`;
}
