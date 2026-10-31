/**
 * Puente de la conversación a la acción. La tarea `social` de fin de charla devuelve, en la misma
 * llamada, los acuerdos explícitos («quedamos mañana a las cinco en el café», «te dejo el libro»).
 * Cada acuerdo pasa por el MISMO manejador que la acción formal (validación, normas,
 * `minorMeetingRule`, `mayEnter`): si es válido, se crea el compromiso o se ejecuta, marcado como
 * acordado hablando (`meta.agreed`); si no, se descarta con el motivo en la auditoría (sin
 * percepción "No pude…": nadie lo intentó a propósito). Los tipos los aportan los sistemas.
 */
import { AgentAction, type Agreement } from "@lethetown/shared";
import { actionHandler } from "./actions";
import type { SimContext } from "./context";
import { actionEnabled, agreementKind } from "./systems/registry";
import type { ResolvedAgreement } from "./systems/types";

/** Acuerdos ya llevados a cabo que se recuerdan por mundo (para no repetirlos). */
const KEEP_DONE = 200;

/** Estado del puente: lo hecho por conversación (los dos lados de una charla lo cuentan). */
export interface AgreementsState {
  done: Map<string, ResolvedAgreement>;
  /** Contadores para «Evolución» (desde que arrancó el proceso). */
  applied: Record<string, number>;
  discarded: Record<string, number>;
  linkedIntentions: number;
}

export const agreementsState = (ctx: SimContext) =>
  ctx.state<AgreementsState>("agreements", () => ({
    done: new Map(),
    applied: {},
    discarded: {},
    linkedIntentions: 0,
  }));

const firstName = (ctx: SimContext, id: string) =>
  ctx.agents.get(id)?.seed.name.split(" ")[0] ?? id;

/** Nombres de pila ("Lucía y Mateo"). */
function names(ctx: SimContext, ids: string[]): string {
  const list = ids.map((id) => firstName(ctx, id));
  return list.length > 1 ? `${list.slice(0, -1).join(", ")} y ${list.at(-1)}` : (list[0] ?? "");
}

/** Clave de un acuerdo: tipo, gente y lo que se acuerda (sin hora: la franja la mira el sistema). */
function keyOf(a: ResolvedAgreement): string {
  const people = [...a.people].sort().join(",");
  return `${a.conversationId}:${a.type}:${people}:${a.itemId ?? a.placeId ?? ""}`;
}

/** Ids de la charla: `from` y `to` solo valen si estaban; si falta `from`, es quien lo cuenta. */
function resolve(
  a: Agreement,
  reporterId: string,
  conversation: { id: string; people: string[] },
): ResolvedAgreement | string {
  const people = new Set(conversation.people);
  const from = a.from && people.has(a.from) ? a.from : reporterId;
  let to = [...new Set(a.to)].filter((id) => people.has(id) && id !== from);
  // De dos, está claro con quién; en un grupo tiene que decirlo.
  if (!to.length && people.size === 2) to = [...people].filter((id) => id !== from);
  if (!to.length) return "no está claro con quién se acordó";
  return { ...a, from, to, people: [from, ...to], conversationId: conversation.id };
}

/** Descarta un acuerdo: queda en la auditoría de quien lo contó, con el motivo. */
async function discard(
  ctx: SimContext,
  reporterId: string,
  a: Agreement,
  conversationId: string,
  reason: string,
): Promise<void> {
  const state = agreementsState(ctx);
  state.discarded[a.type] = (state.discarded[a.type] ?? 0) + 1;
  await ctx.deps.memory.audit({
    agentId: reporterId,
    memoryId: `agreement:${conversationId}`,
    memoryText: `${a.type}: ${a.quote || a.what || "(sin frase)"}`,
    action: "agreement_discarded",
    reason,
    at: ctx.clock.now(),
  });
}

/**
 * Lleva a cabo los acuerdos que cuenta un participante. Devuelve los que están en pie (los
 * hechos ahora y los que ya había hecho el otro lado de la charla), para enlazar con ellos las
 * intenciones de la misma respuesta.
 */
