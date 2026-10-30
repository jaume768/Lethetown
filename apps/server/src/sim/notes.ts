/**
 * Notas: el tablón de la plaza (públicas) y las notas dejadas para alguien (privadas). Se leen al
 * estar en el sitio: entran como percepción (y se recuerdan), con el texto delimitado como dato
 * (⟦…⟧), porque lo escribió otro agente. Caducan; viven en el runtime (instantánea) y en `notes`.
 */
import { untrusted, type Agent } from "@lethetown/agent-core";
import type { Note } from "@lethetown/shared";
import type { SimContext } from "./context";

/** Lugar del tablón (donde está el spot `tablon`). */
export const BOARD_SPOT = "tablon";
/** Días de juego que dura una nota del tablón y una privada. */
export const PUBLIC_NOTE_DAYS = 3;
export const PRIVATE_NOTE_DAYS = 2;
/** Notas del tablón que lee como mucho de una vez (las más nuevas). */
const READ_AT_ONCE = 3;

export const boardPlace = (ctx: SimContext) => ctx.world.spot(BOARD_SPOT)?.placeId ?? null;

/** Estado de las notas: las vivas (tablón y privadas) y su contador ("n1"…). */
export interface NotesState {
  notes: Map<string, Note>;
  seq: number;
}

export const notesState = (ctx: SimContext) =>
  ctx.state<NotesState>("notes", () => ({ notes: new Map(), seq: 0 }));

export function newNoteId(ctx: SimContext): string {
  return `n${++notesState(ctx).seq}`;
}

export function saveNote(ctx: SimContext, note: Note): void {
  notesState(ctx).notes.set(note.id, note);
  const write = ctx.noteStore
    .upsert(structuredClone(note))
    .catch((e: unknown) => ctx.emit("system", null, `⚠ No se pudo guardar la nota: ${String(e)}`));
  ctx.deps.track?.(write);
}

/** Al estar en un sitio: lee las notas de aquí que no ha leído (las suyas privadas y el tablón). */
export function readNotes(ctx: SimContext, agent: Agent): void {
  const here = agent.state.locationId;
  const now = ctx.clock.now();
  const unread = [...notesState(ctx).notes.values()]
    .filter(
      (n) =>
        n.placeId === here &&
        n.expiresAt > now &&
        n.authorId !== agent.id &&
        !n.readBy.includes(agent.id) &&
        (n.kind === "public" || n.toId === agent.id),
    )
    .sort((a, b) => b.createdAt - a.createdAt);
  const board = unread.filter((n) => n.kind === "public").slice(0, READ_AT_ONCE);
  const mine = unread.filter((n) => n.kind === "private");
  for (const n of [...mine, ...board]) {
    const author = ctx.agents.get(n.authorId)?.seed.name ?? n.authorId;
    ctx.rt(agent.id).pending.push({
      kind: "world",
      text:
        n.kind === "private"
          ? `${author} me dejó una nota: ${untrusted(n.text)}`
          : `En el tablón hay una nota de ${author}: ${untrusted(n.text)}`,
      placeId: here,
    });
    n.readBy.push(agent.id);
    saveNote(ctx, n);
  }
}

/** Quita del runtime las notas caducadas (en la tabla quedan hasta la retención). */
export function notesTick(ctx: SimContext, now: number): void {
  const notes = notesState(ctx).notes;
  for (const [id, n] of [...notes]) if (n.expiresAt <= now) notes.delete(id);
}

/** Notas al arrancar sin instantánea (las vivas guardadas). */
export function loadNotes(ctx: SimContext, stored: Note[]): void {
  const state = notesState(ctx);
  if (state.notes.size) return;
  for (const n of stored) state.notes.set(n.id, n);
  state.seq = Math.max(state.seq, ...stored.map((n) => Number(n.id.slice(1)) || 0));
}
