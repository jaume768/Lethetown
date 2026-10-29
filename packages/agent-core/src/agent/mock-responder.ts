import { WEATHER_SHELTER, type Weather } from "@lethetown/shared";
import type { MockResponder } from "../llm/mock";
import type { CompletionRequest } from "../llm/types";
import { hasStrongRomance } from "./minor-safety";
import { WEATHER_LABEL } from "./prompts";

/**
 * Respuestas deterministas con sentido para los prompts de agent/prompts.ts (y de memory/llm-*.ts).
 * Lee el prompt (lugares, objetos, presentes, lo que se oye) igual que lo haría un LLM,
 * así el modo mock ejercita el mismo camino de parseo que los proveedores reales.
 */
export const agentMockResponder: MockResponder = (req) => {
  const handler = HANDLERS[req.meta.task];
  return handler ? handler(req) : "{}";
};

const HANDLERS: Record<string, (req: CompletionRequest) => string> = {
  plan: mockPlan,
  importance: mockImportance,
  decide: mockDecide,
  consolidate: mockConsolidate,
  gist: mockGist,
  reconsolidate: mockReconsolidate,
  confabulate: mockConfabulate,
  summarize: mockSummarize,
  social: mockSocial,
  chronicle: mockChronicle,
  interview: mockInterview,
  moderate: mockModerate,
  moderate_minor: mockModerateMinor,
};

/** Permite a otros módulos (memoria, crónica, entrevistas) registrar su respuesta mock. */
export function registerMockHandler(
  task: string,
  handler: (req: CompletionRequest) => string,
): void {
  HANDLERS[task] = handler;
}

const GREETINGS = [
  "¡Hola! ¿Qué tal te va el día?",
  "¡Buenas! Hacía tiempo que no te veía.",
  "Hola, ¿has probado el café nuevo?",
  "¡Qué casualidad verte por aquí!",
  "¿Te has enterado de lo que se cuenta por el pueblo?",
  "¡Hombre! Justo estaba pensando en ti.",
  "Buenos días. ¿Vienes a menudo por aquí?",
  "¡Hola! Tienes cara de no haber dormido mucho.",
];
const REPLIES = [
  "Muy bien, gracias. Aquí, disfrutando un rato.",
  "Bastante liado, la verdad. ¿Y tú?",
  "¡Sí! Me encantó. Deberíamos venir juntos.",
  "Pues ya ves, lo de siempre. Me alegro de verte.",
  "No me digas... cuéntamelo todo.",
  "Ay, no sé si debería contártelo, pero bueno...",
  "Ja, ja, qué cosas tienes.",
  "Pues yo he oído otra versión, ¿eh?",
  "Tienes razón, este pueblo nunca cambia.",
  "Eso mismo le dije yo a alguien ayer, y no me hizo caso.",
];
const FOLLOW_UPS = [
  "Oye, ¿y tú qué planes tienes para luego?",
  "¿Sabes si va a llover esta tarde?",
  "¿Te has fijado en lo raro que está todo últimamente?",
  "Por cierto, ¿te acuerdas de lo que pasó la semana pasada?",
  "¿Y la familia, bien?",
];
const RAIN_TALK = [
  "¡Vaya chaparrón! ¿Te has mojado mucho?",
  "Con esta lluvia no apetece nada salir, ¿verdad?",
  "Dicen que cuando llueve el lago se lleva los malos recuerdos.",
];

interface MockPlace {
  id: string;
  kind: string;
  name: string;
  outdoor: boolean;
  objects: { id: string; pose: string; shelter: boolean }[];
}

/** Entradas "- HH:MM actividad (lugar)" de un diario del prompt que empieza con `header`. */
function diary(prompt: string, header: string): { activity: string; placeId: string }[] {
  const block = prompt.split(header)[1] ?? "";
  const out: { activity: string; placeId: string }[] = [];
  for (const line of block.split("\n").slice(1)) {
    const m = /^- \d{2}:\d{2} (.+) \((\S+)\)$/.exec(line);
    if (!m) break;
    out.push({ activity: m[1]!, placeId: m[2]! });
  }
  return out;
}

/** El tiempo del prompt ("Tiempo: lluvia; estás..." o "Tiempo esta mañana: lluvia."). */
function weatherIn(text: string): Weather | null {
  const label = /Tiempo(?: esta mañana)?: ([^;.\n]+)/.exec(text)?.[1]?.trim();
  const found = (Object.entries(WEATHER_LABEL) as [Weather, string][]).find(([, l]) => l === label);
  return found?.[0] ?? null;
}

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

