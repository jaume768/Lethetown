/**
 * Mock de habilidades: responder a una sesión de enseñanza (casi siempre sí), pedirle a quien
 * sabe más que le enseñe, enseñar lo que ha hecho, ayudar a quien trabaja y, a solas, ponerse a
 * practicar lo suyo; y contar un saber a quien tiene delante. Lee lo mismo que un LLM: ENSEÑAR Y
 * APRENDER, LO QUE SABES HACER y SABERES QUE PUEDES CONTAR.
 */
import { sectionLines, type DecideCtx } from "./context";
import { registerDecideRule, type DecideReply } from "./registry";

const act = (action: Record<string, unknown>, reason: string): DecideReply => ({
  response: { choice: "act", action },
  reason,
});

const lines = (c: DecideCtx) => sectionLines(c.p, "ENSEÑAR Y APRENDER");

function answerTeaching(c: DecideCtx): DecideReply | null {
  if (!c.available.has("accept_teaching")) return null;
  const m = lines(c)
    .map((l) => /^Sesión (\S+): (\S+)/.exec(l))
    .find(Boolean);
  if (!m) return null;
  if (c.h % 4 === 0 && c.available.has("decline_teaching")) {
    return act(
      { type: "decline_teaching", sessionId: m[1], reason: "ahora no me va bien" },
      "Ahora no tengo la cabeza para eso.",
    );
  }
  return act({ type: "accept_teaching", sessionId: m[1] }, `Venga, con ${m[2]}.`);
}

function askToLearn(c: DecideCtx): DecideReply | null {
  if (!c.available.has("ask_to_learn") || c.speaker || c.h % 23 !== 0) return null;
  const m = lines(c)
    .map((l) => /^Aquí sabe más que tú: (\S+) \((\S+)\) de .+? \[(\S+)\]/.exec(l))
    .find(Boolean);
  if (!m) return null;
  return act(
    { type: "ask_to_learn", who: m[2], skill: m[3] },
    `${m[1]} sabe mucho de esto; quiero aprender.`,
  );
}

function showResult(c: DecideCtx): DecideReply | null {
  if (!c.available.has("show_result") || !c.someone || c.speaker || c.h % 13 !== 0) return null;
  const m = lines(c)
    .map((l) => /^Tus resultados: (i\d+)/.exec(l))
    .find(Boolean);
  if (!m) return null;
  return act({ type: "show_result", who: c.someone, itemId: m[1] }, "Quiero que lo vea.");
}

function help(c: DecideCtx): DecideReply | null {
  if (!c.available.has("help") || !c.someone || c.speaker || c.h % 59 !== 0) return null;
  return act({ type: "help", who: c.someone }, "Le echo una mano.");
}

function practice(c: DecideCtx): DecideReply | null {
  if (!c.available.has("practice") || c.someone || c.h % 53 !== 0) return null;
  const skill = /Se te da bien: .+? \[(\S+)\]/.exec(c.p)?.[1];
  if (!skill) return null;
  return act({ type: "practice", skill, placeId: null, spotId: null }, "Un rato para lo mío.");
}

function shareLore(c: DecideCtx): DecideReply | null {
  if (!c.available.has("share_lore") || !c.someone || c.speaker || c.h % 17 !== 0) return null;
  const m = sectionLines(c.p, "SABERES QUE PUEDES CONTAR")
    .map((l) => /^(l\d+) (.+?) \(/.exec(l))
    .find(Boolean);
  if (!m) return null;
  return act({ type: "share_lore", who: c.someone, loreId: m[1] }, `Le cuento ${m[2]}.`);
}

registerDecideRule({ name: "share-lore", respond: shareLore }, { before: "greet" });
registerDecideRule({ name: "answer-teaching", respond: answerTeaching }, { before: "reply" });
registerDecideRule({ name: "ask-to-learn", respond: askToLearn }, { before: "greet" });
registerDecideRule({ name: "show-result", respond: showResult }, { before: "greet" });
registerDecideRule({ name: "help", respond: help }, { before: "greet" });
registerDecideRule({ name: "practice", respond: practice }, { before: "ponder" });
