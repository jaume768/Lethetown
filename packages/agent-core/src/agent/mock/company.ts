/**
 * Mock de ir con otros: responder a una invitación (casi siempre sí), invitar de vez en cuando a
 * quien tiene delante (a su casa o al café) y, rara vez, acompañar a alguien.
 */
import { sectionLines, type DecideCtx } from "./context";
import { registerDecideRule, type DecideReply } from "./registry";

const act = (action: Record<string, unknown>, reason: string): DecideReply => ({
  response: { choice: "act", action },
  reason,
});

function answerInvite(c: DecideCtx): DecideReply | null {
  if (!c.available.has("accept_invite")) return null;
  const m = sectionLines(c.p, "INVITACIONES")
    .map((l) => /^Invitación (\S+): (.+?) te invita/.exec(l))
    .find(Boolean);
  if (!m) return null;
  if (c.h % 5 === 0 && c.available.has("decline_invite")) {
    return act(
      { type: "decline_invite", inviteId: m[1], reason: "ahora no puedo" },
      "No me viene bien.",
    );
  }
  return act({ type: "accept_invite", inviteId: m[1] }, `Me apetece ir con ${m[2]}.`);
}

function invite(c: DecideCtx): DecideReply | null {
  if (!c.available.has("invite") || !c.someone || c.speaker || c.h % 41 !== 0) return null;
  const home = /^Tu casa: (\S+)$/m.exec(c.req.system)?.[1];
  const cafe = c.places.find((p) => p.kind === "cafe" && p.id !== c.here);
  const place = c.h % 2 === 0 && home && home !== c.here ? home : cafe?.id;
  if (!place) return null;
  return act(
    { type: "invite", with: [c.someone], placeId: place, activity: "tomar algo y charlar" },
    "Me apetece seguir la charla en otro sitio.",
  );
}

function follow(c: DecideCtx): DecideReply | null {
  if (!c.available.has("follow") || !c.someone || c.speaker || c.h % 43 !== 0) return null;
  return act({ type: "follow", who: c.someone }, "Me voy con esta persona un rato.");
}

registerDecideRule({ name: "answer-invite", respond: answerInvite }, { before: "reply" });
registerDecideRule({ name: "invite", respond: invite }, { before: "greet" });
registerDecideRule({ name: "follow", respond: follow }, { before: "greet" });
