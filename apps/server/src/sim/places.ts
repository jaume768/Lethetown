/**
 * Conocer el pueblo: cada agente conoce solo algunos lugares (ver agent-core/agent/places.ts) y
 * descubre el resto al pasar cerca, explorando (acción `explore`) o porque alguien de confianza
 * se lo nombra. Cada descubrimiento se percibe (y se recuerda), sale en el log y se guarda.
 */
import type { Agent } from "@lethetown/agent-core";
import type { KnownPlaceSource, Place, TilePoint, TileRect } from "@lethetown/shared";
import type { SimContext } from "./context";

/** Radio por defecto (baldosas) en que se ven los lugares al pasar. */
export const DEFAULT_DISCOVERY_RADIUS = 4;
/** Confianza mínima en quien te lo cuenta para creerte dónde está un sitio. */
const TOLD_MIN_TRUST = 0.35;
/** Con un chismoso, hace falta más confianza. */
const TOLD_MIN_TRUST_GOSSIP = 0.5;

/** Distancia (baldosas, Chebyshev) de un punto a un rectángulo (0 si está dentro). */
function distanceTo(p: TilePoint, r: TileRect): number {
  const dx = Math.max(r.x - p.x, 0, p.x - (r.x + r.w - 1));
  const dy = Math.max(r.y - p.y, 0, p.y - (r.y + r.h - 1));
  return Math.max(dx, dy);
}

/**
 * Aprende un lugar con todo lo que conlleva: percepción (que se recuerda), evento en el log y
 * escritura en el almacén. Devuelve true si no lo conocía.
 */
export function learn(
  ctx: SimContext,
  agent: Agent,
  place: Place,
  source: KnownPlaceSource,
  now: number,
  toldBy?: Agent,
): boolean {
  if (!agent.learnPlace(place.id, source, now, toldBy?.id)) return false;
  const write = ctx.knownPlaces
    .addMany(agent.id, [{ placeId: place.id, source, at: now, toldBy: toldBy?.id ?? null }])
    .catch((e: unknown) => ctx.emit("system", null, `⚠ No se pudo guardar el lugar: ${String(e)}`));
  ctx.deps.track?.(write);
  // Una casa vista al pasar se aprende sin más (no es una novedad que comentar ni recordar).
  if (source === "seen" && place.kind === "home") return true;
  const text = toldBy
    ? `${toldBy.seed.name} me habló de ${place.name} (${place.id}); ahora sé dónde está.`
    : `Descubrí ${place.name} (${place.id}), un sitio que no conocía.`;
  ctx.rt(agent.id).pending.push({ kind: "world", text, placeId: place.id });
  if (source !== "told") {
    ctx.emit(
      "action",
      agent.id,
      `🧭 ${agent.seed.name} descubre ${place.name}`,
      [agent.id],
      undefined,
      { action: "discover", ok: true },
    );
  }
  return true;
}

/** Descubre los lugares que hay cerca de un camino recorrido (y el destino). */
export function discoverAlong(
  ctx: SimContext,
  agent: Agent,
  path: TilePoint[],
  destId: string,
  now: number,
  source: KnownPlaceSource = "seen",
): Place[] {
  const radius = ctx.deps.discoveryRadius ?? DEFAULT_DISCOVERY_RADIUS;
  const found: Place[] = [];
  for (const place of ctx.world.places) {
    if (agent.knows(place.id)) continue;
    const near = place.id === destId || path.some((p) => distanceTo(p, place.area) <= radius);
    if (near && learn(ctx, agent, place, source, now)) found.push(place);
  }
  return found;
}

/** Centro de un lugar (en baldosas). */
const centerOf = (p: Place): TilePoint => ({
  x: p.area.x + p.area.w / 2,
  y: p.area.y + p.area.h / 2,
});

/** ¿Está en esa zona respecto a un punto? (norte = arriba en el mapa). */
function inZone(from: TilePoint, to: TilePoint, zone: string | null | undefined): boolean {
  if (!zone) return true;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (zone === "norte") return dy < 0;
  if (zone === "sur") return dy > 0;
  if (zone === "este") return dx > 0;
  return dx < 0;
}

/**
 * El lugar desconocido más cercano (en la zona pedida si la hay; si no queda nada allí, en
 * cualquiera). Los lugares públicos antes que las casas.
 */
export function nextToExplore(
  ctx: SimContext,
  agent: Agent,
  zone?: string | null,
  /** Solo los que cumplan esto (p. ej. abiertos y que no sean casas). */
  accept: (p: Place) => boolean = () => true,
): Place | undefined {
  const here = agent.state.tile;
  const unknown = ctx.world.places.filter((p) => !agent.knows(p.id) && accept(p));
  const dist = (p: Place) => {
    const c = centerOf(p);
    return Math.abs(c.x - here.x) + Math.abs(c.y - here.y) + (p.kind === "home" ? 1000 : 0);
  };
  const byDistance = [...unknown].sort((a, b) => dist(a) - dist(b) || a.id.localeCompare(b.id));
  return byDistance.find((p) => inZone(here, centerOf(p), zone)) ?? byDistance[0];
}

/** Sin tildes y en minúsculas (para reconocer nombres de lugares en lo que se dice). */
const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

/**
 * Lo que se dice en una conversación: si nombra un lugar que quien escucha no conoce, lo aprende
 * si se fía de quien habla (los chismosos necesitan más confianza).
 */
export async function learnFromSpeech(
  ctx: SimContext,
  listener: Agent,
  speaker: Agent,
  text: string,
  now: number,
): Promise<Place[]> {
  const said = fold(text);
  const mentioned = ctx.world.places.filter(
    (p) => !listener.knows(p.id) && (said.includes(fold(p.name)) || said.includes(p.id)),
  );
  if (!mentioned.length) return [];
  const trust = (await ctx.deps.social.get(listener.id, speaker.id))?.trust ?? 0.5;
  const gossip = speaker.seed.traits.some((t) => /chism|cotill/i.test(t));
  if (trust < (gossip ? TOLD_MIN_TRUST_GOSSIP : TOLD_MIN_TRUST)) return [];
  return mentioned.filter((p) => learn(ctx, listener, p, "told", now, speaker));
}

/** Guarda lo que conoce cada agente (al arrancar: lo de la semilla o lo restaurado). */
export async function syncKnownPlaces(ctx: SimContext): Promise<void> {
  for (const agent of ctx.agents.values()) {
    await ctx.knownPlaces.replace(
      agent.id,
      Object.entries(agent.mind.knownPlaces).map(([placeId, k]) => ({ placeId, ...k })),
    );
  }
}
