/**
 * Mock de `decide`: una lista ordenada de reglas pequeñas sobre el contexto del prompt. La
 * primera que responde gana; si ninguna lo hace, sigue con su plan. Una acción nueva registra su
 * regla con `registerDecideRule` (en su módulo), antes o después de las de aquí.
 */
import type { Weather } from "@lethetown/shared";
import type { CompletionRequest } from "../../llm/types";
import { decideContext, outingFor, type DecideCtx } from "./context";
import { RAIN_TALK, FOLLOW_UPS, GREETINGS, REPLIES } from "./phrases";
import { decideRules, registerDecideRule, registerMockHandler, type DecideReply } from "./registry";

/** Qué hace quien se ve afectado por el tiempo: dónde se refugia y cómo lo cuenta. */
const SHELTER_ACTION: Record<"roof" | "cover" | "shade", (where: string) => string> = {
  roof: (where) => `ponerse a salvo del temporal en ${where}`,
  cover: (where) => `resguardarse de la lluvia en ${where}`,
  shade: (where) => `buscar la sombra en ${where}`,
};
const STAY_IN: Partial<Record<Weather, string>> = {
  rain: "esperar a que deje de llover",
  storm: "quedarse a cubierto hasta que pase la tormenta",
  snow: "quedarse al calor mientras nieva",
  heat: "refrescarse a la sombra hasta que baje el calor",
};

const say = (response: Record<string, unknown>, reason: string): DecideReply => ({
  response,
  reason,
});

/** Se acaba de acordar de algo que quería hacer con alguien que está aquí: lo hace. */
function remembered(c: DecideCtx): DecideReply | null {
  const m = /^- Te acuerdas de que querías (.+?) \(ahí está (.+)\)\.$/m.exec(c.p);
  const withWhom = m && c.present.find((id) => c.presentLine.includes(`${id}=${m[2]}`));
  if (!m || !withWhom) return null;
  return say(
    { choice: "talk", to: withWhom, say: `¡Ay, por cierto! Tenía que ${m[1]}.` },
    "Menos mal que me he acordado justo ahora.",
  );
}

/** Un objeto roto: va a mirarlo (si no lo ha mirado ya hoy). */
function brokenObject(c: DecideCtx): DecideReply | null {
  const b = c.broken;
  if (!b || c.h % 2 !== 0 || c.did(`mirar qué le pasa a ${b[1]}`)) return null;
  return say(
    {
      choice: "react",
      action: `mirar qué le pasa a ${b[1]}`,
      activityKind: "work",
      placeId: c.here,
    },
    `Se ha estropeado ${b[1]} y no puedo dejarlo así.`,
  );
}

/** Voz interior recién recibida: casi siempre se le hace caso (ir, contarlo o pensarlo). */
function innerVoice(c: DecideCtx): DecideReply | null {
  const voice = c.voice;
  if (!voice) return null;
  if (c.h % 3 === 0) {
    return say({ choice: "continue" }, "Es una idea curiosa, pero ahora tengo cosas que hacer.");
  }
  const idea = c.places.find((x) => x.id !== c.here && voice.includes(x.name) && !c.visited(x.id));
  if (idea) {
    const o = outingFor(idea);
    return say(
      {
        choice: "react",
        action: `ir a ${idea.name}`,
        activityKind: o.kind,
        placeId: idea.id,
        spotId: idea.objects.find((x) => x.pose === o.pose)?.id ?? null,
      },
      `Se me ha metido en la cabeza ir a ${idea.name} y voy a hacerle caso.`,
    );
  }
  const listener = c.present[c.h % Math.max(1, c.present.length)];
  if (listener && c.h % 2 === 0) {
    return say(
      { choice: "talk", to: listener, say: `¿Sabes qué estaba pensando? ${voice}` },
      "Le doy vueltas a una idea y necesito contársela a alguien.",
    );
  }
  return say(
    {
      choice: "react",
      action: `pensar en ello: ${voice.slice(0, 40)}`,
      activityKind: "idle",
      placeId: c.here,
    },
    "No puedo quitármelo de la cabeza; necesito pararme a pensarlo.",
  );
}

