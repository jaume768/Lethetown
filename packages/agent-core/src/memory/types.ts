import type {
  MemoryAuditEntry,
  MemoryMeta,
  MemorySource,
  MemoryType,
  MemoryVersion,
  MemoryView,
} from "@lethetown/shared";

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
  meta?: MemoryMeta;
  /** Fuerza inicial (0..1) según la atención al grabarlo (ver encoding.ts). Por defecto, 1. */
  strength?: number;
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
    | "meta"
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
  delete(id: string): Promise<void>;
  /** Historial de versiones (reconsolidación, cambios de fuente). */
  addVersion(version: MemoryVersion): Promise<void>;
  versions(memoryId: string): Promise<MemoryVersion[]>;
  /** Registro de decisiones de olvido/transformación con su motivo. */
  addAudit(entry: MemoryAuditEntry): Promise<void>;
  audit(agentId: string, limit?: number): Promise<MemoryAuditEntry[]>;
  /** Recuerdos de un evento (todas los agentes), para la vista Rashomon. */
  byEvent(eventId: string): Promise<MemoryRecord[]>;
  /** Varias actualizaciones en una sola operación (p. ej. los refuerzos de una recuperación). */
  updateMany(updates: { id: string; patch: MemoryPatch }[]): Promise<void>;
  /**
   * Ejecuta `fn` de forma atómica: o se aplican todas sus escrituras o ninguna. Dentro de `fn`
   * hay que usar el store que recibe (en Postgres va ligado a la transacción).
   */
  transaction<T>(fn: (tx: MemoryStore) => Promise<T>): Promise<T>;
  /**
   * Para el inspector: todos los recuerdos del agente con su similitud al `queryEmbedding`
   * calculada por el almacén, sin traer los embeddings (`embedding` viene vacío).
   * Opcional: si no existe, se usa `listByAgent`.
   */
  listForInspection?(
    agentId: string,
    queryEmbedding: number[],
  ): Promise<{ memory: MemoryRecord; relevance: number }[]>;
}

export interface Embedder {
  readonly dim: number;
  readonly name: string;
  embed(texts: string[]): Promise<number[][]>;
}
