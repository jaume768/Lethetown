/**
 * Cognición en movimiento (fase 3.6): interruptores por mundo y parámetros del motor. Todo
 * encendido por defecto; con `enabled: false` (o cada parte en `false`) el mundo se comporta
 * como antes de la 3.6, que es lo que hace falta para un mundo de control (ablación) en una
 * partida de estudio. Ver docs/decisiones/cognicion.md.
 */
import { z } from "zod";

/** Las partes que se pueden apagar por separado. */
export const COGNITION_PARTS = [
  "encounters",
  "associations",
  "stopToChat",
  "walkingTalk",
  "talkWhileActivity",
] as const;
export type CognitionPart = (typeof COGNITION_PARTS)[number];

/** Parámetros (minutos de juego, baldosas y factores), con su valor por defecto. */
export const CognitionParams = z.object({
  /** «Cerca»: radio en baldosas en que dos vecinos se ven por el camino. */
  nearRadius: z.number().positive().default(4),
  /**
   * «A voces»: hasta dónde se puede saludar o llamar a alguien para pararse a charlar, y radio
   * de la presencia en una charla en el camino (quien se aleja más, sale de ella).
   */
  callRadius: z.number().positive().default(8),
  /**
   * Minutos de antelación con que se ve venir a alguien por su ruta: así la respuesta del LLM
   * (1–2 min de juego a x10) llega cuando se cruzan. Lo decidido antes de tiempo se hace al
   * cruzarse.
   */
  decisionLeadMinutes: z.number().nonnegative().default(1.5),
  /** Minutos de juego entre dos revisiones de quién tiene cerca a quién (sin LLM). */
  scanEveryMinutes: z.number().int().positive().default(2),
  /** Minutos de juego antes de que la misma pareja vuelva a generar un encuentro. */
  pairCooldownMinutes: z.number().positive().default(60),
  /** Decisiones (llamadas a `decide`) en camino por agente y hora de juego, como mucho. */
  maxWalkDecisionsPerHour: z.number().int().nonnegative().default(2),
  /** Escuchar a escondidas una charla en el camino: solo a esta distancia (baldosas). */
  eavesdropRadius: z.number().nonnegative().default(2),
  /** Lo que cuenta la práctica de una habilidad mientras se habla (0–1). */
  practiceWhileTalking: z.number().min(0).max(1).default(0.5),
  /** Lo que se alarga lo que dura usar un objeto si se está hablando (× minutos). */
  attentionSlowdown: z.number().min(1).default(1.5),
  /** Asociaciones («te viene a la cabeza…») por agente y hora de juego, como mucho. */
  maxAssociationsPerHour: z.number().int().nonnegative().default(2),
  /** Recuerdos que trae cada asociación (1 o 2). */
  associationRecall: z.number().int().min(1).max(2).default(1),
  /** Importancia mínima (1–10) de lo que trae una asociación (lo trivial no viene a la cabeza). */
  associationMinImportance: z.number().int().min(1).max(10).default(3),
  /** Lo de hace menos de estos minutos no se «asocia» (ya lo tiene presente). */
  associationMinAgeMinutes: z.number().nonnegative().default(60),
  /** Minutos que tiene quien recibe un saludo al pasar para devolverlo. */
  greetReplyMinutes: z.number().positive().default(3),
});
export type CognitionParams = z.infer<typeof CognitionParams>;

/** Lo que guarda un mundo (`worlds.cognition`): solo lo que cambia respecto a lo de por defecto. */
export const CognitionSettings = z.object({
  /** Interruptor general: apagado, ninguna parte funciona. */
  enabled: z.boolean().optional(),
  encounters: z.boolean().optional(),
  associations: z.boolean().optional(),
  stopToChat: z.boolean().optional(),
  walkingTalk: z.boolean().optional(),
  talkWhileActivity: z.boolean().optional(),
  params: CognitionParams.partial().optional(),
});
export type CognitionSettings = z.infer<typeof CognitionSettings>;

/** La configuración efectiva de un mundo (cada parte ya combinada con el interruptor general). */
export type CognitionConfig = Record<CognitionPart, boolean> & {
  enabled: boolean;
  params: CognitionParams;
};

/**
 * Combina capas (de menos a más prioridad: el entorno, el mundo). Con el interruptor general
 * apagado, todas las partes quedan apagadas aunque alguna capa diga lo contrario.
 */
export function resolveCognition(...layers: (CognitionSettings | undefined)[]): CognitionConfig {
  const merged: CognitionSettings = {};
  for (const l of layers) {
    if (!l) continue;
    Object.assign(merged, { ...l, params: { ...merged.params, ...l.params } });
  }
  const enabled = merged.enabled !== false;
  const parts = Object.fromEntries(
    COGNITION_PARTS.map((p) => [p, enabled && merged[p] !== false]),
  ) as Record<CognitionPart, boolean>;
  return { enabled, ...parts, params: CognitionParams.parse(merged.params ?? {}) };
}

/** Todo apagado: el comportamiento de antes de la 3.6. */
export const COGNITION_OFF: CognitionConfig = resolveCognition({ enabled: false });

/**
 * `SIM_COGNITION`: «on» (por defecto), «off» (todo apagado) o una lista de partes con su valor
 * («encounters=off,walkingTalk=off»). Lo que no se entiende es un error (mejor fallar al
 * arrancar que estudiar un mundo de control que no lo era).
 */
export function parseCognitionEnv(value: string | undefined): CognitionSettings {
  const v = (value ?? "").trim();
  if (!v || v === "on") return {};
  if (v === "off") return { enabled: false };
  const out: CognitionSettings = {};
  for (const entry of v
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean)) {
    const [key, raw] = entry.split("=").map((x) => x.trim());
    const on = raw === "on" ? true : raw === "off" ? false : null;
    if (on === null || !(COGNITION_PARTS as readonly string[]).includes(key ?? "")) {
      throw new Error(`SIM_COGNITION: no entiendo «${entry}» (parte=on|off)`);
    }
    out[key as CognitionPart] = on;
  }
  return out;
}

/** Lo apagado, en una línea para el log («todo apagado», «apagado: walkingTalk»), o "" si nada. */
export function cognitionOffParts(c: CognitionConfig): string {
  if (!c.enabled) return "todo apagado (mundo de control)";
  const off = COGNITION_PARTS.filter((p) => !c[p]);
  return off.length ? `apagado: ${off.join(", ")}` : "";
}
