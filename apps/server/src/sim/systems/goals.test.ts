/** Sistema `goals`: metas medibles, psicología, conflictos, marcharse y volver de visita. */
import { AWAY_LOCATION } from "@lethetown/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootstrap, type App } from "../../bootstrap";
import { loadConfig } from "../../config";
import type { SimContext } from "../context";
import {
  applyProposals,
  consolidationPrompt,
  createGoal,
  goalsOf,
  goalsOnEvent,
  goalsState,
  isAway,
  measureTick,
  planLines,
  reviewNight,
  visitsTick,
} from "../goals";
import { restoreSystems, snapshotSystems, systemsHold } from ".";

let app: App;
let ctx: SimContext;
const agent = (id: string) => ctx.agents.get(id)!;
const DAY = 1440;

beforeAll(async () => {
  app = await bootstrap(
    loadConfig({ LLM_PROVIDER: "mock", EMBEDDINGS: "hash", DATABASE_URL: "", SIM_SEED: "7" }),
    () => {},
  );
  ctx = (app.defaultWorld.sim as unknown as { ctx: SimContext }).ctx;
});
afterAll(() => app.close());

const speech = (from: string, to: string, conv: string, time = ctx.clock.now()) =>
  goalsOnEvent(ctx, {
    id: `${conv}:1`,
    time,
    agentId: from,
    kind: "speech",
    text: `${from} → ${to}: "hola"`,
    participants: [from, to],
  });

describe("metas de partida", () => {
  it("cada vecino empieza con una meta vital y sus proyectos (y se guardan)", async () => {
    for (const a of ctx.agents.values()) {
      const mine = goalsOf(ctx, a.id, "active");
      expect(
        mine.filter((g) => g.level === "life"),
        a.id,
      ).toHaveLength(1);
      expect(mine.filter((g) => g.level === "project").length, a.id).toBeGreaterThanOrEqual(1);
    }
    expect((await app.defaultWorld.goals.listFor("ines")).length).toBe(3);
  });

  it("los conflictos sembrados se detectan y se notan en las fichas", () => {
    const pairs = [...goalsState(ctx).conflicts].map((k) =>
      k
        .split("|")
        .map((id) => goalsState(ctx).goals.get(id)!.agentId)
        .sort()
        .join("-"),
    );
    expect(pairs).toEqual(expect.arrayContaining(["elena-nuria", "mateo-rafael"]));
  });

  it("los menores: metas de su edad y la de irse, como algo para cuando sean mayores", () => {
    const life = goalsOf(ctx, "ines").find((g) => g.level === "life")!;
    expect(life.departure).toEqual({ to: "Palma" });
    expect(life.text).toMatch(/mayor de edad/);
    for (const id of ["ines", "leo"]) {
      for (const g of goalsOf(ctx, id)) expect(g.criterion.type).not.toBe("relationship");
    }
  });
});

