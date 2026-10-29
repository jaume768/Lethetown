/**
 * Integración con Postgres + pgvector. Solo corre con TEST_DATABASE_URL (la CI levanta un
 * Postgres de servicio). Usa un mundo temporal que se borra al acabar (ON DELETE CASCADE).
 */
import { randomUUID } from "node:crypto";
import { HashEmbedder, type MemoryRecord } from "@lethetown/agent-core";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type DbHandle } from "./client";
import { PgMemoryStore } from "./pg-memory-store";
import { worlds } from "./schema";

const url = process.env.TEST_DATABASE_URL;
const embedder = new HashEmbedder(384);

describe.skipIf(!url)("PgMemoryStore (Postgres)", () => {
  let handle: DbHandle;
  const worldA = `test-${randomUUID().slice(0, 8)}`;
  const worldB = `${worldA}-b`;
  let store: PgMemoryStore;

  const memory = async (agentId: string, text: string): Promise<MemoryRecord> => ({
    id: randomUUID(),
    agentId,
    text,
    gist: null,
    embedding: (await embedder.embed([text]))[0]!,
    createdAt: 0,
    lastAccessedAt: 0,
    importance: 5,
    emotionalValence: 0,
    strength: 1,
    stability: 100,
    accessCount: 0,
    source: "vivido",
    type: "observation",
    people: [],
    placeId: null,
    eventId: null,
    links: [],
    meta: {},
    status: "active",
    forgottenAt: null,
  });

  beforeAll(async () => {
    handle = createDb(url!);
    await handle.db.insert(worlds).values([
      { id: worldA, name: "test A", map: "seeds/town.tmj" },
      { id: worldB, name: "test B", map: "seeds/town.tmj" },
    ]);
    store = new PgMemoryStore(handle.db, worldA);
  });

  afterAll(async () => {
    await handle.db.delete(worlds).where(eq(worlds.id, worldA));
    await handle.db.delete(worlds).where(eq(worlds.id, worldB));
    await handle.pool.end();
  });

  it("aísla los mundos aunque se repita el id del agente", async () => {
    const other = new PgMemoryStore(handle.db, worldB);
    await store.add(await memory("lucia", "vi un gato en el parque"));
    await other.add(await memory("lucia", "llovía en la tienda"));
    expect((await store.listByAgent("lucia")).map((m) => m.text)).toEqual([
      "vi un gato en el parque",
    ]);
    expect((await other.listByAgent("lucia")).map((m) => m.text)).toEqual(["llovía en la tienda"]);
  });

  it("updateMany aplica los refuerzos en una sola operación", async () => {
    const a = await memory("mateo", "abrí el café");
    const b = await memory("mateo", "barrí la terraza");
    await store.add(a);
    await store.add(b);
    await store.updateMany([
      { id: a.id, patch: { strength: 0.5, stability: 10, lastAccessedAt: 99, accessCount: 3 } },
      { id: b.id, patch: { strength: 0.25, stability: 20, lastAccessedAt: 98, accessCount: 4 } },
    ]);
    const [ra, rb] = [await store.get(a.id), await store.get(b.id)];
    expect([ra?.strength, ra?.accessCount, rb?.stability, rb?.lastAccessedAt]).toEqual([
      0.5, 3, 20, 98,
    ]);
  });

  it("transaction deshace todo si algo falla", async () => {
    const m = await memory("carmen", "regué las plantas");
    await store.add(m);
    await expect(
      store.transaction(async (tx) => {
        await tx.update(m.id, { text: "cambiado" });
        throw new Error("falla a mitad");
      }),
    ).rejects.toThrow("falla a mitad");
    expect((await store.get(m.id))?.text).toBe("regué las plantas");
  });

  it("candidates filtra por agente con iterative scan y el inspector no trae embeddings", async () => {
    for (let i = 0; i < 30; i++) await store.add(await memory("otro", `ruido número ${i}`));
    const q = (await embedder.embed(["gato parque"]))[0]!;
    const cands = await store.candidates("lucia", q, 9);
    expect(cands.every((c) => c.agentId === "lucia")).toBe(true);
    expect(cands.length).toBeGreaterThan(0);
    const rows = await store.listForInspection("lucia", q);
    expect(rows[0]!.memory.embedding).toEqual([]);
    expect(rows[0]!.relevance).toBeGreaterThan(0);
  });

  it("listActive: lo mismo que listByAgent filtrado, con o sin vectores", async () => {
    const a = await memory("activo", "uno");
    const b = { ...(await memory("activo", "dos")), status: "archived" as const };
    await store.add(a);
    await store.add(b);
    const full = (await store.listByAgent("activo")).filter((m) => m.status === "active");
    const lean = await store.listActive("activo");
    expect(lean.map((m) => ({ ...m, embedding: [] }))).toEqual(
      full.map((m) => ({ ...m, embedding: [] })),
    );
    expect(lean[0]!.embedding).toEqual([]);
    expect((await store.listActive("activo", { withEmbedding: true }))[0]!.embedding).toHaveLength(
      384,
    );
  });
});
