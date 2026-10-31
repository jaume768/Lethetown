/**
 * Un sistema de la simulación (citas, inventario, notas, normas…): todo lo suyo en un sitio, sin
 * tocar `simulation.ts`. Cada parte es opcional salvo `id`. Ver docs/decisiones/sistemas.md.
 */
import type { Agent } from "@lethetown/agent-core";
import type { ActionType, AgentAction, Agreement, PlanItem } from "@lethetown/shared";
import type { z } from "zod";
import type { SimContext, SimulationDeps } from "../context";
import type { WorldMap } from "../world";
import type { RetentionConfig } from "../../retention";

/** Intervalo habitual de las revisiones periódicas (minutos de juego). */
export const REVIEW_MINUTES = 5;

/** Sección del prompt de decidir ("LLEVAS:\n- …"). Vacía no aparece. */
export interface PromptSection {
  title: string;
  lines: string[];
  /**
   * Orden en el prompt (de menor a mayor; por defecto 50). Por debajo de
   * `DISCOVERED_SECTION_ORDER` va antes de LUGARES QUE HAS DESCUBIERTO.
   */
  order?: number;
}

/** Su parte de la instantánea: versión propia (no hace falta subir `SIM_SNAPSHOT_VERSION`). */
export interface SystemSnapshot<T> {
  /** Si la guardada es de otra versión (o no valida), el sistema arranca limpio. */
  version: number;
  schema: z.ZodType<T>;
  save(ctx: SimContext): T;
  restore(ctx: SimContext, data: T): void;
}

/** Revisión periódica sin LLM. Las del mismo intervalo corren juntas, en orden de registro. */
export interface SystemTick {
  /** Minutos de juego entre revisiones (alineadas: múltiplos del intervalo). */
  every: number;
  run(ctx: SimContext, now: number): void | Promise<void>;
}

/** Un acuerdo de una conversación con los participantes ya resueltos (ids de la charla). */
export interface ResolvedAgreement extends Agreement {
  from: string;
  to: string[];
  /** `from` y `to` juntos. */
  people: string[];
  conversationId: string;
}

/** Un paso de un acuerdo: quién hace qué acción del catálogo (se construye al llegar a él). */
export interface AgreementStep {
  actorId: string;
  action: () => AgentAction | string;
}

/**
 * Cómo lleva a cabo un sistema un tipo de acuerdo (sim/agreements.ts): con las mismas acciones
 * formales que elegiría el LLM, que pasan por sus manejadores (validación, normas, menores).
 */
export interface AgreementKind {
  type: string;
  /** Los pasos, en orden, o el motivo para descartarlo. */
  steps(ctx: SimContext, a: ResolvedAgreement): AgreementStep[] | string;
  /** Si ya hay algo igual (la misma gente, sitio y franja), el motivo para no repetirlo. */
  duplicate?(ctx: SimContext, a: ResolvedAgreement): string | null;
  /** Tras llevarlo a cabo (p. ej. marcar la cita como acordada hablando). */
  applied?(ctx: SimContext, a: ResolvedAgreement): void;
  /** ¿Se refiere esta intención (de la misma charla) a este acuerdo? Entonces no se duplica. */
  covers?(intention: { text: string; personId?: string | null }, a: ResolvedAgreement): boolean;
}

/** Parte de un sistema en la consolidación nocturna (ver `SimSystem.consolidation`). */
export interface ConsolidationPart {
  /** Campo de la respuesta JSON ("goals"). */
  key: string;
  /** Texto que se añade al prompt (instrucciones y formato de su campo). */
  prompt: string;
  /** Lo que devolvió el modelo en ese campo, sin validar (undefined si no vino). */
  apply(value: unknown, now: number): void | Promise<void>;
}

/** Qué política de `config/retention.json` cubre su tabla (o por qué no hace falta). */
export type SystemRetention =
  { table: string; policy: keyof RetentionConfig } | { table: string; keep: string };

export interface SimSystem<S = unknown> {
  id: string;
  /** Para qué sirve, en una frase (admin y documentación). */
  description?: string;
  /** Acciones del catálogo que son suyas (registradas con `registerAction` en `sim/actions/`). */
  actions?: readonly ActionType[];
  /** Tareas del LLM que son suyas (para el coste por sistema en «Evolución»). */
  llmTasks?: readonly string[];
  /** Tipos de acuerdo hablado que sabe llevar a cabo (puente de la conversación a la acción). */
  agreements?: readonly AgreementKind[];
  snapshot?: SystemSnapshot<S>;
  /** Al abrir el mundo, tras restaurar la instantánea (o sin ella): cargar de su almacén. */
  load?(ctx: SimContext, opts: { restored: boolean; now: number }): void | Promise<void>;
  tick?: SystemTick;
  /** Lo variable del prompt de decidir (sus secciones). */
  promptSections?(ctx: SimContext, agent: Agent, now: number): PromptSection[];
  /** Algo fijo y cacheable para el prompt de identidad (reglas del mundo que aporta). */
  identityLines?(world: WorldMap, deps: SimulationDeps): string[];
  /** Compromisos de un día que el plan debe respetar (huecos fijos). */
  fixedPlan?(ctx: SimContext, agent: Agent, day: number): PlanItem[];
  /** Lo variable del prompt del plan del día (la fecha, sus metas…). */
  planSections?(ctx: SimContext, agent: Agent, now: number): PromptSection[];
  /**
   * Su parte de la consolidación nocturna (la misma llamada): una sección del prompt y un campo
   * de la respuesta, que recibe tal cual para validarlo y aplicarlo (el motor decide).
   */
  consolidation?(ctx: SimContext, agent: Agent, now: number): ConsolidationPart | null;
  /**
   * El agente no está en el pueblo (se fue a vivir fuera…): ni vive ni piensa ni se le ve. La
   * simulación no ejecuta su tick mientras algún sistema lo retenga.
   */
  holds?(ctx: SimContext, agentId: string): boolean;
  /** Al pararse a pensar con algo saliente, antes de decidir. */
  beforeDecide?(ctx: SimContext, agent: Agent, now: number): void | Promise<void>;
  /** Antes de ejecutar una acción elegida por el agente (p. ej. dejar de acompañar). */
  beforeAction?(ctx: SimContext, agent: Agent, action: AgentAction): void;
  /** Política de retención de su tabla. */
  retention?: SystemRetention;
  /** Cifras para la pestaña de admin «Evolución» (nombre → valor). */
  metrics?(ctx: SimContext): Record<string, number>;
  /** Datos de su pestaña o endpoint de admin (`/api/admin/worlds/:id/systems/:system`). */
  admin?(ctx: SimContext): unknown;
  /**
   * Registra lo que necesite del mock (`registerDecideRule`, `registerMockHandler`); se llama
   * una vez al registrar el sistema. Los sistemas migrados tienen sus reglas en
   * `agent-core/src/agent/mock/`.
   */
  mock?(): void;
}