/** Mal tiempo: si le pilla fuera (o su plan es al aire libre), busca dónde resguardarse. */
function shelter(c: DecideCtx): DecideReply | null {
  const { need, exposed, h } = c;
  if (!need || !(exposed || c.planOutside) || h % 2 !== 0) return null;
  if (c.speaker && !(exposed && h % 3 === 0)) return null;
  const why = `Con este tiempo (${c.weatherLabel}) no se puede estar fuera.`;
  if (!exposed) {
    return say(
      {
        choice: "react",
        action: STAY_IN[c.weather!] ?? "quedarse a cubierto",
        activityKind: "idle",
        placeId: c.here,
      },
      `${why} Mejor me quedo donde estoy.`,
    );
  }
  const cover = need !== "roof" ? c.herePlace?.objects.find((o) => o.shelter) : undefined;
  if (cover && h % 3 !== 0) {
    return say(
      {
        choice: "react",
        action: SHELTER_ACTION[need](cover.id.replace(/_/g, " ")),
        activityKind: "idle",
        placeId: c.here,
        spotId: cover.id,
      },
      `${why} Aquí al lado hay donde ponerse a cubierto.`,
    );
  }
  const home = /^Tu casa: (\S+)$/m.exec(c.req.system)?.[1];
  const covered = c.places.filter(
    (x) => !x.outdoor && (x.kind === "cafe" || x.id === "biblioteca"),
  );
  // Mejor un sitio en el que no haya estado hoy.
  const fresh = covered.filter((x) => !c.visited(x.id));
  const indoor = fresh.length ? fresh : covered;
  const dest =
    h % 3 === 0 && home
      ? c.places.find((x) => x.id === home)
      : indoor[h % Math.max(1, indoor.length)];
  if (!dest) return null;
  return say(
    {
      choice: "react",
      action: SHELTER_ACTION[need](dest.name),
      activityKind: "sit",
      placeId: dest.id,
      spotId: dest.objects.find((o) => o.pose === "sit")?.id ?? null,
    },
    `${why} Me voy a ${dest.name}.`,
  );
}

/** Aviso de la simulación: su plan dice que toca irse, pero está hablando con alguien. */
function planClash(c: DecideCtx): DecideReply | null {
  const clash = /Según tu plan ahora toca (.+) en (.+?), pero estás hablando con (.+)\./.exec(c.p);
  const partner = /^CONVERSACIÓN: (\S+)$/m.exec(c.p)?.[1];
  const settled = /te dejo, que me toca|haciendo: seguir charlando/.test(c.p);
  if (!clash || !partner || !c.present.includes(partner) || settled) return null;
  const [, activity, placeName, name] = clash;
  // Si hoy ya se quedó charlando con esta persona, esta vez se despide.
  if (c.h % 3 === 0 && !c.did(`seguir charlando con ${name}`)) {
    return say(
      {
        choice: "react",
        action: `seguir charlando con ${name}`,
        activityKind: "talk",
        placeId: c.here,
      },
      `La charla con ${name} me apetece más; ${activity} puede esperar un poco.`,
    );
  }
  if (c.h % 3 === 1) {
    return say(
      {
        choice: "talk",
        to: partner,
        say: `Bueno, te dejo, que me toca ${activity}. ¡Luego seguimos!`,
      },
      `Tengo que ir a ${placeName}, pero no quiero dejar a ${name} con la palabra en la boca.`,
    );
  }
  return say({ choice: "continue" }, `Se me hace tarde para ${activity}; me voy ya.`);
}

/** Introvertido con la necesidad social cubierta: a veces no le apetece contestar. */
function noMood(c: DecideCtx): DecideReply | null {
  const { speaker } = c;
  const loner = c.personality.includes("necesitas ratos a solas");
  if (!speaker || !c.present.includes(speaker.from) || !loner || c.social <= 0.7) return null;
  if (c.h % 4 !== 1) return null;
  return say({ choice: "continue" }, "Ahora mismo no me apetece hablar con nadie.");
}

/** Le han hablado: contesta (o lleva la contraria, si es poco amable). */
function reply(c: DecideCtx): DecideReply | null {
  const { speaker, h } = c;
  if (!speaker || !c.present.includes(speaker.from) || h % 3 === 0) return null;
  const asked = speaker.text.trim().endsWith("?");
  const blunt = c.personality.includes("dices lo que piensas") && h % 5 === 2;
  const text = blunt
    ? "Pues no estoy de acuerdo, la verdad."
    : !asked && h % 4 === 1
      ? FOLLOW_UPS[h % FOLLOW_UPS.length]!
      : c.raining && h % 5 === 0
        ? RAIN_TALK[h % RAIN_TALK.length]!
        : REPLIES[h % REPLIES.length]!;
  return say(
    { choice: "talk", to: speaker.from, say: c.styled(text) },
    blunt ? "No pienso darle la razón en esto." : "Me han hablado y quiero contestar.",
  );
}

/** Cuenta algo que oyó a escondidas (así se propagan los rumores). */
function spreadRumor(c: DecideCtx): DecideReply | null {
  if (c.speaker || !c.someone || !c.rumor || c.h % 4 !== 0) return null;
  return say(
    { choice: "talk", to: c.someone, say: `¿Sabes? Oí a ${c.rumor[1]} decir "${c.rumor[2]}".` },
    "Oí algo y no puedo guardármelo.",
  );
}

