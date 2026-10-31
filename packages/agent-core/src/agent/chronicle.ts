import { z } from "zod";
import type { LLMClient } from "../llm/client";
import type { MinorGuard } from "./minor-safety";
import { parseWith } from "./parse";
import { languageRule, type PromptLanguage } from "./prompts";
import { MAX_TOKENS } from "../llm/limits";

/** Prefijo fijo del narrador (cacheable). */
export const NARRATOR_SYSTEM = `Eres el cronista de Lethetown, un pequeño pueblo. Escribes breves crónicas del día,
cálidas y con algo de ironía, en español, en tercera persona y en pasado. Nunca inventas hechos que no estén en los eventos.
Responde SIEMPRE con un único objeto JSON válido, sin texto antes ni después.`;

export const ChronicleResponse = z.object({ title: z.string().min(1), text: z.string().min(1) });
export type Chronicle = z.infer<typeof ChronicleResponse> & { day: number };

/** Crónica del día a partir del log de eventos (modelo "reflection"). */
export async function writeChronicle(
  llm: LLMClient,
  day: number,
  events: string[],
  maxEvents = 120,
  language: PromptLanguage = "es",
  /** Protección de menores: se quitan las frases que no pasen. */
  guard?: MinorGuard,
): Promise<Chronicle> {
  const lines = events.slice(-maxEvents);
  const res = await llm.run({
    kind: "reflection",
    task: "chronicle",
    system: NARRATOR_SYSTEM + languageRule(language),
    maxTokens: MAX_TOKENS.chronicle,
    prompt: `TAREA: chronicle
Día ${day}. Eventos del pueblo (en orden):
${lines.map((e) => `- ${e}`).join("\n") || "- (no pasó nada)"}

Escribe la crónica del día en 3-6 frases y un título corto.
Formato:
{"title":"...","text":"..."}`,
  });
  const chronicle = { day, ...parseWith(ChronicleResponse, res.text) };
  if (!guard) return chronicle;
  const ctx = { kind: "chronicle" as const };
  const text = await guard.filterSentences(chronicle.text, ctx);
  const title = (await guard.allows(chronicle.title, ctx)) ? chronicle.title : `Día ${day}`;
  return { day, title, text: text || "Fue un día tranquilo en Lethetown." };
}
