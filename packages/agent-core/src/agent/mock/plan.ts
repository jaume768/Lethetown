import { WEATHER_SHELTER } from "@lethetown/shared";
import type { CompletionRequest } from "../../llm/types";
import {
  NOT_FOR_OUTINGS,
  WORK_BY_ID,
  hash,
  outingFor,
  parsePlaces,
  weatherIn,
  type MockPlace,
  type Outing,
} from "./context";
import { registerMockHandler } from "./registry";

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

registerMockHandler("plan", mockPlan);
