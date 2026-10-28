import type { MemorySource, MemoryType, MemoryView } from "@lethetown/shared";

/**
 * Recuerdo completo. `strength` y `lastAccessedAt` son los valores en el último refuerzo;
 * la fuerza actual se calcula de forma perezosa con `currentStrength()` (ver decay.ts).
 */
export interface MemoryRecord extends MemoryView {
  embedding: number[];
  /**
   * Estabilidad en horas de juego: cuánto tarda la fuerza en caer a 1/e.
   * Crece con cada recuperación (repetición espaciada).
   */
  stability: number;
  /** Veces que se ha recuperado. */
  accessCount: number;
}

export interface NewMemory {
  agentId: string;
  text: string;
  type: MemoryType;
  source?: MemorySource;
  importance: number;
  emotionalValence?: number;
  people?: string[];
  placeId?: string | null;
  eventId?: string | null;
  links?: string[];
}

export type MemoryPatch = Partial<
  Pick<
    MemoryRecord,
    | "strength"
    | "stability"
    | "lastAccessedAt"
    | "accessCount"
    | "gist"
    | "text"
    | "emotionalValence"
    | "source"
    | "status"
    | "forgottenAt"
  >
>;

/** Almacén de recuerdos inyectable (en memoria para tests, Postgres+pgvector en el servidor). */
export interface MemoryStore {
  add(memory: MemoryRecord): Promise<void>;
  update(id: string, patch: MemoryPatch): Promise<void>;
  get(id: string): Promise<MemoryRecord | undefined>;
  listByAgent(agentId: string): Promise<MemoryRecord[]>;
  /**
   * Candidatos para la recuperación. Un almacén con índice vectorial puede prefiltrar
   * por similitud; el de memoria devuelve todos. La puntuación final se hace en agent-core.
   */
  candidates(agentId: string, queryEmbedding: number[], limit: number): Promise<MemoryRecord[]>;
}

export interface Embedder {
  readonly dim: number;
  readonly name: string;
  embed(texts: string[]): Promise<number[][]>;
}
