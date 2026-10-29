/** Filtros de los paneles (lógica pura, con tests). */
import type { RelationshipEntry, RelationshipType, ScoredMemoryView } from "@lethetown/shared";

/** Minúsculas y sin tildes, para buscar por nombre. */
export function fold(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

/** Jardín de recuerdos: activos, sin olvidados (salvo que se pidan), por persona y lugar. */
export function filterMemories(
  memories: ScoredMemoryView[],
  f: { person: string; place: string; showForgotten: boolean },
): ScoredMemoryView[] {
  return memories.filter(
    ({ memory: m, scores }) =>
      (f.showForgotten || scores.clarity !== "forgotten") &&
      m.status === "active" &&
      (!f.person || m.people.includes(f.person)) &&
      (!f.place || m.placeId === f.place),
  );
}

/** Relaciones: por tipo y por nombre (sin distinguir mayúsculas ni tildes). */
export function filterRelationships(
  items: RelationshipEntry[],
  query: string,
  type: RelationshipType | "",
): RelationshipEntry[] {
  const needle = fold(query.trim());
  return items.filter(
    (i) =>
      (!type || i.profile.relationshipType === type) && (!needle || fold(i.name).includes(needle)),
  );
}

/** Personas por nombre (las que aún no conoce, p. ej.). */
export function filterByName<T extends { name: string }>(people: T[], query: string): T[] {
  const needle = fold(query.trim());
  return people.filter((p) => !needle || fold(p.name).includes(needle));
}
