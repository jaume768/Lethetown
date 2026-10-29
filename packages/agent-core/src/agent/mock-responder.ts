/**
 * Respuestas deterministas con sentido para los prompts de agent/prompts.ts (y de memory/*).
 * Lee el prompt (lugares, objetos, presentes, lo que se oye) igual que lo haría un LLM, así el
 * modo mock ejercita el mismo camino de parseo que los proveedores reales.
 *
 * Es declarativo: cada módulo de `mock/` registra el respondedor de sus tareas, y `decide` es una
 * lista ordenada de reglas pequeñas (`registerDecideRule`). Importar este archivo los carga todos.
 */
import "./mock/plan";
import "./mock/memory";
import "./mock/narrative";
import "./mock/decide";

export {
  agentMockResponder,
  decideRules,
  registerDecideRule,
  registerMockHandler,
  type DecideReply,
  type DecideRule,
} from "./mock/registry";
export { decideContext, hash, parsePlaces, type DecideCtx } from "./mock/context";
