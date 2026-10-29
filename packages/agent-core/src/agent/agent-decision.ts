import { recallText } from "../memory/retrieval";
import { inferActivityKind } from "./activity";
import { describeMood } from "./mood";
import { untrusted } from "./moderation";
import { DecideResponse, parseWith } from "./parse";
import { decidePrompt } from "./prompts";
import type { Agent } from "./agent";
import type { Decision, DecideInput } from "./agent-types";

/** Decidir: seguir el plan, reaccionar o hablar. Solo llama al LLM si hay algo saliente. */
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
    const { salient: _salient, ...context } = input;
    const res = await a.deps.llm.run({
      kind: "fast",
      task: "decide",
      agentId: a.id,
      system: a.system,
      prompt: decidePrompt({
        ...context,
        weather: a.weatherHere(input.weather),
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
    return await checked(a, toDecision(a, parsed, input.present));
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
  if (d.kind === "talk" && !(await safe(a, `${d.utterance} ${reason}`, "speech", [d.to]))) {
    return { kind: "follow_plan" };
  }
  if (d.kind === "react" && !(await safe(a, `${d.action} ${reason}`, "action"))) {
    return { kind: "follow_plan" };
  }
  if (d.kind === "follow_plan" && reason && !(await safe(a, reason, "action"))) {
    return { kind: "follow_plan" };
  }
  return d;
}

export function toDecision(a: Agent, r: DecideResponse, present: { id: string }[]): Decision {
  const why = r.reason?.trim().slice(0, 240);
  const reason = why ? { reason: why } : {};
  if (r.choice === "talk" && r.to && r.say && present.some((p) => p.id === r.to)) {
    return { kind: "talk", to: r.to, utterance: r.say, ...reason };
  }
  if (r.choice === "react" && r.action) {
    const placeId = a.validPlace(r.placeId) ?? a.state.locationId;
    const spot = a.spot(r.spotId);
    return {
      kind: "react",
      action: r.action,
      placeId,
      spotId: spot && spot.placeId === placeId ? spot.id : null,
      activityKind: r.activityKind ?? inferActivityKind(r.action, spot?.pose),
      ...reason,
    };
  }
  return { kind: "follow_plan", ...reason };
}
