/**
 * Mock de las citas: responder a una invitación, proponer quedar y, muy de vez en cuando,
 * anular una cita. Se registran como reglas de decisión (ver registry.ts).
 */
import type { DecideCtx } from "./context";
import { registerDecideRule, type DecideReply } from "./registry";

/** Líneas de la AGENDA del prompt. */
function agenda(c: DecideCtx): string[] {
  const block = c.p.split("AGENDA:\n")[1] ?? "";
  const out: string[] = [];
  for (const line of block.split("\n")) {
    if (!line.startsWith("- ")) break;
    out.push(line.slice(2));
  }
  return out;
}

/** Le han propuesto una cita: casi siempre acepta; a veces no le viene bien. */
function answerInvitation(c: DecideCtx): DecideReply | null {
  if (!c.available.has("accept_meeting")) return null;
  const pending = agenda(c)
    .map((l) => /^Cita (\S+): (\S+) te propone quedar/.exec(l))
    .find(Boolean);
  if (!pending) return null;
  if (c.h % 4 === 0 && c.available.has("decline_meeting")) {
    return {
      response: {
        choice: "act",
        action: { type: "decline_meeting", meetingId: pending[1], reason: "no me viene bien" },
      },
      reason: `No me apetece quedar con ${pending[2]} ahora mismo.`,
    };
  }
  return {
    response: { choice: "act", action: { type: "accept_meeting", meetingId: pending[1] } },
    reason: `Me apetece ver a ${pending[2]}.`,
  };
}

/** Charlando con alguien, a veces le propone quedar otro día en un sitio público. */
function propose(c: DecideCtx): DecideReply | null {
  if (!c.available.has("propose_meeting") || !c.someone || c.h % 29 !== 0) return null;
  // Solo quien no tiene ya planes (agenda vacía).
  if (agenda(c).length) return null;
  const name = new RegExp(`${c.someone}=(\\S+)`).exec(c.presentLine)?.[1] ?? "";
  const place =
    c.places.find((p) => p.kind === "cafe" && !p.outdoor) ??
    c.places.find((p) => p.kind !== "home");
  if (!place) return null;
  const at = c.h % 2 === 0 ? "10:30" : "17:30";
  return {
    response: {
      choice: "act",
      action: {
        type: "propose_meeting",
        with: [c.someone],
        placeId: place.id,
        at,
        day: "mañana",
        reason: "tomar algo y charlar con calma",
      },
    },
    reason: `Me gustaría ver a ${name || "esta persona"} con más calma.`,
  };
}

/** Muy de vez en cuando le surge algo y anula una cita. */
function cancel(c: DecideCtx): DecideReply | null {
  if (!c.available.has("cancel_meeting") || c.h % 53 !== 0) return null;
  const id = agenda(c)
    .map((l) => /^Cita (\S+) con /.exec(l)?.[1])
    .find(Boolean);
  if (!id) return null;
  return {
    response: {
      choice: "act",
      action: { type: "cancel_meeting", meetingId: id, reason: "me ha surgido algo" },
    },
    reason: "Al final no voy a poder ir.",
  };
}

registerDecideRule({ name: "answer-invitation", respond: answerInvitation }, { before: "reply" });
registerDecideRule({ name: "propose-meeting", respond: propose }, { before: "greet" });
registerDecideRule({ name: "cancel-meeting", respond: cancel }, { before: "ponder" });
