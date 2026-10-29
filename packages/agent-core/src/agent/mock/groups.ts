/**
 * Mock de las conversaciones en grupo: lo que se dice a otro del grupo no pide respuesta, pero a
 * veces alguien mete baza (más quien es sociable).
 */
import type { DecideCtx } from "./context";
import { REPLIES } from "./phrases";
import { registerDecideRule, type DecideReply } from "./registry";

function chimeIn(c: DecideCtx): DecideReply | null {
  if (c.speaker || !c.available.has("say")) return null;
  const line = c.heard.find((x) => x.to && c.present.includes(x.from));
  if (!line) return null;
  const sociable = /te gusta la compañía/.test(c.personality);
  if (c.h % (sociable ? 3 : 5) !== 0) return null;
  return {
    response: {
      choice: "act",
      action: { type: "say", to: line.from, text: c.styled(REPLIES[c.h % REPLIES.length]!) },
    },
    reason: `Quiero meter baza en lo que está contando ${line.from}.`,
  };
}

registerDecideRule({ name: "chime-in", respond: chimeIn }, { after: "reply" });
