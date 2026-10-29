/**
 * Motor de acciones: la IA elige una acción del catálogo (packages/shared/src/actions) y aquí se
 * decide si se ofrece, si es posible y qué pasa. Cada acción registra su manejador en su módulo;
 * si no es posible, el agente se entera del motivo como percepción y queda en la línea de tiempo.
 */
import type { Agent } from "@lethetown/agent-core";
import { ACTION_SPECS, type ActionType, type AgentAction } from "@lethetown/shared";
import type { SimContext } from "../context";

export interface ActionContext {
  ctx: SimContext;
  agent: Agent;
  now: number;
}

export interface ActionHandler<T extends AgentAction = AgentAction> {
  type: T["type"];
  /** ¿Se le ofrece ahora? (solo las disponibles van al prompt). */
  available(c: ActionContext): boolean;
  /** Precondiciones: el motivo, legible, si no se puede; null si sí. */
  check(c: ActionContext, action: T): string | null | Promise<string | null>;
  /** Ejecución y efectos (eventos, recuerdos, cambios de estado). */
  execute(c: ActionContext, action: T): void | Promise<void>;
  /** Qué intentaba, en infinitivo ("ir a Café La Ola"), para "No pude …". */
  describe(c: ActionContext, action: T): string;
}

const HANDLERS = new Map<ActionType, ActionHandler>();

export function registerAction<T extends AgentAction>(handler: ActionHandler<T>): void {
  HANDLERS.set(handler.type, handler as unknown as ActionHandler);
}

export function actionHandler(type: ActionType): ActionHandler | undefined {
  return HANDLERS.get(type);
}

export function registeredActions(): ActionType[] {
  return [...HANDLERS.keys()];
}

/** Acciones que se le ofrecen ahora, en el orden del registro. */
export function availableActions(c: ActionContext): ActionType[] {
  // En el orden del catálogo (no en el de registro, que depende de los imports).
  return (Object.keys(ACTION_SPECS) as ActionType[]).filter((t) => HANDLERS.get(t)?.available(c));
}

/**
 * Comprueba y ejecuta una acción. Si no es posible, el agente lo percibe ("No pude …: motivo"),
 * lo recordará y queda un evento con el resultado.
 */
export async function runAction(c: ActionContext, action: AgentAction): Promise<boolean> {
  const handler = HANDLERS.get(action.type);
  const reason = handler ? await handler.check(c, action) : `no sé hacer "${action.type}"`;
  if (reason !== null || !handler) {
    failAction(c, handler ? handler.describe(c, action) : action.type, reason ?? "", action.type);
    return false;
  }
  await handler.execute(c, action);
  return true;
}

/** Lo que no salió: percepción para el agente y evento con el resultado. */
export function failAction(c: ActionContext, what: string, reason: string, type: string): void {
  const { ctx, agent } = c;
  ctx.rt(agent.id).pending.push({
    kind: "world",
    text: `No pude ${what}: ${reason}.`,
    placeId: null,
  });
  ctx.emit(
    "action",
    agent.id,
    `✗ ${agent.seed.name} no pudo ${what}: ${reason}`,
    [agent.id],
    undefined,
    {
      action: type,
      ok: false,
    },
  );
}
