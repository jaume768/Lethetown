/** Retención de datos: políticas, poda en RAM y en Postgres, y que el inspector siga funcionando. */
import { randomUUID } from "node:crypto";
import {
  InMemorySocialProfileStore,
  InMemoryStore,
  type MemoryRecord,
} from "@lethetown/agent-core";
import type { SocialProfileChange } from "@lethetown/shared";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootstrap } from "./bootstrap";
import { loadConfig } from "./config";
import { createDb, type DbHandle } from "./db/client";
import { llmCalls, memories, socialProfileHistory, worldSnapshots, worlds } from "./db/schema";
import { PgSocialProfileStore, InMemoryEventStore } from "./db/stores";
import { PgMemoryStore } from "./db/pg-memory-store";
import { RetentionConfig, pruneGlobalPg, pruneWorldPg, pruneWorldRam } from "./retention";

const DAY = 1440;
/** Un día de juego para todo lo que va por días de juego. */
const cfg = RetentionConfig.parse({
  memories: { days: 1 },
  memoryAudit: { days: 1 },
  memoryVersions: { days: 1 },
  socialHistory: { days: 1 },
  simEvents: { days: 1 },
  llmCalls: { days: 1 },
  worldSnapshots: { days: 1 },
});

const mem = (id: string, over: Partial<MemoryRecord> = {}): MemoryRecord => ({
  id,
  agentId: "a",
  text: id,
  gist: null,
  embedding: new Array(384).fill(0).map((_, i) => (i === 0 ? 1 : 0)),
  createdAt: 0,
  lastAccessedAt: 0,
  importance: 5,
  emotionalValence: 0,
  strength: 1,
  stability: 10,
  accessCount: 0,
  source: "vivido",
  type: "observation",
  people: [],
  placeId: null,
  eventId: null,
  links: [],
  status: "active",
  forgottenAt: null,
  meta: {},
  ...over,
});

const change = (at: number, affinity: number): SocialProfileChange => ({
  ownerId: "a",
  aboutId: "b",
  at,
  affinity,
  trust: 0.5,
  familiarity: 0.5,
  relationshipType: "neighbor",
  reason: "x",
  eventId: null,
});

describe("políticas", () => {
  it("valores por defecto y modos permitidos por tabla", () => {
    const d = RetentionConfig.parse({});
    expect(d.socialHistory).toEqual({ days: 30, clock: "game", mode: "summarize" });
    expect(d.llmCalls.days).toBeGreaterThanOrEqual(31);
    expect(() => RetentionConfig.parse({ memories: { mode: "summarize" } })).toThrow();
  });
});

