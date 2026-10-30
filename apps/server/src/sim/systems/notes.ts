/** Sistema de notas: tablón y notas privadas (sim/notes.ts y sim/actions/notes.ts; mock en agent/mock/notes.ts). */
import { Note } from "@lethetown/shared";
import { z } from "zod";
import { loadNotes, notesState, notesTick } from "../notes";
import { registerSystem } from "./registry";
import { REVIEW_MINUTES } from "./types";

registerSystem({
  id: "notes",
  description: "El tablón de la plaza y las notas que se dejan para alguien.",
  actions: ["post_note", "leave_note"],
  snapshot: {
    version: 1,
    schema: z.object({ notes: z.array(Note), seq: z.number().int().nonnegative() }),
    save: (ctx) => {
      const s = notesState(ctx);
      return { notes: structuredClone([...s.notes.values()]), seq: s.seq };
    },
    restore: (ctx, data) => {
      const s = notesState(ctx);
      s.notes.clear();
      for (const n of data.notes) s.notes.set(n.id, n);
      s.seq = data.seq;
    },
  },
  load: async (ctx, { restored, now }) =>
    loadNotes(ctx, restored ? [] : await ctx.noteStore.active(now)),
  tick: { every: REVIEW_MINUTES, run: notesTick },
  retention: { table: "notes", policy: "notes" },
  metrics: (ctx) => {
    const notes = [...notesState(ctx).notes.values()];
    return {
      public: notes.filter((n) => n.kind === "public").length,
      private: notes.filter((n) => n.kind === "private").length,
    };
  },
  admin: (ctx) => [...notesState(ctx).notes.values()],
});
