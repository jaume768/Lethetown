/** Fichas sociales e historial en Postgres. Solo corre con TEST_DATABASE_URL. */
import { randomUUID } from "node:crypto";
import { applySocialUpdate } from "@lethetown/agent-core";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type DbHandle } from "./client";
import { worlds } from "./schema";
import { PgSocialProfileStore } from "./stores";

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("PgSocialProfileStore (Postgres)", () => {
  let handle: DbHandle;
  const world = `test-${randomUUID().slice(0, 8)}`;
  let store: PgSocialProfileStore;

  beforeAll(async () => {
    handle = createDb(url!);
    await handle.db.insert(worlds).values({ id: world, name: world, map: "seeds/town.tmj" });
    store = new PgSocialProfileStore(handle.db, world);
  });

  afterAll(async () => {
    await handle.db.delete(worlds).where(eq(worlds.id, world));
    await handle.pool.end();
  });

  it("guarda la ficha ampliada y su historial", async () => {
    await applySocialUpdate(store, {
      ownerId: "tomas",
      aboutId: "pilar",
      affinity: 0.7,
      familiarityDelta: 0.9,
      bond: "romantic",
      now: 10,
      reason: "relación de partida",
    });
    await applySocialUpdate(store, {
      ownerId: "tomas",
      aboutId: "pilar",
      affinityDelta: -0.5,
      now: 20,
      reason: "discutieron",
      eventId: "c1",
    });
    const p = await store.get("tomas", "pilar");
    expect(p).toMatchObject({ bond: "romantic", relationshipType: "romantic" });
    expect(p!.grudge).toBeCloseTo(0.25);
    expect(p!.familiarity).toBeCloseTo(1);
    const h = await store.history("tomas", "pilar");
    expect(h.map((c) => c.reason)).toEqual(["relación de partida", "discutieron"]);
    expect(h[1]).toMatchObject({ eventId: "c1", at: 20 });
    expect(await store.history(null, undefined, { since: 15 })).toHaveLength(1);
    expect((await store.listAll()).map((x) => x.aboutId)).toEqual(["pilar"]);
  });
});
