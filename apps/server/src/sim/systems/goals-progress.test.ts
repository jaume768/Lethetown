/**
 * Metas que pueden avanzar (corrección 2.5, de la partida 2): pasos sin proyecto que se cuelgan
 * donde encajan o pasan a ser proyectos, el aviso de proponer el siguiente proyecto y metas de
 * relación que no se cumplen en medio día.
 */
import { applySocialUpdate } from "@lethetown/agent-core";
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
  relationshipTick,
} from "../goals";

let app: App;
let ctx: SimContext;
const agent = (id: string) => ctx.agents.get(id)!;

beforeAll(async () => {
  app = await bootstrap(
    loadConfig({ LLM_PROVIDER: "mock", EMBEDDINGS: "hash", DATABASE_URL: "", SIM_SEED: "7" }),
    () => {},
  );
  ctx = (app.defaultWorld.sim as unknown as { ctx: SimContext }).ctx;
});
afterAll(() => app.close());

const life = (id: string) => goalsOf(ctx, id, "active").find((g) => g.level === "life")!;
const byText = (id: string, text: string) => goalsOf(ctx, id).find((g) => g.text === text);

describe("pasos sin proyecto padre", () => {
  it("se cuelgan del proyecto que encaja por la persona (Julián: hablar con Inés de Palma)", async () => {
    const talk = goalsOf(ctx, "julian", "active").find(
      (g) => g.text === "Hablar de verdad con Inés",
    )!;
    await applyProposals(
      ctx,
      agent("julian"),
      [
        {
          op: "add",
          level: "step",
          text: "Hablar con Inés sobre su idea de ir a estudiar a Palma",
          criterion: { type: "conversations", personId: "ines", count: 1 },
        },
      ],
      ctx.clock.now(),
    );
    const step = byText("julian", "Hablar con Inés sobre su idea de ir a estudiar a Palma")!;
    expect(step.level).toBe("step");
    expect(step.parentId).toBe(talk.id);
    expect(step.history[0]!.reason).toMatch(/colgado de «Hablar de verdad con Inés»/);
  });

  it("colgado de la meta vital, o sin proyecto donde encaje, pasa a ser un proyecto", async () => {
    const mateo = agent("mateo");
    await applyProposals(
      ctx,
      mateo,
      [
        {
          op: "add",
          level: "step",
          parent: life("mateo").id,
          text: "Hablar con Rafael y arreglar lo de las tardes",
          criterion: { type: "conversations", personId: "rafael", count: 2 },
        },
      ],
      ctx.clock.now(),
    );
    const g = byText("mateo", "Hablar con Rafael y arreglar lo de las tardes")!;
    expect(g.level).toBe("project");
    expect(g.parentId).toBe(life("mateo").id);
    expect(g.history[0]!.reason).toMatch(/pasa a ser un proyecto de su meta vital/);
  });

  it("solo se descarta lo que no se puede medir (con el motivo en la auditoría)", async () => {
    await applyProposals(
      ctx,
      agent("carmen"),
      [{ op: "add", level: "step", text: "Ser feliz", criterion: { type: "felicidad" } }],
      ctx.clock.now(),
    );
    expect(byText("carmen", "Ser feliz")).toBeUndefined();
    const audit = await ctx.deps.memory.store.audit("carmen", 50);
    expect(audit.some((a) => a.reason.includes("no es medible"))).toBe(true);
  });
});

describe("el siguiente proyecto", () => {
  it("una meta vital en 0,50 sin proyectos activos pide el siguiente en la consolidación", async () => {
    // Como en la partida: los dos proyectos de Hugo hechos y la vital a medias.
    for (const g of goalsOf(ctx, "hugo", "active").filter((x) => x.level !== "life")) {
      g.status = "achieved";
      g.updatedAt = ctx.clock.now() - 3 * 1440;
    }
    const vital = life("hugo");
    vital.progress = 0.5;
    const prompt = consolidationPrompt(ctx, agent("hugo"));
    expect(prompt).toMatch(/no tiene ningún proyecto en marcha: propón el siguiente proyecto/);
    expect(prompt).toContain(`"parent":"${vital.id}"`);
    // El mock contesta con un proyecto nuevo, y el motor lo crea.
    await applyProposals(
      ctx,
      agent("hugo"),
      [
        {
          op: "add",
          level: "project",
          parent: vital.id,
          text: "Tocar en la fiesta del pueblo",
          criterion: { type: "place_time", placeId: "plaza", hours: 4 },
        },
      ],
      ctx.clock.now(),
    );
    expect(byText("hugo", "Tocar en la fiesta del pueblo")?.status).toBe("active");
    expect(consolidationPrompt(ctx, agent("hugo"))).not.toMatch(/propón el siguiente proyecto/);
  });

  it("al cumplir un proyecto, esa noche se le recuerda: «has cumplido X»", () => {
    const nuria = goalsOf(ctx, "nuria", "active").find((g) => g.criterion.type === "notes")!;
    for (const n of [1, 2]) {
      goalsOnEvent(ctx, {
        id: `nota-sp${n}`,
        time: ctx.clock.now(),
        agentId: "nuria",
        kind: "action",
        text: "📌",
        participants: ["nuria"],
        meta: { action: "post_note", ok: true },
      });
    }
    expect(nuria.status).toBe("achieved");
    expect(consolidationPrompt(ctx, agent("nuria"))).toMatch(
      /Has cumplido «Dejar avisos en el tablón de la plaza»: propón el siguiente proyecto/,
    );
  });
});

describe("metas de relación exigentes", () => {
  it("objetivo al menos +0,3 sobre lo que hay y conversaciones con esa persona", async () => {
    const profile = await ctx.deps.social.get("samuel", "clara");
    const base = profile?.affinity ?? 0;
    const g = await createGoal(
      ctx,
      agent("samuel"),
      {
        level: "project",
        parentId: life("samuel").id,
        text: "Llevarme bien con Clara",
        criterion: { type: "relationship", personId: "clara", affinity: base + 0.1 },
      },
      ctx.clock.now(),
      "t",
    );
    expect(g).not.toBeNull();
    const c = g!.criterion as { affinity: number; conversations: number };
    expect(c.affinity).toBeCloseTo(Math.min(1, Math.round((base + 0.3) * 100) / 100));
    expect(c.conversations).toBe(3);
    const audit = await ctx.deps.memory.store.audit("samuel", 50);
    expect(audit.some((a) => a.reason.startsWith("objetivo de relación ajustado"))).toBe(true);

    // Aunque la ficha llegue, sin las conversaciones no se cumple.
    await applySocialUpdate(ctx.deps.social, {
      ownerId: "samuel",
      aboutId: "clara",
      affinity: 1,
      now: ctx.clock.now(),
    });
    await relationshipTick(ctx, ctx.clock.now());
    expect(g!.status).toBe("active");
    for (const conv of ["r1", "r2", "r3"]) {
      goalsOnEvent(ctx, {
        id: `${conv}:1`,
        time: ctx.clock.now(),
        agentId: "samuel",
        kind: "speech",
        text: 'samuel → clara: "hola"',
        participants: ["samuel", "clara"],
      });
    }
    expect(g!.measured).toBe(3);
    await relationshipTick(ctx, ctx.clock.now());
    expect(g!.status).toBe("achieved");
    expect(goalsState(ctx).goals.get(g!.id)).toBe(g);
  });
});
