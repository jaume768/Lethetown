/** Almacén de notas, en RAM o en Postgres, siempre por mundo. */
import { Note } from "@lethetown/shared";
import { and, desc, eq, gt } from "drizzle-orm";
import type { Db } from "./client";
import { notes } from "./schema";

export interface NoteStore {
  upsert(note: Note): Promise<void>;
  /** Las que no han caducado, de la más nueva a la más vieja. */
  active(now: number, limit?: number): Promise<Note[]>;
}

export class InMemoryNoteStore implements NoteStore {
  private readonly byId = new Map<string, Note>();

  async upsert(note: Note) {
    this.byId.set(note.id, structuredClone(note));
  }

  async active(now: number, limit = 100) {
    return [...this.byId.values()]
      .filter((n) => n.expiresAt > now)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit)
      .map((n) => structuredClone(n));
  }
}

type Row = typeof notes.$inferSelect;
const toNote = ({ worldId: _w, ...r }: Row): Note => Note.parse(r);

export class PgNoteStore implements NoteStore {
  constructor(
    private readonly db: Db,
    readonly worldId: string,
  ) {}

  async upsert(note: Note) {
    const { id: _id, ...set } = note;
    await this.db
      .insert(notes)
      .values({ ...note, worldId: this.worldId })
      .onConflictDoUpdate({ target: [notes.worldId, notes.id], set });
  }

  async active(now: number, limit = 100) {
    const rows = await this.db
      .select()
      .from(notes)
      .where(and(eq(notes.worldId, this.worldId), gt(notes.expiresAt, now)))
      .orderBy(desc(notes.createdAt))
      .limit(limit);
    return rows.map(toNote);
  }
}
