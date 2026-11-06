/**
 * Mock de la cognición en movimiento (fase 3.6): de camino (sección DE CAMINO), al cruzarse con
 * alguien que le importa se para a charlar si hay algo pendiente (el libro, una deuda, una cita),
 * a veces saluda al pasar y si no sigue su camino; si va con alguien, a veces le da
 * conversación; si alguien se ha parado a hablarle, casi siempre se para también. Quieto, a veces
 * devuelve un saludo.
 */
import { sectionLines, type DecideCtx } from "./context";
import { GREETINGS, REPLIES } from "./phrases";
import { registerDecideRule, type DecideReply } from "./registry";

const act = (action: Record<string, unknown>, reason: string): DecideReply => ({
  response: { choice: "act", action },
  reason,
});
const firstName = (name: string) => name.trim().split(" ")[0] ?? name;

/** De camino: qué hace con quien se cruza o con quien va. */
function onTheWay(c: DecideCtx): DecideReply | null {
  const way = sectionLines(c.p, "DE CAMINO");
  if (!way.length) return null;
  const { h } = c;
  // Alguien se ha parado a hablarle: casi siempre se para él o ella también.
  if (c.speaker && c.available.has("stop_to_chat")) {
    if (h % 4 === 0) return { response: { choice: "continue" }, reason: "Ahora no puedo pararme." };
    return act(
      { type: "stop_to_chat", to: c.speaker.from, text: REPLIES[h % REPLIES.length]! },
      "Me paro un momento, que me ha hablado.",
    );
  }
  // Una charla andando: contestar lo resuelven las reglas de siempre.
  if (c.speaker) return null;
  const withWho = way.map((l) => /^Vas con (\S+?)=(.+)\.$/.exec(l)).find(Boolean);
  if (withWho && c.available.has("say")) {
    if (h % 2 !== 0) return null;
    return act(
      { type: "say", to: withWho[1], text: `¿Y tú qué tal el día, ${firstName(withWho[2]!)}?` },
      "Ya que vamos juntos, le doy conversación.",
    );
  }
  const cross = way
    .map((l) => /^(?:Te cruzas con|Ves venir a) (\S+?)=(.+?), que .+?(?: \((.+)\))?\.$/.exec(l))
    .find(Boolean);
  if (!cross) return { response: { choice: "continue" }, reason: "Sigo mi camino." };
  const [, id, name, why = ""] = cross;
  const remembered = way.some((l) => l.startsWith("Te acuerdas de que querías"));
  const pending = remembered || /pendiente|préstamo|deuda|cita/.test(why);
  if (pending && c.available.has("stop_to_chat") && h % 3 !== 0) {
    return act(
      { type: "stop_to_chat", to: id, text: `¡${firstName(name!)}! Justo quería verte.` },
      "Tenemos algo pendiente; mejor me paro.",
    );
  }
  if (c.available.has("stop_to_chat") && h % 4 === 0) {
    return act(
      { type: "stop_to_chat", to: id, text: c.styled(GREETINGS[h % GREETINGS.length]!) },
      "Hace mucho que no hablamos; me paro un momento.",
    );
  }
  if (c.available.has("greet") && h % 3 !== 2) {
    return act(
      { type: "greet", to: id, text: `¡Buenas, ${firstName(name!)}!` },
      "Le saludo, pero voy con prisa.",
    );
  }
  return { response: { choice: "continue" }, reason: "Voy a lo mío." };
}

/** Quieto: alguien le ha saludado al pasar (y sigue cerca); a veces se lo devuelve. */
function greetBack(c: DecideCtx): DecideReply | null {
  if (!c.available.has("greet") || !c.speaker || sectionLines(c.p, "DE CAMINO").length) return null;
  if (c.h % 3 === 0) return null;
  return act(
    { type: "greet", to: c.speaker.from, text: "¡Hola! ¿Qué tal?" },
    "Me han saludado y saludo también.",
  );
}

registerDecideRule({ name: "on-the-way", respond: onTheWay }, { before: "hungry" });
registerDecideRule({ name: "greet-back", respond: greetBack }, { before: "hungry" });
