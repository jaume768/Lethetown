import { AgentAction, actionPeople, actionText, type ActionType } from "@lethetown/shared";
import { recallText } from "../memory/retrieval";
import { describeMood } from "./mood";
import { untrusted } from "./moderation";
import { DecideResponse, decideAction, parseWith } from "./parse";
import { decidePrompt } from "./prompts";
import { clipText, speechMax } from "./speech";
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
  // Reescribir lo recordado (reconsolidación, falso recuerdo) no retrasa la respuesta: se
  // hace después de decidir, en segundo plano.
  const rewrites: (() => Promise<void>)[] = [];
  const recalled = await a.deps.memory.retrieve({
    agentId: a.id,
    query: cue || a.state.action,
    now,
    moodValence: a.state.mood.valence,
    k: 3,
    recall: { ...a.recallContext(), defer: (w) => rewrites.push(w) },
  });
  const rewriteLater = () => {
    if (!rewrites.length) return;
    void (async () => {
      for (const w of rewrites) await w();
    })().catch((error: unknown) => a.deps.onError?.(a.id, "reconsolidate", error));
  };
  for (const s of recalled) {
    a.workingMemory.push({ text: recallText(s), memoryId: s.memory.id, addedAt: now });
  }

  try {
    const { salient: _salient, actions, agenda, task = "decide", ...context } = input;
    const prompt = decidePrompt({
      ...context,
      weather: a.weatherHere(input.weather),
      actions: actions ?? defaultActions(input.present),
      agenda,
      discovered: a.discoveredPlaces(),
      innerVoice: (input.innerVoice ?? []).map(untrusted),
      doneToday: a.diaryText(),
      now,
      locationId: a.state.locationId,
      action: a.state.action,
      moodLabel: describeMood(a.state.mood),
      needs: a.state.needs,
      planItem: a.currentPlanItem(now),
      workingMemory: a.workingMemory.render(),
    });
    // Devuelve la promesa tal cual (sin `async`): un paso de microtareas más cambiaría el mock.
    const ask = (extra = "") =>
      a.deps.llm.run({
        kind: "fast",
        task,
        agentId: a.id,
        system: a.system,
        prompt: prompt + extra,
      });
    const cfg = a.deps.memory.config.speech;
    const max = { say: speechMax(a.seed, cfg), reason: cfg.reasonMaxChars };
    let parsed = parseWith(DecideResponse, (await ask()).text);
    // Una persona inventada («la Pepa»): se repite UNA vez la decisión con el aviso. Si vuelve a
    // pasar, `checked` cambia el nombre por «alguien».
    const invented = inventedIn(a, parsed, max);
    if (invented.length) {
      parsed = parseWith(
        DecideResponse,
        (
          await ask(
            `\n\nOJO: ${invented.join(", ")} no existe: ni vive en el pueblo ni lo conoces. No inventes personas (vecinos, familiares ni conocidos); si es un rumor, «dicen por ahí», «me lo contó alguien» o un vecino de verdad. Decide otra vez.`,
          )
        ).text,
      );
    }
    // Algo que se propone hacer más adelante (memoria prospectiva).
    if (parsed.intention?.text) await a.intend(now, parsed.intention);
    return await checked(a, toDecision(parsed, max));
  } catch (error) {
    a.deps.onError?.(a.id, "decide", error);
    return { kind: "follow_plan" };
  } finally {
    rewriteLater();
  }
}

/** Acciones cuyo texto es algo que se dice en voz alta (fase 3.6: saludar, pararse a charlar). */
const SPOKEN = new Set(["say", "greet", "stop_to_chat"]);
const spoken = (type: string): "speech" | "action" => (SPOKEN.has(type) ? "speech" : "action");

/** Textos de una decisión que entran en el mundo, con su tipo (para los guardianes). */
function decisionTexts(d: Decision): { text: string; kind: "speech" | "action" }[] {
  const out: { text: string; kind: "speech" | "action" }[] = [];
  if (d.kind === "act") {
    const fields = d.action as unknown as Record<string, unknown>;
    for (const f of TEXT_FIELDS) {
      const v = fields[f];
      if (typeof v === "string" && v) out.push({ text: v, kind: spoken(d.action.type) });
    }
  }
  if (d.reason) out.push({ text: d.reason, kind: "action" });
  return out;
}

