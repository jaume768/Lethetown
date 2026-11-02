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
    personalityTick(ctx, 0);
    event("ines", "goal", true);
    event("ines", "goal", true);
    event("valentina", "teach", true, ["valentina", "ines"]);
    personalityTick(ctx, WEEK + 5);
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
