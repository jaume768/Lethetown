/** Leases entre workers (Postgres). Solo corre con TEST_DATABASE_URL. */
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type DbHandle } from "../db/client";
import { worldLeases, worlds } from "../db/schema";
import { LeaseManager } from "./leases";

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("LeaseManager (Postgres)", () => {
  let handle: DbHandle;
  const ids = [`lease-${randomUUID().slice(0, 8)}`, `lease-${randomUUID().slice(0, 8)}`];

  beforeAll(async () => {
    handle = createDb(url!);
    // Solo los mundos de este test pueden reclamarse: el resto se marcan con lease ajena vigente.
    await handle.db
      .insert(worlds)
      .values(ids.map((id) => ({ id, name: id, map: "seeds/town.tmj" })));
  });

  afterAll(async () => {
    await handle.db.delete(worlds).where(inArray(worlds.id, ids));
    await handle.pool.end();
  });

  it("dos workers nunca tienen el mismo mundo y uno recoge los del otro al caducar", async () => {
    const a = new LeaseManager(handle.db, "worker-a", 60_000);
    const b = new LeaseManager(handle.db, "worker-b", 60_000);
    const mine = (got: string[]) => got.filter((id) => ids.includes(id));
    const gotA = mine(await a.claim(100, []));
    const gotB = mine(await b.claim(100, []));
    expect(gotA.sort()).toEqual([...ids].sort());
    expect(gotB).toEqual([]);
    // Caduca la lease de A: B la reclama y A, al renovar, se entera de que la perdió.
    await handle.db
      .update(worldLeases)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(worldLeases.worldId, ids[0]!));
    expect(mine(await b.claim(100, []))).toEqual([ids[0]]);
    expect(await a.renew(ids)).toEqual([ids[0]]);
    await a.release(ids);
    await b.release(ids);
  });
});
