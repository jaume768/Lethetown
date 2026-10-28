/**
 * Interfaces de la fase 2 ("memoria humana completa"). Están definidas para fijar el contrato,
 * pero las implementaciones por defecto no hacen nada. Ver roadmap en el README.
 */
import type { MemorySource } from "@lethetown/shared";
import type { MemoryRecord } from "./types";

/**
 * Consolidación nocturna / reflexión: mientras el agente duerme, agrupa los recuerdos del día,
 * genera reflexiones (type "reflection") y recuerdos semánticos, y deja caer los triviales.
 */
export interface Consolidator {
  consolidate(agentId: string, from: number, to: number): Promise<MemoryRecord[]>;
}

/** Compresión detalle → esencia: rellena `gist` cuando un recuerdo se debilita. */
export interface GistCompressor {
  compress(memory: MemoryRecord): Promise<string>;
}

/**
 * Reconsolidación: al recordar, el recuerdo se reescribe influido por el ánimo
 * y el contexto actuales (los recuerdos cambian cada vez que se evocan).
 */
export interface Reconsolidator {
  reconsolidate(
    memory: MemoryRecord,
    context: { now: number; moodValence: number; cue: string },
  ): Promise<Pick<MemoryRecord, "text" | "emotionalValence">>;
}

/** Confusión de fuente: con el tiempo, "me lo contó X" puede pasar a "lo viví". */
export interface SourceConfuser {
  confuse(memory: MemoryRecord, now: number): MemorySource;
}

/** Ficha social de lo que un agente cree saber de otro. */
export interface SocialProfile {
  ownerId: string;
  aboutId: string;
  summary: string;
  /** -1 (aversión) .. 1 (afecto) */
  affinity: number;
  /** 0..1 */
  trust: number;
  lastUpdated: number;
}

export interface SocialProfileStore {
  get(ownerId: string, aboutId: string): Promise<SocialProfile | undefined>;
  upsert(profile: SocialProfile): Promise<void>;
}

// --- Implementaciones nulas ----------------------------------------------------------

export class NoopConsolidator implements Consolidator {
  // TODO(fase 2): reflexión al estilo Park et al. con el modelo "reflection".
  async consolidate(): Promise<MemoryRecord[]> {
    return [];
  }
}

export class NoopGistCompressor implements GistCompressor {
  // TODO(fase 2): resumir con el modelo "fast" y guardar en `gist`.
  async compress(memory: MemoryRecord): Promise<string> {
    return memory.gist ?? memory.text;
  }
}

export class NoopReconsolidator implements Reconsolidator {
  // TODO(fase 2): reescritura sutil sesgada por el ánimo, con probabilidad baja.
  async reconsolidate(memory: MemoryRecord) {
    return { text: memory.text, emotionalValence: memory.emotionalValence };
  }
}

export class NoopSourceConfuser implements SourceConfuser {
  // TODO(fase 2): probabilidad creciente con la edad del recuerdo y su debilidad.
  confuse(memory: MemoryRecord): MemorySource {
    return memory.source;
  }
}

export class InMemorySocialProfileStore implements SocialProfileStore {
  // TODO(fase 2): actualizar fichas tras cada conversación; persistir en Postgres.
  private readonly profiles = new Map<string, SocialProfile>();

  async get(ownerId: string, aboutId: string) {
    return this.profiles.get(`${ownerId}:${aboutId}`);
  }

  async upsert(profile: SocialProfile) {
    this.profiles.set(`${profile.ownerId}:${profile.aboutId}`, profile);
  }
}
