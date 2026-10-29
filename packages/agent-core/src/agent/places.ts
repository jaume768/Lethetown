/**
 * Lugares que conoce un agente. No todo el mundo conoce todo el pueblo: quien vive aquí de
 * siempre conoce lo público, su casa, su trabajo y las casas de su gente; quien acaba de llegar,
 * solo lo que diga su semilla. El resto se descubre viéndolo, explorando o porque te lo cuentan.
 */
import type { AgentSeed, KnownPlaceSource, Place } from "@lethetown/shared";
import type { Agent } from "./agent";
import { placeLine } from "./prompts";

/** Familiaridad mínima (semilla) para saber de partida dónde vive alguien. */
const KNOWS_HOME_FAMILIARITY = 0.5;

/**
 * Lo que conoce de partida quien no trae `knownPlaces`: todo lo que no es una casa, la suya, su
 * trabajo y las casas de quienes conoce bien (relaciones de la semilla).
 */
export function defaultKnownPlaces(seed: AgentSeed, seeds: AgentSeed[], places: Place[]): string[] {
  const homes = new Map(seeds.map((s) => [s.id, s.homeId]));
  const friends = new Set(
    seed.relationships
      .filter((r) => r.bond || r.familiarity >= KNOWS_HOME_FAMILIARITY)
      .map((r) => homes.get(r.with))
      .filter((h): h is string => Boolean(h)),
  );
  return places
    .filter((p) => p.kind !== "home" || p.id === seed.homeId || friends.has(p.id))
    .map((p) => p.id);
}

/** Lugares de la semilla (sin `knownPlaces`, todos); siempre su casa y su trabajo. */
export function seedKnownPlaces(seed: AgentSeed, places: Place[]): Place[] {
  const ids = new Set(seed.knownPlaces ?? places.map((p) => p.id));
  ids.add(seed.homeId);
  if (seed.workId) ids.add(seed.workId);
  return places.filter((p) => ids.has(p.id));
}

/** ¿Lo conoce? */
export function knows(a: Agent, placeId: string): boolean {
  return placeId in a.mind.knownPlaces;
}

/** Aprende un lugar; true si no lo conocía. */
export function learnPlace(
  a: Agent,
  placeId: string,
  source: KnownPlaceSource,
  now: number,
  toldBy: string | null = null,
): boolean {
  if (knows(a, placeId) || !a.deps.places.some((p) => p.id === placeId)) return false;
  a.mind.knownPlaces[placeId] = { source, at: now, toldBy };
  return true;
}

/**
 * Líneas de los lugares que ha descubierto después de empezar (no están en el prompt fijo de
 * identidad, que no cambia para no romper el caching).
 */
export function discoveredLines(a: Agent): string[] {
  return a.deps.places
    .filter((p) => a.mind.knownPlaces[p.id] && a.mind.knownPlaces[p.id]!.source !== "seed")
    .map(placeLine);
}
