import { credibility } from "../memory/social";
import { looksLikeRumor } from "@lethetown/shared";
import { eventArousal } from "../memory/encoding";
import type { MemorySource } from "@lethetown/shared";
import { blendPerceptions } from "./mood";
import { untrusted } from "./moderation";
import { ImportanceResponse, parseWith } from "./parse";
import { importancePrompt } from "./prompts";
import type { Agent } from "./agent";
import type { Perception } from "./agent-types";
import { encoding } from "./agent-body";

export function describePerception(p: Perception): string {
  switch (p.kind) {
    case "arrived":
      return `Vi a ${p.name} llegar a ${p.placeId} (${p.action})`;
    case "speech":
      return p.toName
        ? `${p.fromName} le dijo a ${p.toName} (yo estaba en la conversación): "${p.text}"`
        : `${p.fromName} me dijo: "${p.text}"`;
    case "overheard":
      return `Oí a ${p.fromName} decirle a ${p.toName} algo como: "${p.fragment}"`;
    case "thought":
      // La voz interior la escribe un jugador: va delimitada como dato no confiable.
      return `Pensé: ${untrusted(p.text)}`;
    case "world":
      return p.text;
  }
}

function sourceOf(p: Perception): MemorySource {
  switch (p.kind) {
    case "speech":
      return `contado por ${p.fromId}`;
    case "overheard":
      return `contado por ${p.fromId ?? "alguien"}`;
    case "thought":
      return "inferido";
    default:
      return "vivido";
  }
}

function peopleOf(p: Perception): string[] {
  switch (p.kind) {
    case "arrived":
      return [p.agentId];
    case "speech":
      return [p.fromId];
    case "overheard":
      return p.fromId ? [p.fromId] : [];
    default:
      return [];
  }
}

function clamp(x: number, lo: number, hi: number): number {
  return Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : lo;
}

/** Percibir → guardar: convierte percepciones en recuerdos con importancia y valencia. */
export async function perceive(a: Agent, perceptions: Perception[], now: number): Promise<void> {
  if (!perceptions.length) return;
  const texts = perceptions.map(describePerception);
  const ratings = await rate(a, texts);
  const felt: { importance: number; valence: number }[] = [];
  for (const [i, p] of perceptions.entries()) {
    const rating = ratings[i] ?? { importance: 2, valence: 0 };
    felt.push(rating);
    // Atención: lo que llega de fuera mientras habla con alguien se graba peor.
    const arousal = Math.max(a.state.mood.arousal, eventArousal(rating.importance, rating.valence));
    const distracted =
      a.state.activityKind === "talk" && (p.kind === "arrived" || p.kind === "overheard");
    // Rumores: según lo que se fía de quien lo cuenta, lo graba con menos fuerza e
    // importancia, y si se fía poco, con duda.
    const cred = await credibilityOf(a, p);
    const doubt = cred !== null && cred < a.deps.memory.config.social.doubtBelow;
    const encoded = encoding(a, arousal, distracted);
    const record = await a.deps.memory.tryRemember(
      {
        agentId: a.id,
        text: doubt ? `(no sé si creérmelo) ${texts[i]!}` : texts[i]!,
        type: "observation",
        importance:
          p.kind === "thought"
            ? Math.max(rating.importance, 6)
            : cred === null
              ? rating.importance
              : Math.max(1, Math.round(rating.importance * (0.6 + 0.4 * cred))),
        emotionalValence: rating.valence,
        source: sourceOf(p),
        people: peopleOf(p),
        placeId: "placeId" in p ? p.placeId : a.state.locationId,
        eventId: "eventId" in p ? (p.eventId ?? null) : null,
        ...encoded,
        strength: cred === null ? encoded.strength : encoded.strength * (0.5 + 0.5 * cred),
      },
      now,
    );
    if (record) a.workingMemory.push({ text: record.text, memoryId: record.id, addedAt: now });
  }
  a.state.mood = blendPerceptions(a.state.mood, felt, a.deps.memory.config.mood.perceptionWeight);
}

/**
 * Credibilidad de lo que le cuentan (rumores y lo oído a escondidas): la confianza en quien
 * lo cuenta, menos si es chismoso. Devuelve null si no aplica.
 */
export async function credibilityOf(a: Agent, p: Perception): Promise<number | null> {
  const social = a.deps.social;
  if (!social) return null;
  const teller = p.kind === "overheard" ? p.fromId : p.kind === "speech" ? p.fromId : null;
  if (p.kind === "speech" && !looksLikeRumor(p.text)) return null;
  if (p.kind !== "speech" && p.kind !== "overheard") return null;
  const trust = teller ? ((await social.get(a.id, teller))?.trust ?? 0.5) : 0.3;
  return credibility(
    trust,
    teller ? (a.deps.gossips?.has(teller) ?? false) : false,
    a.deps.memory.config.social,
  );
}

export async function rate(
  a: Agent,
  texts: string[],
): Promise<{ importance: number; valence: number }[]> {
  try {
    const res = await a.deps.llm.run({
      kind: "fast",
      task: "importance",
      agentId: a.id,
      system: a.system,
      prompt: importancePrompt(texts),
      maxTokens: 400,
    });
    return parseWith(ImportanceResponse, res.text).ratings.map((r) => ({
      importance: clamp(r.importance, 1, 10),
      valence: clamp(r.valence, -1, 1),
    }));
  } catch (error) {
    a.deps.onError?.(a.id, "importance", error);
    return texts.map(() => ({ importance: 2, valence: 0 }));
  }
}

/** Guarda lo que el propio agente ha dicho. */
export async function rememberOwnSpeech(
  a: Agent,
  to: string,
  toName: string,
  utterance: string,
  now: number,
  eventId?: string,
) {
  await a.deps.memory.tryRemember(
    {
      agentId: a.id,
      text: `Le dije a ${toName}: "${utterance}"`,
      type: "observation",
      importance: 3,
      people: [to],
      placeId: a.state.locationId,
      eventId: eventId ?? null,
      ...encoding(a, a.state.mood.arousal, false),
    },
    now,
  );
}
