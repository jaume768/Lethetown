/**
 * Registro del mock: un respondedor por tarea (`plan`, `decide`, `gist`…) y, para `decide`,
 * una lista ordenada de reglas pequeñas. Cada módulo registra lo suyo; una acción nueva añade su
 * regla con `registerDecideRule` sin tocar las demás.
 */
import type { MockResponder } from "../../llm/mock";
import type { CompletionRequest } from "../../llm/types";
import type { DecideCtx } from "./context";

export type TaskResponder = (req: CompletionRequest) => string;

const TASKS = new Map<string, TaskResponder>();

/** Permite a otros módulos (memoria, crónica, entrevistas, acciones) registrar su respuesta. */
export function registerMockHandler(task: string, handler: TaskResponder): void {
  TASKS.set(task, handler);
}

/** El responder del MockProvider: busca el de la tarea (o "{}" si no hay). */
export const agentMockResponder: MockResponder = (req) => TASKS.get(req.meta.task)?.(req) ?? "{}";

/** Respuesta de una regla de decisión: el JSON (sin `reason`) y el porqué. */
export interface DecideReply {
  response: Record<string, unknown>;
  reason: string;
}

/** Regla de decisión del mock: responde si le toca, o null para dejar paso a la siguiente. */
export interface DecideRule {
  name: string;
  respond(c: DecideCtx): DecideReply | null;
}

const RULES: DecideRule[] = [];

/**
 * Añade una regla de decisión (al final, o antes/después de otra por nombre). Si ya hay una con
 * ese nombre, la sustituye en su sitio.
 */
export function registerDecideRule(
  rule: DecideRule,
  where: { before?: string; after?: string } = {},
): void {
  const existing = RULES.findIndex((r) => r.name === rule.name);
  if (existing >= 0) {
    RULES[existing] = rule;
    return;
  }
  const anchor = RULES.findIndex((r) => r.name === (where.before ?? where.after));
  if (anchor < 0) RULES.push(rule);
  else RULES.splice(where.before ? anchor : anchor + 1, 0, rule);
}

/** Reglas de decisión en orden (para tests e inspección). */
export function decideRules(): readonly DecideRule[] {
  return RULES;
}