describe("poda en RAM", () => {
  it("recuerdos olvidados/archivados viejos, auditoría, versiones, historial y eventos", async () => {
    const memory = new InMemoryStore();
    await memory.add(mem("activo-viejo"));
    await memory.add(mem("olvidado-viejo", { forgottenAt: 10 }));
    await memory.add(mem("archivado-viejo", { status: "archived", createdAt: 5 }));
    await memory.add(mem("olvidado-reciente", { forgottenAt: 3 * DAY }));
    await memory.addVersion({
      memoryId: "olvidado-viejo",
      version: 0,
      text: "x",
      emotionalValence: 0,
      source: "vivido",
      at: 10,
      reason: "x",
    });
    await memory.addAudit({
      agentId: "a",
      memoryId: "x",
      memoryText: "x",
      action: "gist",
      reason: "x",
      at: 10,
    });
    const social = new InMemorySocialProfileStore();
    for (const c of [
      change(10, 0.1),
      change(20, 0.2),
      change(DAY + 5, 0.3),
      change(3 * DAY, 0.4),
    ]) {
      await social.addHistory(c);
    }
    const events = new InMemoryEventStore();
    const ev = (id: string, time: number, kind: "speech" | "chronicle") =>
      events.add({ id, time, agentId: null, kind, text: id, participants: [] });
    await ev("viejo", 10, "speech");
    await ev("cronica", 10, "chronicle");
    await ev("nuevo", 3 * DAY, "speech");

    const r = pruneWorldRam({ memory, social, events }, 3 * DAY + 60, cfg);
    expect(r).toMatchObject({
      memories: 2,
      memoryAudit: 1,
      memoryVersions: 1,
      socialHistory: 1,
      simEvents: 1,
    });
    expect((await memory.listByAgent("a")).map((m) => m.id).sort()).toEqual([
      "activo-viejo",
      "olvidado-reciente",
    ]);
    // Resumir: queda el último cambio de cada día.
    expect((await social.history("a")).map((c) => c.affinity)).toEqual([0.2, 0.3, 0.4]);
    expect((await events.range(0, 10 * DAY)).map((e) => e.id)).toEqual(["cronica", "nuevo"]);
  });

  it("el inspector y Rashomon siguen funcionando tras podar un mundo", async () => {
    const app = await bootstrap(
      loadConfig({ LLM_PROVIDER: "mock", EMBEDDINGS: "hash", DATABASE_URL: "", SIM_SEED: "7" }),
      () => {},
    );
    const w = app.defaultWorld;
    w.start();
    await w.clock.runUntil(w.clock.now() + 30 * 60);
    Object.assign(app.retention, cfg, { memories: { days: 0.01, clock: "game", mode: "delete" } });
    await w.prune();
    const scored = await w.memory.inspect({
      agentId: "lucia",
      query: "café",
      now: w.clock.now(),
      moodValence: 0,
    });
    expect(scored.length).toBeGreaterThan(0);
    expect(scored.every((s) => s.memory.status === "active")).toBe(true);
    const anyEvent = scored.find((s) => s.memory.eventId)?.memory.eventId;
    if (anyEvent) expect((await w.memory.store.byEvent(anyEvent)).length).toBeGreaterThan(0);
    await app.close();
  }, 30_000);
});

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("poda en Postgres", () => {
  let handle: DbHandle;
  const world = `ret-${randomUUID().slice(0, 8)}`;

  beforeAll(async () => {
    handle = createDb(url!);
    await handle.db.insert(worlds).values({ id: world, name: world, map: "seeds/town.tmj" });
  });
  afterAll(async () => {
    await handle.db.delete(worlds).where(eq(worlds.id, world));
    await handle.pool.end();
  });

  it("borra y resume lo viejo de un mundo y conserva lo vivo", async () => {
    const store = new PgMemoryStore(handle.db, world);
    await store.add(mem("p-activo"));
    await store.add(mem("p-olvidado", { forgottenAt: 10 }));
    const social = new PgSocialProfileStore(handle.db, world);
    for (const c of [change(10, 0.1), change(20, 0.2), change(3 * DAY, 0.4)])
      await social.addHistory(c);
    const old = new Date(Date.now() - 5 * 86_400_000);
    for (const id of [1, 2]) {
      await handle.db.insert(worldSnapshots).values({
        worldId: world,
        gameTime: id,
        reason: "hourly",
        data: {},
        createdAt: old,
      });
    }
    const r = await pruneWorldPg(handle.db, world, 3 * DAY + 60, cfg);
    expect(r.memories).toBe(1);
    expect(r.socialHistory).toBe(1);
    expect(r.worldSnapshots).toBe(1);
    const left = await handle.db
      .select({ id: memories.id })
      .from(memories)
      .where(eq(memories.worldId, world));
    expect(left.map((m) => m.id)).toEqual(["p-activo"]);
    const hist = await handle.db
      .select({ a: socialProfileHistory.affinity })
      .from(socialProfileHistory)
      .where(eq(socialProfileHistory.worldId, world));
    expect(hist.map((h) => Number(h.a.toFixed(2))).sort()).toEqual([0.2, 0.4]);
    // La última instantánea se conserva aunque sea vieja.
    const snaps = await handle.db
      .select()
      .from(worldSnapshots)
      .where(eq(worldSnapshots.worldId, world));
    expect(snaps.map((s) => s.gameTime)).toEqual([2]);
  });

  it("resume los costes viejos por día, modelo y tarea sin perder el gasto", async () => {
    const old = new Date(Date.now() - 5 * 86_400_000);
    const row = (agentId: string, usd: number) => ({
      worldId: world,
      at: old,
      model: "m",
      task: "decide",
      agentId,
      inputTokens: 10,
      outputTokens: 1,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      usd,
    });
    await handle.db.insert(llmCalls).values([row("a", 0.25), row("b", 0.5)]);
    await pruneGlobalPg(handle.db, cfg);
    const rows = await handle.db.select().from(llmCalls).where(eq(llmCalls.worldId, world));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ agentId: "*", inputTokens: 20, usd: 0.75 });
    // Lo ya resumido no se vuelve a resumir.
    await pruneGlobalPg(handle.db, cfg);
    expect(await handle.db.select().from(llmCalls).where(eq(llmCalls.worldId, world))).toHaveLength(
      1,
    );
  });
});
