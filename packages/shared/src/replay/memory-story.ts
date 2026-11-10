import type { Clarity, MemoryAuditAction, MemoryAuditEntry } from "../schemas/memory";

/**
 * «Así muere un recuerdo» (tarjeta de la repetición): su texto, la curva de fuerza muestreada
 * al empaquetar con la curva del motor y, en orden, lo que le pasó según la auditoría. Nada se
 * calcula de nuevo: los números salen del motivo que escribió el motor.
 */

/** Lo que cuenta de la vida de un recuerdo (lo demás de la auditoría es ruido para esto). */
export const STORY_ACTIONS: readonly MemoryAuditAction[] = [
  "reconsolidated",
  "gist",
  "source_changed",
  "false_memory",
  "forgotten",
];

/** El final de un recuerdo que no lo selecciona (hay muchos), pero que se cuenta si lo tiene. */
export const STORY_END_ACTIONS: readonly MemoryAuditAction[] = ["deleted"];

/** Umbrales por defecto de `MemoryConfig.retrieval` (si el paquete no trae los suyos). */
export const DEFAULT_THRESHOLDS = { forget: 0.05, vague: 0.3 };

export type StoryDetail =
  /** Se volvió vago: lo que queda (la esencia). */
  | { kind: "gist"; gist: string }
  /** Cambió quién se lo contó: de → a (con nombres). */
  | { kind: "source"; from: string; to: string }
  /** Olvidado: la fuerza con que cayó bajo el umbral. */
  | { kind: "forgotten"; strength: number; threshold: number }
  /** Se reescribió al recordarlo: el texto nuevo. */
  | { kind: "rewritten"; text: string }
  /** Falso recuerdo: lo que la mente rellenó. */
  | { kind: "false"; text: string }
  /** El motivo tal cual (lo que no se sabe leer). */
  | { kind: "reason"; reason: string };

export interface StoryStep {
  action: MemoryAuditAction;
  at: number;
  detail: StoryDetail;
}

export interface MemoryStory {
  memoryId: string;
  agentId: string;
  /** El texto en el minuto pedido (y el de cuando se creó, si cambió). */
  text: string;
  firstText: string;
  createdAt: number | null;
  /** Fuerza y claridad en el minuto pedido (la fuerza, si se sabe: un borrado no la deja). */
  strength: number;
  strengthKnown: boolean;
  clarity: Clarity;
  /** La curva hasta el minuto pedido: [minuto, fuerza]. */
  curve: [number, number][];
  /** De qué minuto a cuál se conoce la curva entera (para el eje del gráfico). */
  span: [number, number];
  thresholds: { forget: number; vague: number };
  /** Lo que le ha pasado hasta el minuto pedido, en orden. */
  steps: StoryStep[];
  /** Cuándo se olvida (si pasa antes del minuto pedido). */
  forgottenAt: number | null;
}

/** Lo legible de una fila de la auditoría (con los ids de vecinos cambiados por su nombre). */
export function storyStep(a: MemoryAuditEntry, names: ReadonlyMap<string, string>): StoryStep {
  const r = a.reason;
  const person = (s: string) =>
    s.replace(/^(contado por|told by) (\S+)$/i, (_, p: string, id: string) => {
      const name = names.get(id);
      return `${p} ${name ? name.split(" ")[0] : id}`;
    });
  let detail: StoryDetail = { kind: "reason", reason: r };
  if (a.action === "forgotten") {
    const m = /([\d.]+)\s*\(umbral de olvido ([\d.]+)\)/.exec(r);
    if (m) detail = { kind: "forgotten", strength: Number(m[1]), threshold: Number(m[2]) };
  } else if (a.action === "gist") {
    const m = /esencia: "([\s\S]*)"\s*$/.exec(r);
    if (m) detail = { kind: "gist", gist: m[1]! };
  } else if (a.action === "source_changed") {
    const m = /"([^"]+)" → "([^"]+)"/.exec(r);
    if (m) detail = { kind: "source", from: person(m[1]!), to: person(m[2]!) };
  } else if (a.action === "reconsolidated") {
    const m = /pasó a: "([\s\S]*)"\s*$/.exec(r);
    if (m) detail = { kind: "rewritten", text: m[1]! };
  } else if (a.action === "false_memory") {
    const m = /rellenó los huecos: «([\s\S]*)»\s*$/.exec(r);
    if (m) detail = { kind: "false", text: m[1]! };
  }
  return { action: a.action, at: a.at, detail };
}

/**
 * El texto de un recuerdo en `t` solo con la auditoría (cuando ya no está en la base de datos:
 * se borró): el de antes del siguiente cambio o, si no lo hay, el que dejó el último.
 */
export function textFromAudit(rows: readonly MemoryAuditEntry[], t: number): string | null {
  const sorted = [...rows].sort((a, b) => a.at - b.at);
  const next = sorted.find((a) => a.at > t);
  if (next) return next.memoryText;
  const last = sorted.at(-1);
  if (!last) return null;
  const d = storyStep(last, new Map()).detail;
  return d.kind === "rewritten" || d.kind === "false" ? d.text : last.memoryText;
}