export async function applyAgreements(
  ctx: SimContext,
  conversation: { id: string; people: string[] },
  reporterId: string,
  list: Agreement[],
): Promise<ResolvedAgreement[]> {
  const state = agreementsState(ctx);
  const standing: ResolvedAgreement[] = [];
  for (const raw of list) {
    const found = agreementKind(raw.type);
    if (!found) {
      await discard(ctx, reporterId, raw, conversation.id, `no hay acuerdos de tipo "${raw.type}"`);
      continue;
    }
    if (!ctx.enabled(found.system)) {
      await discard(ctx, reporterId, raw, conversation.id, "eso no se puede hacer en este pueblo");
      continue;
    }
    const a = resolve(raw, reporterId, conversation);
    if (typeof a === "string") {
      await discard(ctx, reporterId, raw, conversation.id, a);
      continue;
    }
    // El otro lado de la charla ya lo contó (y se hizo): está en pie, no se repite.
    const already = state.done.get(keyOf(a));
    if (already) {
      standing.push(already);
      continue;
    }
    const reason = await carryOut(ctx, a, found.kind);
    if (reason) {
      await discard(ctx, reporterId, raw, conversation.id, reason);
      continue;
    }
    state.done.set(keyOf(a), a);
    if (state.done.size > KEEP_DONE) state.done.delete(state.done.keys().next().value!);
    state.applied[a.type] = (state.applied[a.type] ?? 0) + 1;
    standing.push(a);
  }
  return standing;
}

/** Comprueba y ejecuta los pasos del acuerdo. Devuelve el motivo si no se pudo (o null). */
async function carryOut(
  ctx: SimContext,
  a: ResolvedAgreement,
  kind: NonNullable<ReturnType<typeof agreementKind>>["kind"],
): Promise<string | null> {
  // Lo que dice el acuerdo entra en el mundo (motivo de la cita…): protección de menores.
  const guard = ctx.deps.memory.guard;
  const text = `${a.what} ${a.quote}`.trim();
  if (text && guard && !(await guard.allows(text, { kind: "action", actors: a.people }))) {
    return "la protección de menores no lo permite";
  }
  const dup = kind.duplicate?.(ctx, a);
  if (dup) return dup;
  const steps = kind.steps(ctx, a);
  if (typeof steps === "string") return steps;
  const now = ctx.clock.now();
  let first: string | null = null;
  for (const [i, step] of steps.entries()) {
    const agent = ctx.agents.get(step.actorId);
    const action = step.action();
    if (!agent) return `no conozco a "${step.actorId}"`;
    if (typeof action === "string") return i ? `${action} (se quedó a medias)` : action;
    const handler = actionHandler(action.type);
    if (!handler || !actionEnabled(ctx, action.type)) return "eso no se puede hacer en este pueblo";
    const c = { ctx, agent, now, agreedWith: a.people };
    const reason = await handler.check(c, action);
    if (reason) return i ? `${reason} (se quedó a medias)` : reason;
    await handler.execute(c, action);
    first ??= action.type;
  }
  kind.applied?.(ctx, a);
  const quote = a.quote ? `: «${a.quote}»` : "";
  ctx.emit(
    "action",
    a.from,
    `🗣 ${names(ctx, a.people)} lo dejan acordado hablando${quote}`,
    a.people,
    undefined,
    { action: first ?? a.type, ok: true, agreed: true },
  );
  return null;
}

/** La acción del catálogo de un paso, validada con su esquema (o el motivo si no vale). */
export function formalAction(raw: Record<string, unknown>): AgentAction | string {
  const parsed = AgentAction.safeParse(raw);
  if (parsed.success) return parsed.data;
  const issue = parsed.error.issues[0];
  return `faltan datos (${issue?.path.join(".") || "acción"})`;
}

/** ¿Esta intención de la misma charla es la de un acuerdo en pie? (entonces no se duplica). */
export function coveredBy(
  intention: { text: string; personId?: string | null },
  standing: ResolvedAgreement[],
): ResolvedAgreement | undefined {
  return standing.find((a) => {
    if (intention.personId && !a.people.includes(intention.personId)) return false;
    return agreementKind(a.type)?.kind.covers?.(intention, a) ?? false;
  });
}

/** Cuenta una intención enlazada a un acuerdo (para «Evolución»). */
export function noteLinkedIntention(ctx: SimContext): void {
  agreementsState(ctx).linkedIntentions++;
}