/** Confidencia: algo que recuerda sobre otra persona (así viajan los secretos del pueblo). */
function confide(c: DecideCtx): DecideReply | null {
  if (c.speaker || !c.someone || c.h % 3 !== 0) return null;
  const someoneName = new RegExp(`${c.someone}=(\\S+)`).exec(c.presentLine)?.[1] ?? "";
  const secret = c.memories.find((l) => !someoneName || !l.includes(someoneName));
  if (!secret) return null;
  return say(
    { choice: "talk", to: c.someone, say: `¿Te cuento una cosa? ${secret}` },
    "Me fío de esta persona y quiero contárselo.",
  );
}

/**
 * Una idea de la voz interior que nombra un lugar: ir allí. Solo de vez en cuando y no a la hora
 * de comer o cenar (la idea sigue en la memoria de trabajo).
 */
function followIdea(c: DecideCtx): DecideReply | null {
  const { thought } = c;
  const idea =
    thought &&
    c.places.find((x) => x.id !== c.here && thought.includes(x.name) && !c.visited(x.id));
  const eating = /haciendo: (comer|cenar)/.test(c.p);
  if (!idea || c.speaker || eating || c.h % 4 !== 0) return null;
  const o = outingFor(idea);
  return say(
    {
      choice: "react",
      action: `ir a ${idea.name}: se le ha metido en la cabeza`,
      activityKind: o.kind,
      placeId: idea.id,
      spotId: idea.objects.find((x) => x.pose === o.pose)?.id ?? null,
    },
    `Sigo dándole vueltas a ir a ${idea.name}.`,
  );
}

/** Hay alguien conocido: le saluda o comenta algo del sitio, del tiempo o de su plan. */
function greet(c: DecideCtx): DecideReply | null {
  if (c.speaker || !c.someone || c.h % 2 !== 0) return null;
  const contextual = [
    ...GREETINGS,
    ...(c.herePlace ? [`¡Qué bien se está hoy en ${c.herePlace.name}!`] : []),
    ...(c.raining ? RAIN_TALK : []),
    ...(c.plan ? [`Yo vengo de paso, que luego toca ${c.plan}.`] : []),
  ];
  return say(
    { choice: "talk", to: c.someone, say: c.styled(contextual[c.h % contextual.length]!) },
    "Hay alguien conocido y me apetece charlar.",
  );
}

/** Se queda pensando en algo que se le pasó por la cabeza. */
function ponder(c: DecideCtx): DecideReply | null {
  const { thought } = c;
  if (!thought || c.speaker || c.h % 3 !== 0 || c.did("pensar en ello")) return null;
  return say(
    {
      choice: "react",
      action: `pensar en ello: ${thought.slice(0, 40)}`,
      activityKind: "idle",
      placeId: c.here,
    },
    "Me he quedado pensando en algo.",
  );
}

/** Mucha hambre (aviso del motor): come algo donde esté. */
function hungry(c: DecideCtx): DecideReply | null {
  if (!c.p.includes("Tienes mucha hambre") || c.speaker) return null;
  return say(
    { choice: "react", action: "comer algo", activityKind: "eat", placeId: c.here },
    "Tengo muchísima hambre; primero como algo.",
  );
}

for (const [name, respond] of [
  ["hungry", hungry],
  ["remembered", remembered],
  ["broken-object", brokenObject],
  ["inner-voice", innerVoice],
  ["shelter", shelter],
  ["plan-clash", planClash],
  ["no-mood", noMood],
  ["reply", reply],
  ["spread-rumor", spreadRumor],
  ["confide", confide],
  ["follow-idea", followIdea],
  ["greet", greet],
  ["ponder", ponder],
] as const) {
  registerDecideRule({ name, respond });
}

/**
 * Las reglas de siempre responden con atajos (`react` y `talk`); aquí se traducen al formato del
 * catálogo (`act` con `do_activity` o `say`). Las reglas de acciones nuevas ya responden con `act`.
 */
function asAction(r: Record<string, unknown>): Record<string, unknown> {
  if (r.choice === "react") {
    const { action, activityKind, placeId, spotId } = r;
    return {
      choice: "act",
      action: {
        type: "do_activity",
        activity: action,
        activityKind,
        placeId,
        spotId: spotId ?? null,
      },
    };
  }
  if (r.choice === "talk") return { choice: "act", action: { type: "say", to: r.to, text: r.say } };
  return r;
}

/** Primera regla que responde; si ninguna, sigue con su plan. */
export function mockDecide(req: CompletionRequest): string {
  const c = decideContext(req);
  const hit = decideRules().reduce<DecideReply | null>((r, rule) => r ?? rule.respond(c), null);
  const { response, reason } =
    hit ?? say({ choice: "continue" }, "Sigo con lo que tenía previsto.");
  return JSON.stringify({ ...asAction(response), reason, ...c.intention });
}

registerMockHandler("decide", mockDecide);
