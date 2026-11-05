/** Sistema `personality`: lo vivido en una semana mueve un poco la personalidad, auditado. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootstrap, type App } from "../../bootstrap";
import { loadConfig } from "../../config";
import type { SimContext } from "../context";
import { personalityState, personalityTick } from "./personality";
import { restoreSystems, snapshotSystems } from ".";

let app: App;
let ctx: SimContext;
const agent = (id: string) => ctx.agents.get(id)!;
const WEEK = 7 * 1440;

beforeAll(async () => {
  app = await bootstrap(
    loadConfig({ LLM_PROVIDER: "mock", EMBEDDINGS: "hash", DATABASE_URL: "", SIM_SEED: "7" }),
    () => {},
  );
  ctx = (app.defaultWorld.sim as unknown as { ctx: SimContext }).ctx;
});
afterAll(() => app.close());

const event = (agentId: string, action: string, ok: boolean, participants = [agentId]) =>
  ctx.emit("action", agentId, "…", participants, undefined, { action, ok });

describe("deriva de la personalidad", () => {
  it("una semana con metas conseguidas y aprendiendo: algo más de constancia y apertura", async () => {
    const before = { ...agent("ines").seed.personality };
    await personalityTick(ctx, 0);
    event("ines", "goal", true);
    event("ines", "goal", true);
    event("valentina", "teach", true, ["valentina", "ines"]);
    await personalityTick(ctx, WEEK + 5);
    const after = agent("ines").seed.personality;
    expect(after.conscientiousness).toBeGreaterThan(before.conscientiousness);
    expect(after.openness).toBeGreaterThan(before.openness);
    expect(after.conscientiousness - before.conscientiousness).toBeLessThanOrEqual(0.02);
    const audit = await ctx.deps.memory.store.audit("ines", 50);
    const entry = audit.find((a) => a.action === "personality")!;
    expect(entry.reason).toMatch(
      /^esta semana, .*con más constancia.*: metas conseguidas \(2\), aprender algo \(1\)$/,
    );
    // Lo vivido se cuenta de nuevo cada semana.
    expect(personalityState(ctx).lived.size).toBe(0);
  });

  it("una semana buena y otra mala: deltas de signo distinto, respecto a la media del pueblo", async () => {
    const good = { ...agent("ines").seed.personality };
    const bad = { ...agent("rafael").seed.personality };
    const profileBefore = ctx.deps.memory.profileOf("rafael");
    // Inés: metas conseguidas y aprender. Rafael: plantones, un préstamo sin devolver, metas
    // abandonadas y estancadas.
    event("ines", "goal", true);
    event("ines", "goal", true);
    event("valentina", "teach", true, ["valentina", "ines"]);
    for (let i = 0; i < 3; i++) {
      ctx.emit(
        "memory",
        "rafael",
        "💔 Plantón en la taberna: Hugo no fue a la cita con Rafael",
        ["rafael", "hugo"],
        undefined,
        { action: "meeting", ok: false, affected: ["rafael"] },
      );
      event("hugo", "loan", false, ["hugo", "rafael"]);
      event("rafael", "goal", false);
    }
    for (const g of (await import("../goals")).goalsOf(ctx, "rafael", "active"))
      g.frustration = 0.8;
    await personalityTick(ctx, 2 * WEEK + 5);
    const dGood = agent("ines").seed.personality.neuroticism - good.neuroticism;
    const dBad = agent("rafael").seed.personality.neuroticism - bad.neuroticism;
    expect(dGood).toBeLessThan(0);
    expect(dBad).toBeGreaterThan(0);
    expect(Math.abs(dBad)).toBeLessThanOrEqual(0.02 + 1e-9);
    expect(agent("rafael").seed.personality.agreeableness).toBeLessThan(bad.agreeableness);
    // Hugo no fue a la cita: el plantón no es suyo.
    const audit = await ctx.deps.memory.store.audit("rafael", 80);
    expect(audit.find((a) => a.action === "personality")!.reason).toMatch(
      /plantones \(3\).*préstamos sin devolver \(3\)|préstamos sin devolver \(3\).*plantones \(3\)/,
    );
    // El perfil de memoria sigue a la deriva (más neuroticismo, más congruencia con el ánimo).
    expect(ctx.deps.memory.profileOf("rafael").moodCongruence).toBeGreaterThan(
      profileBefore.moodCongruence,
    );
  });

  it("si cambia cómo se describe, se rehace el prompt fijo (y solo entonces)", () => {
    const a = agent("tomas");
    const system = a.system;
    a.seed.personality = { ...a.seed.personality, openness: 0.9 };
    expect(a.refreshIdentity()).toBe(true);
    expect(a.system).not.toBe(system);
    expect(a.refreshIdentity()).toBe(false);
  });

  it("la instantánea guarda la personalidad de ahora y la de la semilla", () => {
    const snap = structuredClone(snapshotSystems(ctx));
    const now = { ...agent("ines").seed.personality };
    agent("ines").seed.personality = { ...now, openness: 0.1 };
    restoreSystems(ctx, snap);
    expect(agent("ines").seed.personality).toEqual(now);
  });
});