describe("el motor mide (nunca el LLM)", () => {
  it("conversaciones con alguien: cada conversación una vez", () => {
    const g = goalsOf(ctx, "julian", "active").find((x) => x.criterion.type === "conversations")!;
    const before = g.measured;
    speech("julian", "ines", "c900");
    speech("ines", "julian", "c900");
    speech("julian", "ines", "c901");
    expect(g.measured).toBe(before + 2);
    expect(g.progress).toBeCloseTo(g.measured / (g.criterion as { count: number }).count);
  });

  it("horas en un sitio y visitas, en la revisión periódica", () => {
    const tomas = agent("tomas");
    const g = goalsOf(ctx, "tomas", "active").find((x) => x.criterion.type === "place_time")!;
    tomas.state.locationId = "lago";
    tomas.state.activityKind = "idle";
    const before = g.measured;
    measureTick(ctx, ctx.clock.now(), 30);
    expect(g.measured).toBe(before + 30);
    const leo = goalsOf(ctx, "leo", "active").find((x) => x.criterion.type === "visits")!;
    agent("leo").state.locationId = "lago";
    agent("leo").state.activityKind = "idle";
    measureTick(ctx, ctx.clock.now(), 5);
    expect(leo.measured).toBe(1);
  });

  it("al conseguirla: evento, recuerdo, ánimo y avance de la meta vital", async () => {
    const nuria = agent("nuria");
    const notes = goalsOf(ctx, "nuria", "active").find((x) => x.criterion.type === "notes")!;
    const life = goalsOf(ctx, "nuria", "active").find((x) => x.level === "life")!;
    const mood = nuria.state.mood.valence;
    const events: string[] = [];
    const off = ctx.onEvent((e) => events.push(e.text));
    for (const n of [1, 2]) {
      goalsOnEvent(ctx, {
        id: `nota${n}`,
        time: ctx.clock.now(),
        agentId: "nuria",
        kind: "action",
        text: "📌",
        participants: ["nuria"],
        meta: { action: "post_note", ok: true },
      });
    }
    off();
    expect(notes.status).toBe("achieved");
    expect(events.some((t) => t.startsWith("🏆 Nuria Campos consigue su proyecto"))).toBe(true);
    expect(nuria.state.mood.valence).toBeGreaterThan(mood);
    // La vital pide 4 proyectos (los 2 de partida y 2 que irá proponiendo).
    expect(life.progress).toBeGreaterThanOrEqual(0.25);
    await new Promise((r) => setTimeout(r, 20));
    const memories = await ctx.deps.memory.store.listByAgent("nuria");
    expect(memories.some((m) => m.text.startsWith("Lo conseguí:"))).toBe(true);
  });
});

describe("validación de lo que propone el modelo", () => {
  it("descarta lo que no se puede medir, a quien no existe y lo de un menor en casa ajena", async () => {
    const now = ctx.clock.now();
    const leo = agent("leo");
    const project = (criterion: object) => ({
      level: "project" as const,
      parentId: goalsOf(ctx, "leo").find((g) => g.level === "life")!.id,
      text: "Algo nuevo y medible",
      criterion: criterion as never,
    });
    expect(
      await createGoal(
        ctx,
        leo,
        project({ type: "conversations", personId: "nadie", count: 2 }),
        now,
        "t",
      ),
    ).toBeNull();
    expect(
      await createGoal(
        ctx,
        leo,
        project({ type: "place_time", placeId: "casa_faro", hours: 2 }),
        now,
        "t",
      ),
    ).toBeNull();
    // Su casa y los sitios públicos, sí (y respeta el tope de proyectos).
    const ok = await createGoal(
      ctx,
      leo,
      project({ type: "place_time", placeId: "parque", hours: 2 }),
      now,
      "t",
    );
    expect(ok?.status).toBe("active");
  });

  it("las propuestas de la consolidación pasan por el mismo filtro (las malas, a la auditoría)", async () => {
    const lucia = agent("lucia");
    const project = goalsOf(ctx, "lucia", "active").find((g) => g.level === "project")!;
    await applyProposals(
      ctx,
      lucia,
      [
        {
          op: "add",
          level: "step",
          parent: project.id,
          text: "Ser famosa",
          criterion: { type: "fama" },
        },
        {
          op: "add",
          level: "step",
          parent: project.id,
          text: "Enseñarle los bocetos a Mateo",
          criterion: { type: "conversations", personId: "mateo", count: 1 },
        },
        { op: "postpone", id: "g9999" },
      ],
      ctx.clock.now(),
    );
    expect(
      goalsOf(ctx, "lucia", "active").some((g) => g.text === "Enseñarle los bocetos a Mateo"),
    ).toBe(true);
    expect(goalsOf(ctx, "lucia").some((g) => g.text === "Ser famosa")).toBe(false);
    const audit = await ctx.deps.memory.store.audit("lucia", 50);
    expect(audit.some((a) => a.action === "goal" && a.reason.includes("no es medible"))).toBe(true);
  });

  it("el prompt de la consolidación y el del plan llevan sus metas", () => {
    expect(consolidationPrompt(ctx, agent("ines"))).toMatch(
      /\[vital\] Prepararme para estudiar fotografía/,
    );
    expect(planLines(ctx, agent("ines")).join("\n")).toMatch(/^Vital: .*\nProyecto: /);
  });
});

