import type { SimContext } from "./context";
import { injectThought, setSpotState, setWeather } from "./intervention";

/**
 * Modo demostración (SIM_DEMO=on): cada cierto tiempo de juego pasa algo en el pueblo
 * (llueve o sale el sol, se estropea un objeto y luego se arregla, a alguien se le ocurre ir a
 * un sitio) para ver las reacciones de los agentes sin un director humano. Usa las mismas
 * funciones de intervención que el modo Director y el Rng inyectado (reproducible con SIM_SEED).
 */

/** Estados de avería que el demo pone (y luego arregla), en femenino y masculino. */
const BROKEN = ["averiada", "averiado"];
const REPAIRED = ["recién arreglada", "recién arreglado"];

/** Ocurrencias de la voz interior; `{lugar}` se sustituye por el nombre de un lugar. */
const IDEAS = [
  "Me apetece ir a {lugar} a ver quién hay.",
  "Creo que en {lugar} me espera alguien.",
  "Hace mucho que no paso por {lugar}.",
  "Tengo el presentimiento de que hoy pasará algo en {lugar}.",
  "Hoy tengo ganas de hablar con alguien nuevo.",
  "No dejo de pensar en lo que oí ayer.",
  "Siento que se me olvida algo importante.",
];

const DAY_START = 8 * 60;
const DAY_END = 21 * 60;

export function startDemo(ctx: SimContext, everyMinutes: number): void {
  const rng = ctx.deps.rng;
  const pick = <T>(items: T[]): T | undefined => items[Math.floor(rng() * items.length)];

  const step = () => {
    const minute = ctx.clock.now() % 1440;
    if (minute >= DAY_START && minute < DAY_END) {
      const roll = rng();
      if (roll < 0.25) weather();
      else if (roll < 0.55) objects();
      else thought();
    }
    ctx.clock.schedule(ctx.clock.now() + everyMinutes * (0.5 + rng()), step);
  };

  const weather = () => {
    const now = ctx.world.weather;
    setWeather(ctx, now === "rain" ? "sunny" : rng() < 0.6 ? "rain" : "cloudy");
  };

  /** Arregla lo que estropeó antes o, si no hay nada roto, estropea algo de un lugar público. */
  const objects = () => {
    const spots = ctx.world.places.filter((p) => p.kind !== "home").flatMap((p) => p.objects);
    const gender = (name: string) => (name.endsWith("a") ? 0 : 1);
    const broken = spots.find((s) => BROKEN.includes(s.state));
    if (broken) return setSpotState(ctx, broken.id, REPAIRED[gender(broken.name)]!);
    const target = pick(spots.filter((s) => s.pose === "use"));
    if (target) setSpotState(ctx, target.id, BROKEN[gender(target.name)]!);
  };

  const thought = () => {
    const awake = [...ctx.agents.values()].filter((a) => a.state.activityKind !== "sleep");
    const agent = pick(awake);
    const place = pick(ctx.world.places.filter((p) => p.kind !== "home"));
    const idea = pick(IDEAS);
    if (!agent || !place || !idea) return;
    injectThought(ctx, agent.id, idea.replace("{lugar}", place.name));
  };

  ctx.clock.schedule(ctx.clock.now() + everyMinutes, step);
}
