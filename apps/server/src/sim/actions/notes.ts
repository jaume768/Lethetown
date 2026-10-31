/** Notas: colgar en el tablón (`post_note`) y dejar una nota a alguien (`leave_note`). */
import { seedIsMinor, type LeaveNoteAction, type PostNoteAction } from "@lethetown/shared";
import type { z } from "zod";
import { setAction } from "../routines";
import {
  boardPlace,
  BOARD_SPOT,
  newNoteId,
  notesState,
  PRIVATE_NOTE_DAYS,
  PUBLIC_NOTE_DAYS,
  saveNote,
} from "../notes";
import { registerAction } from "./registry";

/** Notas suyas en el tablón como mucho a la vez (no lo llena). */
const MAX_PUBLIC = 2;

registerAction<z.infer<typeof PostNoteAction>>({
  type: "post_note",
  available: ({ ctx, agent }) => agent.state.locationId === boardPlace(ctx),
  check: ({ ctx, agent, now }) => {
    if (agent.state.locationId !== boardPlace(ctx)) return "aquí no hay ningún tablón";
    const mine = [...notesState(ctx).notes.values()].filter(
      (n) => n.kind === "public" && n.authorId === agent.id && n.expiresAt > now,
    );
    return mine.length >= MAX_PUBLIC ? "ya tengo bastantes notas en el tablón" : null;
  },
  describe: () => "colgar una nota en el tablón",
  execute: ({ ctx, agent, now }, a) => {
    saveNote(ctx, {
      id: newNoteId(ctx),
      authorId: agent.id,
      kind: "public",
      toId: null,
      placeId: agent.state.locationId,
      text: a.text,
      createdAt: now,
      expiresAt: now + PUBLIC_NOTE_DAYS * 1440,
      readBy: [],
    });
    agent.state.spotId = BOARD_SPOT;
    setAction(ctx, agent, "escribiendo una nota para el tablón", "work");
    ctx.emit(
      "action",
      agent.id,
      `📌 ${agent.seed.name} cuelga en el tablón: «${a.text}»`,
      [agent.id],
      undefined,
      {
        action: "post_note",
        ok: true,
      },
    );
  },
});

registerAction<z.infer<typeof LeaveNoteAction>>({
  type: "leave_note",
  // Las notas se dejan en casa (la propia, para quien vive contigo, o en la de otro).
  available: ({ ctx, agent }) => ctx.world.place(agent.state.locationId).kind === "home",
  check: ({ ctx, agent }, a) => {
    if (ctx.world.place(agent.state.locationId).kind !== "home") {
      return "las notas se dejan en una casa";
    }
    const to = ctx.agents.get(a.to);
    if (!to || a.to === agent.id) return `no conozco a "${a.to}"`;
    // Protección de menores: nada de notas privadas entre un adulto y un menor.
    if (seedIsMinor(to.seed) !== seedIsMinor(agent.seed)) {
      return `no dejo notas privadas a ${to.seed.name}: mejor se lo digo en persona`;
    }
    return null;
  },
  describe: ({ ctx }, a) => `dejarle una nota a ${ctx.agents.get(a.to)?.seed.name ?? a.to}`,
  execute: ({ ctx, agent, now }, a) => {
    const to = ctx.agents.get(a.to)!;
    saveNote(ctx, {
      id: newNoteId(ctx),
      authorId: agent.id,
      kind: "private",
      toId: a.to,
      placeId: agent.state.locationId,
      text: a.text,
      createdAt: now,
      expiresAt: now + PRIVATE_NOTE_DAYS * 1440,
      readBy: [],
    });
    const place = ctx.world.place(agent.state.locationId).name;
    ctx.emit(
      "action",
      agent.id,
      `✉ ${agent.seed.name} le deja una nota a ${to.seed.name} en ${place}`,
      [agent.id, a.to],
      undefined,
      { action: "leave_note", ok: true },
    );
  },
});
