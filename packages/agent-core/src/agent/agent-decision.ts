import { AgentAction, actionPeople, actionText, type ActionType } from "@lethetown/shared";
import { recallText } from "../memory/retrieval";
import { describeMood } from "./mood";
import { untrusted } from "./moderation";
import { DecideResponse, decideAction, parseWith } from "./parse";
import { decidePrompt } from "./prompts";
import type { Agent } from "./agent";
import type { Decision, DecideInput } from "./agent-types";

/** Acciones si el motor no dice otra cosa: cambiar de actividad, y hablar si hay alguien. */
export function defaultActions(present: { id: string }[]): ActionType[] {
  return present.length ? ["do_activity", "say"] : ["do_activity"];
}

/** Decidir: seguir el plan o una acción del catálogo. Solo llama al LLM si hay algo saliente. */
export async function decide(a: Agent, now: number, input: DecideInput): Promise<Decision> {
  if (!input.salient) return { kind: "follow_plan" };

  const cue = [
    ...input.heard.map((h) => `${h.fromName} dice: ${h.text}`),
    ...input.present.map((p) => p.name),
    ...input.objectStates.map((o) => `${o.id} ${o.state}`),
  ].join(". ");
  const recalled = await a.deps.memory.retrieve({
    agentId: a.id,
    query: cue || a.state.action,
    now,
    moodValence: a.state.mood.valence,
    k: 3,
    recall: a.recallContext(),
  });
  for (const s of recalled) {
    a.workingMemory.push({ text: recallText(s), memoryId: s.memory.id, addedAt: now });
  }

  try {
    const { salient: _salient, actions, ...context } = input;
    const res = await a.deps.llm.run({
      kind: "fast",
      task: "decide",
      agentId: a.id,
      system: a.system,
      prompt: decidePrompt({
        ...context,
        weather: a.weatherHere(input.weather),
        actions: actions ?? defaultActions(input.present),
        innerVoice: (input.innerVoice ?? []).map(untrusted),
        doneToday: a.diaryText(),
        now,
        locationId: a.state.locationId,
        action: a.state.action,
        moodLabel: describeMood(a.state.mood),
        needs: a.state.needs,
        planItem: a.currentPlanItem(now),
        workingMemory: a.workingMemory.render(),
      }),
    });
    const parsed = parseWith(DecideResponse, res.text);
    // Algo que se propone hacer más adelante (memoria prospectiva).
    if (parsed.intention?.text) await a.intend(now, parsed.intention);
    return await checked(a, toDecision(parsed));
  } catch (error) {
    a.deps.onError?.(a.id, "decide", error);
    return { kind: "follow_plan" };
  }
}

/** ¿Pasa la protección de menores? (sin guardián, siempre). */
export async function safe(
  a: Agent,
  text: string,
  kind: "speech" | "action" | "plan",
  actors: string[] = [],
): Promise<boolean> {
  const guard = a.deps.memory.guard;
  return !guard || guard.allows(text, { kind, actors: [a.id, ...actors], agentId: a.id });
}

/** Lo que la protección de menores descarta se convierte en seguir el plan. */
export async function checked(a: Agent, d: Decision): Promise<Decision> {
  const reason = d.reason ?? "";
  if (d.kind === "act") {
    const kind = d.action.type === "say" ? "speech" : "action";
    const text = `${actionText(d.action)} ${reason}`;
    if (!(await safe(a, text, kind, actionPeople(d.action)))) return { kind: "follow_plan" };
  }
  if (d.kind === "follow_plan" && reason && !(await safe(a, reason, "action"))) {
    return { kind: "follow_plan" };
  }
  return d;
}

/**
 * Respuesta → decisión. Solo se comprueba la forma (el catálogo); si la acción es posible
 * (el lugar existe, la persona está…) lo decide el motor.
 */
export function toDecision(r: DecideResponse): Decision {
  const why = r.reason?.trim().slice(0, 240);
  const reason = why ? { reason: why } : {};
  if (r.choice === "continue") return { kind: "follow_plan", ...reason };
  const parsed = AgentAction.safeParse(decideAction(r));
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const error = issue
      ? `${issue.path.join(".") || "acción"}: ${issue.message}`
      : "acción no válida";
    return { kind: "invalid", error, ...reason };
  }
  return { kind: "act", action: parsed.data, ...reason };
}
