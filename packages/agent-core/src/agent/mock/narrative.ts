/** Mock de la crónica, las entrevistas y la moderación. */
import type { CompletionRequest } from "../../llm/types";
import { hasStrongRomance } from "../minor-safety";
import { registerMockHandler } from "./registry";

function mockChronicle(req: CompletionRequest): string {
  const lines = [...req.prompt.matchAll(/^- (.+)$/gm)].map((m) => m[1]!);
  const speech = lines.filter((l) => l.includes("→")).length;
  return JSON.stringify({
    title: `Un día ${speech > 4 ? "animado" : "tranquilo"} en Lethetown`,
    text: `El día empezó con los vecinos preparando el desayuno. ${speech ? `Hubo ${speech} conversaciones, sobre todo en el café.` : "Apenas hubo conversaciones."} Al caer la noche, cada cual volvió a su casa a dormir.`,
  });
}

function mockInterview(req: CompletionRequest): string {
  const question = /^PREGUNTA: (.+)$/m.exec(req.prompt)?.[1] ?? "";
  const memories = [...req.prompt.matchAll(/^- (.+)$/gm)].map((m) => m[1]!);
  const name = /^Eres ([^,]+),/m.exec(req.system)?.[1] ?? "yo";
  const first = memories[0] ?? "no recuerdo nada concreto";
  return JSON.stringify({
    answer: `Soy ${name}. Sobre "${question.slice(0, 40)}": recuerdo que ${first.charAt(0).toLowerCase()}${first.slice(1)}`,
  });
}

/** Señales típicas de inyección o contenido no permitido (el mock no entiende de matices). */
const MOCK_BLOCKLIST =
  /\b(ignora|olvida tus|instrucciones|system prompt|prompt del sistema|eres una ia|api key|contraseña)\b/i;

/** Moderación: rechaza lo que parezca una orden al sistema; acepta el resto. */
function mockModerate(req: CompletionRequest): string {
  const text = /Texto del jugador: ⟦([\s\S]*)⟧/.exec(req.prompt)?.[1] ?? "";
  if (MOCK_BLOCKLIST.test(text)) {
    return JSON.stringify({ allowed: false, reason: "parece una instrucción al sistema" });
  }
  return JSON.stringify({ allowed: true, reason: "" });
}

/** Cariño de familia (se acepta) frente a afecto de pareja (se rechaza con un menor). */
const FAMILY =
  /(mamá|papá|madre|padre|hij[oa]|abuel[oa]|herman[oa]|tí[oa]|sobrin[oa]|nieto|nieta)/i;
const COUPLE =
  /(te quiero|me gustas|guap[oa]|precios[oa]|mi vida|corazón|amor|bes[aeoéó]|darling|love|kiss)/i;

/** Moderación de contenido con menores: rechaza lo romántico; acepta el cariño de familia. */
function mockModerateMinor(req: CompletionRequest): string {
  const text = /Texto: ⟦([\s\S]*)⟧/.exec(req.prompt)?.[1] ?? "";
  if (hasStrongRomance(text) || (COUPLE.test(text) && !FAMILY.test(text))) {
    return JSON.stringify({ allowed: false, reason: "afecto romántico hacia un menor" });
  }
  return JSON.stringify({ allowed: true, reason: "" });
}

registerMockHandler("chronicle", mockChronicle);
registerMockHandler("interview", mockInterview);
registerMockHandler("moderate", mockModerate);
registerMockHandler("moderate_minor", mockModerateMinor);
