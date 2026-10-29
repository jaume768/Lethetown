import { z } from "zod";
import type { MemorySystem } from "../memory/memory-system";
import { recallText } from "../memory/retrieval";
import type { Agent } from "./agent";
import { parseWith } from "./parse";
import type { LLMClient } from "../llm/client";

/** Batería fija de preguntas (inspirada en las entrevistas de Park et al.). */
export const INTERVIEW_QUESTIONS = [
  { category: "autoconocimiento", question: "¿Quién eres y a qué te dedicas?" },
  { category: "autoconocimiento", question: "¿Cómo describirías tu forma de ser?" },
  { category: "memoria", question: "¿Qué es lo más importante que te ha pasado últimamente?" },
  { category: "memoria", question: "¿Con quién hablaste ayer y de qué?" },
  { category: "planes", question: "¿Qué planes tienes para mañana?" },
  { category: "reacciones", question: "Si la cafetera del café se rompiera, ¿qué harías?" },
  { category: "relaciones", question: "¿Qué opinas de tus vecinos?" },
  { category: "reflexiones", question: "¿Qué has aprendido sobre ti en estos días?" },
] as const;

export interface InterviewAnswer {
  category: string;
  question: string;
  answer: string;
  /** Recuerdos (texto tal como lo ve el agente) en que se basó. */
  memories: string[];
}

const InterviewResponse = z.object({ answer: z.string().min(1) });

/**
 * Entrevista a un agente. Usa `inspect` (no refuerza ni reconsolida) para que la entrevista
 * no altere la memoria: así sirve como test de regresión.
 */
export async function interviewAgent(
  agent: Agent,
  memory: MemorySystem,
  llm: LLMClient,
  now: number,
  questions: readonly { category: string; question: string }[] = INTERVIEW_QUESTIONS,
): Promise<InterviewAnswer[]> {
  const out: InterviewAnswer[] = [];
  for (const q of questions) {
    const scored = await memory.inspect({
      agentId: agent.id,
      query: q.question,
      now,
      moodValence: agent.state.mood.valence,
    });
    const memories = scored
      .filter((s) => s.memory.status === "active" && s.scores.clarity !== "forgotten")
      .slice(0, 5)
      .map(recallText);
    const res = await llm.run({
      kind: "fast",
      task: "interview",
      agentId: agent.id,
      system: agent.system,
      maxTokens: 600,
      prompt: `TAREA: interview
Te están entrevistando. Contesta en primera persona, con naturalidad y en 1-3 frases, usando solo lo que recuerdas.
Lo que recuerdas:
${memories.map((m) => `- ${m}`).join("\n") || "- (nada)"}
PREGUNTA: ${q.question}
Formato:
{"answer":"..."}`,
    });
    const answer = parseWith(InterviewResponse, res.text).answer;
    const safe = await memory.guard?.allows(answer, {
      kind: "interview",
      actors: [agent.id],
      agentId: agent.id,
    });
    out.push({
      ...q,
      answer: safe === false ? "(respuesta retirada por la protección de menores)" : answer,
      memories,
    });
  }
  return out;
}