export function parsePlaces(system: string): MockPlace[] {
  return [...system.matchAll(/^- (\S+) \((\w+)(, exterior)?\): (.+?)(?: · objetos: (.+))?$/gm)].map(
    (m) => ({
      id: m[1]!,
      kind: m[2]!,
      outdoor: Boolean(m[3]),
      name: m[4]!,
      objects: [...(m[5] ?? "").matchAll(/(\w+)\[(\w+)(,refugio)?\]/g)].map((o) => ({
        id: o[1]!,
        pose: o[2]!,
        shelter: Boolean(o[3]),
      })),
    }),
  );
}

interface Outing {
  activity: string;
  kind: string;
  pose: string;
}

const OUTING: Record<string, Outing> = {
  cafe: { activity: "tomar un café", kind: "eat", pose: "sit" },
  park: { activity: "pasear y sentarse en el banco", kind: "sit", pose: "sit" },
  shop: { activity: "hacer la compra", kind: "work", pose: "use" },
  home: { activity: "descansar en casa", kind: "idle", pose: "sit" },
  other: { activity: "dar una vuelta", kind: "idle", pose: "stand" },
};

/** Actividades propias de algunos lugares (por id); el resto sale de su tipo. */
const OUTING_BY_ID: Record<string, Outing> = {
  taberna: { activity: "tomar algo en la taberna", kind: "eat", pose: "sit" },
  plaza: { activity: "charlar en la plaza", kind: "sit", pose: "sit" },
  mercado: { activity: "mirar los puestos del mercadillo", kind: "idle", pose: "use" },
  lago: { activity: "pasear junto al lago", kind: "idle", pose: "stand" },
  jardin_recuerdo: { activity: "pasear entre las flores del jardín", kind: "sit", pose: "sit" },
  huerto: { activity: "echar una mano en el huerto", kind: "work", pose: "use" },
  biblioteca: { activity: "leer en la biblioteca", kind: "read", pose: "sit" },
  panaderia: { activity: "comprar pan", kind: "idle", pose: "use" },
  consultorio: { activity: "ir al médico", kind: "sit", pose: "sit" },
  ayuntamiento: { activity: "hacer un trámite en el ayuntamiento", kind: "sit", pose: "sit" },
};

/** Lo que se hace en el lugar de trabajo (por id); si no está, "trabajar". */
const WORK_BY_ID: Record<string, Outing> = {
  cafe_ola: { activity: "atender el café", kind: "work", pose: "use" },
  taberna: { activity: "atender la taberna", kind: "work", pose: "use" },
  panaderia: { activity: "hornear y vender pan", kind: "work", pose: "use" },
  tienda: { activity: "atender el ultramarinos", kind: "work", pose: "use" },
  mercado: { activity: "atender el puesto del mercadillo", kind: "work", pose: "use" },
  biblioteca: { activity: "ordenar libros en la biblioteca", kind: "work", pose: "sit" },
  escuela: { activity: "dar clase", kind: "work", pose: "sit" },
  ayuntamiento: { activity: "despachar en el ayuntamiento", kind: "work", pose: "sit" },
  consultorio: { activity: "pasar consulta", kind: "work", pose: "sit" },
  huerto: { activity: "cuidar el huerto", kind: "work", pose: "use" },
  lago: { activity: "pescar en el lago", kind: "work", pose: "use" },
  plaza: { activity: "tocar la guitarra en la plaza", kind: "idle", pose: "stand" },
};

/** Sitios donde no se va "de paseo": solo quien trabaja o estudia allí (o los menciona). */
const NOT_FOR_OUTINGS = new Set(["escuela", "ayuntamiento", "consultorio"]);

const outingFor = (p: MockPlace): Outing => OUTING_BY_ID[p.id] ?? OUTING[p.kind] ?? OUTING.other!;

type Block = {
  start: string;
  durationMin: number;
  activity: string;
  activityKind: string;
  placeId: string;
  spotId: string | null;
};

