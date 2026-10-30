/**
 * Un sistema de la simulación (citas, inventario, notas, normas…): todo lo suyo en un sitio, sin
 * tocar `simulation.ts`. Cada parte es opcional salvo `id`. Ver docs/decisiones/sistemas.md.
 */
import type { Agent } from "@lethetown/agent-core";
import type { ActionType, AgentAction, PlanItem } from "@lethetown/shared";
import type { z } from "zod";
import type { SimContext } from "../context";
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

/** Qué política de `config/retention.json` cubre su tabla (o por qué no hace falta). */
export type SystemRetention =
  { table: string; policy: keyof RetentionConfig } | { table: string; keep: string };

export interface SimSystem<S = unknown> {
  id: string;
  /** Para qué sirve, en una frase (admin y documentación). */
  description?: string;
  /** Acciones del catálogo que son suyas (registradas con `registerAction` en `sim/actions/`). */
  actions?: readonly ActionType[];
  snapshot?: SystemSnapshot<S>;
  /** Al abrir el mundo, tras restaurar la instantánea (o sin ella): cargar de su almacén. */
  load?(ctx: SimContext, opts: { restored: boolean; now: number }): void | Promise<void>;
  tick?: SystemTick;
  /** Lo variable del prompt de decidir (sus secciones). */
  promptSections?(ctx: SimContext, agent: Agent, now: number): PromptSection[];
  /** Algo fijo y cacheable para el prompt de identidad (reglas del mundo que aporta). */
  identityLines?(world: WorldMap): string[];
  /** Compromisos de un día que el plan debe respetar (huecos fijos). */
  fixedPlan?(ctx: SimContext, agent: Agent, day: number): PlanItem[];
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
