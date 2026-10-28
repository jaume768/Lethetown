import { z } from "zod";
import type { LLMClient } from "../llm/client";
import { parseWith } from "./parse";
import { languageRule, type PromptLanguage } from "./prompts";

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
): Promise<Chronicle> {
  const lines = events.slice(-maxEvents);
  const res = await llm.run({
    kind: "reflection",
    task: "chronicle",
    system: NARRATOR_SYSTEM + languageRule(language),
    maxTokens: 1500,
    prompt: `TAREA: chronicle
Día ${day}. Eventos del pueblo (en orden):
${lines.map((e) => `- ${e}`).join("\n") || "- (no pasó nada)"}

Escribe la crónica del día en 3-6 frases y un título corto.
Formato:
{"title":"...","text":"..."}`,
  });
  return { day, ...parseWith(ChronicleResponse, res.text) };
}
