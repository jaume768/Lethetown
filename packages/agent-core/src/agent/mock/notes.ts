/** Mock de las notas: de vez en cuando, quien pasa por la plaza cuelga algo en el tablón. */
import type { DecideCtx } from "./context";
import { registerDecideRule, type DecideReply } from "./registry";

const BOARD = [
  "Se busca compañía para pasear por el lago al atardecer.",
  "¿Alguien ha visto un gato gris por la plaza? Responde a casa.",
  "Mañana hay pan de pueblo recién hecho en la panadería.",
  "Cambio libros viejos por semillas para el huerto.",
  "Gracias a quien arregló la fuente. Así da gusto.",
];

function postNote(c: DecideCtx): DecideReply | null {
  if (!c.available.has("post_note") || c.speaker || c.h % 31 !== 0) return null;
  return {
    response: { choice: "act", action: { type: "post_note", text: BOARD[c.h % BOARD.length] } },
    reason: "Ya que paso por el tablón, dejo una nota.",
  };
}

registerDecideRule({ name: "post-note", respond: postNote }, { before: "ponder" });