/** Campos de las acciones que llevan texto del LLM (lo que dice, la nota, el motivo). */
const TEXT_FIELDS = ["text", "reason"] as const;

/** Personas inventadas en lo que decidió (y en lo que se propone), y lo registra como reintento. */
function inventedIn(
  a: Agent,
  parsed: DecideResponse,
  max: { say: number; reason: number },
): string[] {
  const guard = a.deps.memory.guard;
  if (!guard) return [];
  const d = toDecision(parsed, max);
  const actors = [a.id, ...(d.kind === "act" ? actionPeople(d.action) : [])];
  const texts = [
    ...decisionTexts(d),
    ...(parsed.intention?.text ? [{ text: parsed.intention.text, kind: "action" as const }] : []),
  ];
  const found: string[] = [];
  for (const t of texts) {
    const ctx = { kind: t.kind, actors, agentId: a.id };
    const names = guard.findRewrites(t.text, ctx);
    if (names.length) guard.noteRewrites(t.text, ctx);
    found.push(...names);
  }
  return [...new Set(found)];
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

/**
 * Lo que la protección de menores descarta se convierte en seguir el plan. Antes, los
 * reescritores corrigen cada texto (una persona inventada pasa a ser «alguien»).
 */
export async function checked(a: Agent, input: Decision): Promise<Decision> {
  const d = rewritten(a, input);
  if (!d) return { kind: "follow_plan" };
  const reason = d.reason ?? "";
  if (d.kind === "act") {
    const kind = spoken(d.action.type);
    const text = `${actionText(d.action)} ${reason}`;
    if (!(await safe(a, text, kind, actionPeople(d.action)))) return { kind: "follow_plan" };
  }
  if (d.kind === "follow_plan" && reason && !(await safe(a, reason, "action"))) {
    return { kind: "follow_plan" };
  }
  return d;
}

/** La decisión con sus textos corregidos por los reescritores (null si alguno la descarta). */
function rewritten(a: Agent, d: Decision): Decision | null {
  const guard = a.deps.memory.guard;
  if (!guard) return d;
  const actors = [a.id, ...(d.kind === "act" ? actionPeople(d.action) : [])];
  const fix = (text: string, kind: "speech" | "action") =>
    guard.rewrite(text, { kind, actors, agentId: a.id });
  let out: Decision = d;
  if (d.kind === "act") {
    const kind = spoken(d.action.type);
    const action = { ...d.action } as Record<string, unknown>;
    for (const f of TEXT_FIELDS) {
      const v = action[f];
      if (typeof v !== "string" || !v) continue;
      const fixed = fix(v, kind);
      if (fixed === null) return null;
      action[f] = fixed;
    }
    out = { ...d, action: action as unknown as AgentAction };
  }
  if (out.reason) {
    const why = fix(out.reason, "action");
    out = why === null ? { ...out, reason: "" } : { ...out, reason: why };
  }
  return out;
}

/** Un saludo al pasar es muy corto (caracteres). */
const GREET_MAX = 60;

/**
 * Respuesta → decisión. Solo se comprueba la forma (el catálogo); si la acción es posible
 * (el lugar existe, la persona está…) lo decide el motor. Lo que dice (`say`) y el porqué se
 * recortan a `max` caracteres (`clipText`).
 */
export function toDecision(
  r: DecideResponse,
  max: { say: number; reason: number } = { say: 240, reason: 240 },
): Decision {
  const why = r.reason ? clipText(r.reason, max.reason) : "";
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
  const action =
    parsed.data.type === "say" || parsed.data.type === "stop_to_chat"
      ? { ...parsed.data, text: clipText(parsed.data.text, max.say) }
      : parsed.data.type === "greet"
        ? { ...parsed.data, text: clipText(parsed.data.text, Math.min(max.say, GREET_MAX)) }
        : parsed.data;
  return { kind: "act", action, ...reason };
}
