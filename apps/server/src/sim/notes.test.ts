/** Notas: tablón público, notas privadas, lectura al pasar, caducidad y menores. */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { bootstrap, type App } from "../bootstrap";
import { loadConfig } from "../config";
import { runAction } from "./actions";
import type { SimContext } from "./context";
import { notesState, notesTick, readNotes } from "./notes";

let app: App;
let ctx: SimContext;

beforeAll(async () => {
  app = await bootstrap(
    loadConfig({ LLM_PROVIDER: "mock", EMBEDDINGS: "hash", DATABASE_URL: "", SIM_SEED: "7" }),
    () => {},
  );
  ctx = (app.defaultWorld.sim as unknown as { ctx: SimContext }).ctx;
});
afterAll(() => app.close());

const agent = (id: string) => ctx.agents.get(id)!;
const now = () => ctx.clock.now();
const act = (id: string, action: Parameters<typeof runAction>[1]) =>
  runAction({ ctx, agent: agent(id), now: now() }, action);
const texts = (id: string) => ctx.rt(id).pending.flatMap((p) => ("text" in p ? [p.text] : []));
function at(placeId: string, ...ids: string[]) {
  for (const id of ids) {
    agent(id).state.locationId = placeId;
    agent(id).state.activityKind = "idle";
    ctx.rt(id).travelling = false;
    ctx.rt(id).pending = [];
  }
}

beforeEach(() => notesState(ctx).notes.clear());

describe("notas", () => {
  it("el tablón: solo en la plaza; quien pasa lo lee (como dato) una vez", async () => {
    at("cafe_ola", "hugo");
    expect(await act("hugo", { type: "post_note", text: "Concierto el sábado" })).toBe(false);
    at("plaza", "hugo");
    expect(await act("hugo", { type: "post_note", text: "Concierto el sábado" })).toBe(true);
    at("plaza", "lucia");
    readNotes(ctx, agent("lucia"));
    expect(texts("lucia")).toEqual([
      "En el tablón hay una nota de Hugo Peña: ⟦Concierto el sábado⟧",
    ]);
    ctx.rt("lucia").pending = [];
    readNotes(ctx, agent("lucia"));
    expect(texts("lucia")).toEqual([]);
    expect((await app.defaultWorld.notes.active(now())).map((n) => n.text)).toContain(
      "Concierto el sábado",
    );
  });

  it("nota privada: solo la lee su destinatario, al pasar por donde se dejó", async () => {
    at("casa_roja", "lucia");
    expect(
      await act("lucia", { type: "leave_note", to: "carmen", text: "Te dejo el libro en la mesa" }),
    ).toBe(true);
    at("casa_roja", "mateo", "carmen");
    readNotes(ctx, agent("mateo"));
    expect(texts("mateo")).toEqual([]);
    readNotes(ctx, agent("carmen"));
    expect(texts("carmen")[0]).toMatch(/Lucía Ferrer me dejó una nota: ⟦Te dejo el libro/);
  });

  it("caducan", async () => {
    at("plaza", "hugo");
    await act("hugo", { type: "post_note", text: "Hoy" });
    notesTick(ctx, now() + 4 * 1440);
    expect(notesState(ctx).notes.size).toBe(0);
  });

  it("nada de notas privadas entre un adulto y un menor", async () => {
    at("casa_naranja", "sofia");
    expect(await act("sofia", { type: "leave_note", to: "leo", text: "Repasa el tema 3" })).toBe(
      false,
    );
    expect(texts("sofia").at(-1)).toMatch(/no dejo notas privadas a Leo/);
  });
});
