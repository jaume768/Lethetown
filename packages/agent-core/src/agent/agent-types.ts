/** Tipos del agente (percepciones, decisiones, dependencias). */
import type { ActionType, AgentAction, Place, Weather } from "@lethetown/shared";
import type { LLMClient } from "../llm/client";
import { type SocialProfileStore } from "../memory/human";
import type { MemorySystem } from "../memory/memory-system";
import { type IntentionState } from "../memory/prospective";
import type { MinorInfo } from "./minor-safety";
import { type PromptLanguage, type DecideContext } from "./prompts";

export type Perception =
  | { kind: "arrived"; agentId: string; name: string; action: string; placeId: string }
  | {
      kind: "speech";
      fromId: string;
      fromName: string;
      text: string;
      placeId: string;
      eventId?: string;
      /** En un grupo: a quién se lo dijo (si no era a este agente). */
      toName?: string;
    }
  | {
      kind: "overheard";
      /** Quién habló, si el agente lo distingue. */
      fromId: string | null;
      fromName: string;
      toName: string;
      fragment: string;
      placeId: string;
      eventId?: string;
    }
  | { kind: "thought"; text: string }
  | { kind: "world"; text: string; placeId: string | null; eventId?: string };

/** Decisión del agente; `reason` es su razonamiento (si lo dio). */
export type Decision = (
  | { kind: "follow_plan" }
  /** Una acción del catálogo, ya con sus parámetros validados (el motor comprueba el resto). */
  | { kind: "act"; action: AgentAction }
  /** Pidió algo que no encaja con el catálogo: el motor se lo hace saber como percepción. */
  | { kind: "invalid"; error: string }
) & { reason?: string };

export interface AgentDeps {
  llm: LLMClient;
  memory: MemorySystem;
  places: Place[];
  /** Idioma en el que habla y escribe (por mundo). Por defecto, español. */
  language?: PromptLanguage;
  /** Fichas sociales (lo que piensa de los demás). */
  social?: SocialProfileStore;
  /** Nombres de los demás agentes, para las notas sociales. */
  names?: Record<string, string>;
  /** Menores del pueblo, para la regla fija del prompt de identidad. */
  minors?: MinorInfo[];
  /** Chismosos del pueblo: lo que cuentan se cree un poco menos. */
  gossips?: ReadonlySet<string>;
  onError?: (agentId: string, task: string, error: unknown) => void;
}

export type DecideInput = Omit<
  DecideContext,
  | "now"
  | "locationId"
  | "action"
  | "moodLabel"
  | "needs"
  | "planItem"
  | "workingMemory"
  | "weather"
  | "innerVoice"
  | "doneToday"
  | "actions"
  | "agenda"
  | "discovered"
> & {
  salient: boolean;
  /** El tiempo que hace; el agente describe cómo le afecta según dónde está. */
  weather: Weather;
  /** Voz interior recién recibida (texto del jugador, sin delimitar). */
  innerVoice?: string[];
  /**
   * Acciones del catálogo posibles ahora (las calcula el motor según el contexto). Sin ellas:
   * `do_activity`, y `say` si hay alguien.
   */
  actions?: ActionType[];
  /** Agenda (citas propuestas y aceptadas), ya escrita por el motor. */
  agenda?: string[];
};

/** Qué ha pasado con una intención en este tick. */
export interface IntentionOutcome {
  kind: "kept" | "missed" | "late" | "expired";
  intention: IntentionState;
  /** Si se acordó: lo que le viene a la cabeza (se le pasa como percepción). */
  reminder?: string;
}

/** Lo que deja el cierre del día (al dormirse): diario y hábitos. */
export interface DayEndReport {
  diaryMemoryId: string | null;
  habitsFormed: string[];
  habitsReinforced: string[];
}