function mockPlan(req: CompletionRequest): string {
  const places = parsePlaces(req.system);
  const homeId = /^Tu casa: (\S+)$/m.exec(req.system)?.[1] ?? places[0]?.id ?? "home";
  const workId = /^Tu trabajo o estudios: (\S+)$/m.exec(req.system)?.[1];
  const home = places.find((p) => p.id === homeId);
  const work = places.find((p) => p.id === workId);
  const kitchen = home?.objects.find((o) => o.pose === "use")?.id ?? null;
  const me = hash(/^Eres (.+?),/m.exec(req.system)?.[1] ?? req.system);
  const day = Number(/Es día (\d+)/.exec(req.prompt)?.[1] ?? 0);
  // Lo que recuerda de ayer (texto libre, quizá vago): los lugares que nombra.
  const yesterdayText =
    req.prompt.split("Lo que recuerdas de ayer")[1]?.split("\nNecesidades")[0] ?? "";
  const yesterday = places
    .filter((p) => yesterdayText.includes(p.name))
    .map((p) => ({ placeId: p.id }));
  // Menores de edad que "trabajan" en la escuela: son alumnos.
  const age = Number(/^Eres .+?, (\d+) años/m.exec(req.system)?.[1] ?? 99);
  const student = age < 18;
  // Sitios que su descripción menciona (sus favoritos), aunque no sean de paseo.
  const description = req.system.slice(0, req.system.indexOf("## Lugares"));
  const favorites = places.filter(
    (p) => p.kind !== "home" && (description.includes(p.name) || description.includes(p.id)),
  );
  // Con mal tiempo por la mañana se planea a cubierto (con calor también vale la sombra).
  const morning = weatherIn(req.prompt);
  const needToday = morning ? WEATHER_SHELTER[morning] : null;
  const covered = (p: MockPlace) =>
    !needToday || !p.outdoor || (needToday !== "roof" && p.objects.some((o) => o.shelter));
  const outings = places.filter(
    (p) => p.kind !== "home" && !NOT_FOR_OUTINGS.has(p.id) && covered(p),
  );

  /** Cada franja del día tiene tres lugares de reunión, los mismos para todos ese día. */
  const hubs = (slot: number, pool: MockPlace[]) => {
    const h = hash(`${day}:${slot}`);
    return [0, 1, 2].map((k) => pool[(h + k * 7) % Math.max(1, pool.length)]).filter(Boolean);
  };
  const spotIn = (place: MockPlace, pose: string, skipFirst = false) => {
    const fit = place.objects.filter((o) => o.pose === pose).slice(skipFirst ? 1 : 0);
    return fit.length ? fit[me % fit.length]!.id : null;
  };
  const at = (start: string, durationMin: number, place: MockPlace, o: Outing): Block => ({
    start,
    durationMin,
    activity: o.activity,
    activityKind: o.kind,
    placeId: place.id,
    spotId: spotIn(place, o.pose),
  });
  const outing = (start: string, durationMin: number, slot: number, pool = outings): Block => {
    // Si ayer ya estuvo en alguno de los sitios de reunión, prefiere los otros.
    const all = hubs(slot, pool);
    const notYesterday = all.filter((x) => !yesterday.some((d) => d.placeId === x!.id));
    const options = notYesterday.length ? notYesterday : all;
    const fav = favorites[(me + day) % Math.max(1, favorites.length)];
    const place = fav && (me + slot + day) % 4 === 0 ? fav : options[(me + slot) % options.length];
    if (!place) {
      return {
        start,
        durationMin,
        activity: "estar en casa",
        activityKind: "idle",
        placeId: homeId,
        spotId: null,
      };
    }
    return at(start, durationMin, place, outingFor(place));
  };
  const working = (start: string, durationMin: number): Block => {
    const o = student
      ? { activity: "ir a clase", kind: "read", pose: "sit" }
      : (WORK_BY_ID[work!.id] ?? { activity: "trabajar", kind: "work", pose: "use" });
    // Quien trabaja va a su puesto (el primero que encaja); los alumnos, a un pupitre.
    const own = work!.objects.find((x) => x.pose === o.pose)?.id ?? null;
    return {
      ...at(start, durationMin, work!, o),
      spotId: student ? spotIn(work!, o.pose, true) : own,
    };
  };
  const meal = (start: string, durationMin: number, activity: string): Block => ({
    start,
    durationMin,
    activity,
    activityKind: "eat",
    placeId: homeId,
    spotId: null,
  });
  const breakfast: Block = {
    start: "07:00",
    durationMin: 60,
    activity: "preparar el desayuno",
    activityKind: "cook",
    placeId: homeId,
    spotId: kitchen,
  };
  // Por la tarde se queda sobre todo en cafés y plazas (más conversación).
  const evening = places.filter((p) => (p.kind === "cafe" || p.id === "plaza") && covered(p));
  const parks = places.filter((p) => p.kind === "park" && covered(p));

  let plan: Block[];
  if (work && workId === "taberna") {
    plan = [
      breakfast,
      outing("08:00", 150, 0),
      outing("10:30", 120, 1),
      meal("12:30", 90, "comer"),
      outing("14:00", 120, 2),
      working("16:00", 360),
    ];
  } else if (work) {
    plan = [
      breakfast,
      working("08:00", 270),
      meal("12:30", 90, "comer"),
      student ? working("14:00", 120) : working("14:00", 180),
      student
        ? outing("16:00", 180, 3, parks.length ? parks : outings)
        : outing("17:00", 120, 3, evening.length ? evening : outings),
      meal("19:00", 180, "cenar y descansar"),
    ];
  } else {
    plan = [
      breakfast,
      outing("08:00", 150, 0),
      outing("10:30", 120, 1),
      meal("12:30", 90, "comer"),
      outing("14:00", 180, 2),
      outing("17:00", 120, 3, evening.length ? evening : outings),
      meal("19:00", 180, "cenar y descansar"),
    ];
  }
  return JSON.stringify({ plan });
}

