/**
 * Mock de conocer el pueblo: a quien le mueve la curiosidad (apertura alta) le da más a menudo
 * por explorar, siempre que haga buen tiempo, esté solo y no tenga nada mejor que hacer.
 */
import type { DecideCtx } from "./context";
import { registerDecideRule, type DecideReply } from "./registry";

const ZONES = ["norte", "sur", "este", "oeste"] as const;

function explore(c: DecideCtx): DecideReply | null {
  if (!c.available.has("explore") || c.present.length || c.raining || c.need) return null;
  const curious = /curiosidad y lo nuevo/.test(c.personality);
  if (c.h % (curious ? 11 : 47) !== 0) return null;
  return {
    response: {
      choice: "act",
      action: { type: "explore", zone: c.h % 3 === 0 ? ZONES[c.h % 4] : null },
    },
    reason: curious
      ? "Me pica la curiosidad: quiero ver qué hay por ahí que aún no conozco."
      : "Voy a dar una vuelta por donde nunca paso.",
  };
}

registerDecideRule({ name: "explore", respond: explore }, { before: "ponder" });