describe("la noche: motivación, frustración y abandono", () => {
  it("estancarse frustra y, con mala suerte y frustración alta, se abandona (auditado)", async () => {
    const hugo = agent("hugo");
    const g = goalsOf(ctx, "hugo", "active").find((x) => x.level === "project")!;
    g.frustration = 0.95;
    g.lastProgressAt = ctx.clock.now() - 3 * DAY;
    const rng = ctx.deps.rng;
    (ctx.deps as { rng: () => number }).rng = () => 0;
    reviewNight(ctx, hugo, ctx.clock.now());
    (ctx.deps as { rng: () => number }).rng = rng;
    expect(g.status).toBe("abandoned");
    expect(g.history.at(-1)!.reason).toMatch(/abandonada: frustración/);
  });
});

describe("marcharse del pueblo", () => {
  it("un menor que lo consigue no se va: queda aplazado hasta que sea mayor de edad", () => {
    const ines = agent("ines");
    const life = goalsOf(ctx, "ines").find((g) => g.level === "life")!;
    // Para el test, basta con sus dos proyectos de partida.
    (life.criterion as { count: number }).count = 2;
    ines.state.locationId = "plaza";
    ines.state.action = "haciendo fotos con carrete en la plaza";
    ines.state.activityKind = "idle";
    measureTick(ctx, ctx.clock.now(), 8 * 60);
    for (let i = 0; i < 5; i++) speech("ines", "valentina", `c95${i}`);
    expect(life.status).toBe("postponed");
    expect(life.history.at(-1)!.reason).toMatch(/menor de edad/);
    expect(isAway(ctx, "ines")).toBe(false);
    expect(ines.state.locationId).not.toBe(AWAY_LOCATION);
    // Y no se puede retomar mientras sea menor.
    void applyProposals(ctx, ines, [{ op: "resume", id: life.id }], ctx.clock.now());
    expect(life.status).toBe("postponed");
  });

  it("un adulto se va: deja de vivir aquí, el pueblo lo recuerda y vuelve de visita", async () => {
    const clara = agent("clara");
    const life = goalsOf(ctx, "clara", "active").find((g) => g.level === "life")!;
    const projects = goalsOf(ctx, "clara", "active").filter((g) => g.parentId === life.id);
    (life.criterion as { count: number }).count = projects.length;
    const now = ctx.clock.now();
    // Lo que le falta: horas en el mercadillo y hablar con Samuel.
    clara.state.locationId = "mercado";
    clara.state.activityKind = "idle";
    measureTick(ctx, now, 60 * 60);
    for (let i = 0; i < 5; i++) speech("clara", "samuel", `c96${i}`);
    expect(projects.every((p) => p.status === "achieved")).toBe(true);
    expect(life.status).toBe("achieved");
    expect(isAway(ctx, "clara")).toBe(true);
    expect(systemsHold(ctx, "clara")).toBe(true);
    expect(clara.state.locationId).toBe(AWAY_LOCATION);
    const d = (await app.defaultWorld.departures.list()).find((x) => x.agentId === "clara")!;
    expect(d).toMatchObject({ to: "Palma", visiting: false });
    await new Promise((r) => setTimeout(r, 20));
    const remembered = await ctx.deps.memory.store.listByAgent("aurora");
    expect(remembered.some((m) => m.text === "Clara Méndez se ha ido a vivir a Palma.")).toBe(true);
    // Vuelve de visita el día programado y se va por la tarde.
    visitsTick(ctx, d.nextVisitAt!);
    expect(isAway(ctx, "clara")).toBe(false);
    expect(clara.state.locationId).toBe("plaza");
    visitsTick(ctx, Math.floor(d.nextVisitAt! / DAY) * DAY + 19 * 60);
    expect(isAway(ctx, "clara")).toBe(true);
    expect(goalsState(ctx).departures.get("clara")!.visits).toBe(1);
  });

  it("la instantánea guarda metas y ausentes", () => {
    const snap = structuredClone(snapshotSystems(ctx));
    expect(snap.goals!.version).toBe(1);
    const count = goalsState(ctx).goals.size;
    goalsState(ctx).goals.clear();
    goalsState(ctx).departures.clear();
    restoreSystems(ctx, snap);
    expect(goalsState(ctx).goals.size).toBe(count);
    expect(isAway(ctx, "clara")).toBe(true);
  });
});