function mockImportance(req: CompletionRequest): string {
  const lines = [...req.prompt.matchAll(/^\d+\. (.+)$/gm)].map((m) => m[1]!);
  const ratings = lines.map((line) => {
    const speech = /me dijo|Oí a/.test(line);
    const thought = line.startsWith("Pensé:");
    const positive = /alegr|encant|bien|hola|buenas|guay|ja, ja/i.test(line);
    const negative =
      /liado|triste|mal|rota|roto|llueve|lluvia|tormenta|niev|calor|averiad|estropead|miedo/i.test(
        line,
      );
    return {
      importance: thought ? 7 : speech ? 4 + (hash(line) % 3) : negative ? 5 : 2,
      valence: positive ? 0.4 : negative ? -0.3 : 0,
    };
  });
  return JSON.stringify({ ratings });
}

function mockDecide(req: CompletionRequest): string {
  const h = hash(req.prompt);
  const p = req.prompt;
  const places = parsePlaces(req.system);
  const here = /^Es .+?\. Estás en (\S+) haciendo/m.exec(p)?.[1] ?? "";
  const herePlace = places.find((x) => x.id === here);
  const weather = weatherIn(p);
  const need = weather ? WEATHER_SHELTER[weather] : null;
  const exposed = Boolean(need) && !/Tiempo: [^\n]*; estás (bajo techo|a cubierto)/.test(p);
  // Aviso de la simulación: lo siguiente que tenía previsto es al aire libre.
  const planOutside = Boolean(need) && /es al aire libre, en /.test(p);
  const raining = weather === "rain" || weather === "storm";
  const presentLine = /^PRESENTES: (.+)$/m.exec(p)?.[1] ?? "nadie";
  const present =
    presentLine === "nadie" ? [] : presentLine.split("; ").map((x) => x.slice(0, x.indexOf("=")));
  const heard = [...p.matchAll(/^(\S+)=[^:\n]+: "(.+)"$/gm)].map((m) => ({
    from: m[1]!,
    text: m[2]!,
  }));
  const broken = /^OBJETOS: (.+)$/m
    .exec(p)?.[1]
    ?.match(/(\w+): (rot[oa]|estropead[oa]|averiad[oa])/);
  const thought = /^- Pensé: (.+)$/m.exec(p)?.[1];
  // Rumor: algo oído a escondidas que no sea ya un rumor (evita "oí que oí que..."), ni un
  // trozo de un saludo de cortesía, ni algo que ya haya contado.
  const small = [...GREETINGS, ...REPLIES, ...FOLLOW_UPS];
  const rumor = [...p.matchAll(/^- Oí a (.+?) decirle a .+? algo como: "(.+)"$/gm)].find((m) => {
    const fragment = m[2]!.replace(/…/g, "").trim();
    return (
      !/Oí a|Sabes|cuento una cosa/.test(fragment) &&
      !small.some((s) => s.includes(fragment)) &&
      !p.includes(`decir "${m[2]}"`)
    );
  });
  // Confidencia: algo que recuerda sobre otra persona (así viajan los secretos del pueblo).
  const memories = (p.split("Memoria de trabajo:")[1] ?? "")
    .split("\n")
    .map((l) => /^- (.+)$/.exec(l)?.[1])
    .filter((l): l is string => Boolean(l))
    .filter((l) => !/^(Le dije|Pensé|Oí a|Noté|Vi a|\()/.test(l) && !/me dijo|⟦/.test(l))
    // Ni los avisos del tiempo ("Empezó a llover", "...es al aire libre").
    .filter((l) => !/al aire libre|^(Empezó|Salió|Se nubló|Estalló|Bajó|Se levantó)/.test(l))
    .filter((l) => /\s[A-ZÁÉÍÓÚ][a-záéíóúñ]{2,}/.test(l) && !p.includes(`cosa? ${l}`));
  const plan = /^Tu plan ahora: (.+) en \S+ \(desde/m.exec(p)?.[1];

  const reply = (o: Record<string, unknown>, reason: string) => JSON.stringify({ ...o, reason });
  // Voz interior recién recibida (sección VOZ INTERIOR): casi siempre se le hace caso.
  const voice = /^VOZ INTERIOR[^\n]*\n- ⟦(.+)⟧$/m.exec(p)?.[1];
  // Diario de hoy: lo que ya ha hecho, para no repetirlo al cambiar de planes.
  const done = diary(p, "HOY YA HAS HECHO:");
  const visited = (id: string) => done.some((d) => d.placeId === id);
  const did = (activity: string) => done.some((d) => d.activity.startsWith(activity));

  // Un objeto roto: va a mirarlo (si no lo ha mirado ya hoy).
  if (broken && h % 2 === 0 && !did(`mirar qué le pasa a ${broken[1]}`)) {
    return reply(
      {
        choice: "react",
        action: `mirar qué le pasa a ${broken[1]}`,
        activityKind: "work",
        placeId: here,
      },
      `Se ha estropeado ${broken[1]} y no puedo dejarlo así.`,
    );
  }
  const speaker = heard[0];
  if (voice && h % 3 !== 0) {
    const idea = places.find((x) => x.id !== here && voice.includes(x.name) && !visited(x.id));
    if (idea) {
      const o = outingFor(idea);
      return reply(
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
    const listener = present[h % Math.max(1, present.length)];
    if (listener && h % 2 === 0) {
      return reply(
        { choice: "talk", to: listener, say: `¿Sabes qué estaba pensando? ${voice}` },
        "Le doy vueltas a una idea y necesito contársela a alguien.",
      );
    }
    return reply(
      {
        choice: "react",
        action: `pensar en ello: ${voice.slice(0, 40)}`,
        activityKind: "idle",
        placeId: here,
      },
      "No puedo quitármelo de la cabeza; necesito pararme a pensarlo.",
    );
  }
  if (voice) {
    return reply({ choice: "continue" }, "Es una idea curiosa, pero ahora tengo cosas que hacer.");
  }
  // Mal tiempo: si le pilla fuera (o su plan es al aire libre), busca dónde resguardarse.
  if (need && (exposed || planOutside) && h % 2 === 0 && (!speaker || (exposed && h % 3 === 0))) {
    const why = `Con este tiempo (${WEATHER_LABEL[weather!]}) no se puede estar fuera.`;
    if (!exposed) {
      return reply(
        {
          choice: "react",
          action: STAY_IN[weather!] ?? "quedarse a cubierto",
          activityKind: "idle",
          placeId: here,
        },
        `${why} Mejor me quedo donde estoy.`,
      );
    }
    const cover = need !== "roof" ? herePlace?.objects.find((o) => o.shelter) : undefined;
    if (cover && h % 3 !== 0) {
      return reply(
        {
          choice: "react",
          action: SHELTER_ACTION[need](cover.id.replace(/_/g, " ")),
          activityKind: "idle",
          placeId: here,
          spotId: cover.id,
        },
        `${why} Aquí al lado hay donde ponerse a cubierto.`,
      );
    }
    const home = /^Tu casa: (\S+)$/m.exec(req.system)?.[1];
    const covered = places.filter(
      (x) => !x.outdoor && (x.kind === "cafe" || x.id === "biblioteca"),
    );
    // Mejor un sitio en el que no haya estado hoy.
    const fresh = covered.filter((x) => !visited(x.id));
    const indoor = fresh.length ? fresh : covered;
    const dest =
      h % 3 === 0 && home
        ? places.find((x) => x.id === home)
        : indoor[h % Math.max(1, indoor.length)];
    if (dest) {
      return reply(
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
  }
  // Aviso de la simulación: su plan dice que toque irse, pero está hablando con alguien.
  const clash = /Según tu plan ahora toca (.+) en (.+?), pero estás hablando con (.+)\./.exec(p);
  const partner = /^CONVERSACIÓN: (\S+)$/m.exec(p)?.[1];
  const settled = /te dejo, que me toca|haciendo: seguir charlando/.test(p);
  if (clash && partner && present.includes(partner) && !settled) {
    const [, activity, placeName, name] = clash;
    // Si hoy ya se quedó charlando con esta persona, esta vez se despide.
    if (h % 3 === 0 && !did(`seguir charlando con ${name}`)) {
      return reply(
        {
          choice: "react",
          action: `seguir charlando con ${name}`,
          activityKind: "talk",
          placeId: here,
        },
        `La charla con ${name} me apetece más; ${activity} puede esperar un poco.`,
      );
    }
    if (h % 3 === 1) {
      return reply(
        {
          choice: "talk",
          to: partner,
          say: `Bueno, te dejo, que me toca ${activity}. ¡Luego seguimos!`,
        },
        `Tengo que ir a ${placeName}, pero no quiero dejar a ${name} con la palabra en la boca.`,
      );
    }
    return reply({ choice: "continue" }, `Se me hace tarde para ${activity}; me voy ya.`);
  }
  if (speaker && present.includes(speaker.from) && h % 3 !== 0) {
    const asked = speaker.text.trim().endsWith("?");
    const say =
      !asked && h % 4 === 1
        ? FOLLOW_UPS[h % FOLLOW_UPS.length]
        : raining && h % 5 === 0
          ? RAIN_TALK[h % RAIN_TALK.length]
          : REPLIES[h % REPLIES.length];
    return reply({ choice: "talk", to: speaker.from, say }, "Me han hablado y quiero contestar.");
  }
  const someone = present[h % Math.max(1, present.length)];
  if (!speaker && someone && rumor && h % 4 === 0) {
    return reply(
      { choice: "talk", to: someone, say: `¿Sabes? Oí a ${rumor[1]} decir "${rumor[2]}".` },
      "Oí algo y no puedo guardármelo.",
    );
  }
  const someoneName = new RegExp(`${someone}=(\\S+)`).exec(presentLine)?.[1] ?? "";
  const secret = memories.find((l) => !someoneName || !l.includes(someoneName));
  if (!speaker && someone && secret && h % 3 === 0) {
    return reply(
      { choice: "talk", to: someone, say: `¿Te cuento una cosa? ${secret}` },
      "Me fío de esta persona y quiero contárselo.",
    );
  }
  // Una idea de la voz interior que nombra un lugar: ir allí.
  // Solo de vez en cuando y no a la hora de comer o cenar (la idea sigue en la memoria de trabajo).
  const idea =
    thought && places.find((x) => x.id !== here && thought.includes(x.name) && !visited(x.id));
  const eating = /haciendo: (comer|cenar)/.test(p);
  if (idea && !speaker && !eating && h % 4 === 0) {
    const o = outingFor(idea);
    return reply(
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
  if (!speaker && someone && h % 2 === 0) {
    const contextual = [
      ...GREETINGS,
      ...(herePlace ? [`¡Qué bien se está hoy en ${herePlace.name}!`] : []),
      ...(raining ? RAIN_TALK : []),
      ...(plan ? [`Yo vengo de paso, que luego toca ${plan}.`] : []),
    ];
    return reply(
      { choice: "talk", to: someone, say: contextual[h % contextual.length] },
      "Hay alguien conocido y me apetece charlar.",
    );
  }
  if (thought && !speaker && h % 3 === 0 && !did("pensar en ello")) {
    return reply(
      {
        choice: "react",
        action: `pensar en ello: ${thought.slice(0, 40)}`,
        activityKind: "idle",
        placeId: here,
      },
      "Me he quedado pensando en algo.",
    );
  }
  return reply({ choice: "continue" }, "Sigo con lo que tenía previsto.");
}

/** Recuerdos numerados ("1. texto") de un prompt. */
function numbered(prompt: string): string[] {
  return [...prompt.matchAll(/^\d+\. (.+)$/gm)].map((m) => m[1]!);
}

function mockConsolidate(req: CompletionRequest): string {
  const lines = numbered(req.prompt);
  const people = [
    ...(/^Personas que conoces: (.+)$/m.exec(req.prompt)?.[1] ?? "").matchAll(/(\w+)=([^,]+)/g),
  ];
  const mentioned = people.filter(([, , name]) =>
    lines.some((l) => l.includes(name!.split(" ")[0]!)),
  );
  const talks = lines
    .map((l, i) => ({ l, n: i + 1 }))
    .filter(({ l }) => /dijo|Le dije|Oí a/.test(l));
  const insights = [];
  if (talks.length) {
    insights.push({
      text: `Hoy he hablado bastante con la gente del pueblo; me sienta bien tener compañía.`,
      cites: talks.slice(0, 3).map((t) => t.n),
      importance: 6,
      valence: 0.3,
    });
  }
  if (lines.length) {
    insights.push({
      text: `Mi día gira alrededor de mis rutinas: ${lines[0]!.slice(0, 60)}`,
      cites: [1],
      importance: 5,
      valence: 0.1,
    });
  }
  return JSON.stringify({
    questions: ["¿Con quién me siento más a gusto en el pueblo?"],
    insights,
    facts: talks.length
      ? [{ text: `Suelo encontrarme con gente en el café.`, cites: [talks[0]!.n] }]
      : [],
    people: mentioned.map(([, id]) => ({
      id,
      summary: "Alguien con quien hablo a menudo.",
      affinityDelta: 0.05,
      trustDelta: 0.02,
    })),
  });
}

function mockGist(req: CompletionRequest): string {
  const text = /Recuerdo: "(.+)"$/m.exec(req.prompt)?.[1] ?? "algo";
  const words = text
    .replace(/"[^"]*"/g, "algo")
    .split(/\s+/)
    .slice(0, 5)
    .join(" ");
  return JSON.stringify({ gist: `${words}…` });
}

function mockReconsolidate(req: CompletionRequest): string {
  const text = /Estás recordando esto: "(.+)"$/m.exec(req.prompt)?.[1] ?? "";
  const mood = /Tu ánimo ahora: ([^.]+)\./.exec(req.prompt)?.[1] ?? "neutral";
  const sad = /apagado|abatido|triste|preocupado|irritable|nervioso/.test(mood);
  const happy = /contento|animado|eufórico|relajado|tranquilo/.test(mood);
  const suffix = sad
    ? " (aunque ahora me parece más triste de lo que fue)"
    : happy
      ? " (y fue muy agradable)"
      : " (más o menos)";
  const already = /\((aunque|y fue|más o menos)/.test(text);
  return JSON.stringify({
    text: already ? text : `${text}${suffix}`,
    valence: sad ? -0.2 : happy ? 0.3 : 0,
  });
}

/** Detalles plausibles con los que el mock "rellena" un recuerdo vago. */
const INVENTED = [
  "y recuerdo que estaba lloviendo",
  "y que alguien se rió al fondo",
  "y que olía a pan recién hecho",
  "y que fue justo después de comer",
  "y que llevaba una bufanda roja",
];

function mockConfabulate(req: CompletionRequest): string {
  const vague = /apenas te acuerdas: "(.+)"$/m.exec(req.prompt)?.[1] ?? "algo";
  const base = vague.replace(/^\(vagamente\) /, "").replace(/…$/, "");
  return JSON.stringify({
    text: `${base}, ${INVENTED[hash(vague) % INVENTED.length]}`,
    valence: 0,
  });
}

function mockSummarize(req: CompletionRequest): string {
  const lines = numbered(req.prompt);
  return JSON.stringify({
    summary: `Durante un tiempo pasaron cosas parecidas: ${lines[0]?.slice(0, 50) ?? "rutinas"} (y ${lines.length - 1} más).`,
  });
}

function mockSocial(req: CompletionRequest): string {
  const name = /Acabas de hablar con ([^(]+) \(/.exec(req.prompt)?.[1]?.trim() ?? "esa persona";
  const negative = /liado|mal|triste/i.test(req.prompt);
  return JSON.stringify({
    summary: negative ? `${name} parece agobiado últimamente.` : `${name} es agradable de tratar.`,
    affinityDelta: negative ? -0.02 : 0.06,
    trustDelta: 0.02,
  });
}

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

export function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
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
