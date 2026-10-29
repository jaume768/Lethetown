/** Citas en Postgres. Solo corre con TEST_DATABASE_URL. */
import { randomUUID } from "node:crypto";
import type { Commitment } from "@lethetown/shared";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type DbHandle } from "./client";
import { InMemoryCommitmentStore, PgCommitmentStore } from "./commitments";
import { worlds } from "./schema";

const url = process.env.TEST_DATABASE_URL;

const meeting = (id: string, at: number, participants = ["a", "b"]): Commitment => ({
  id,
  organizerId: participants[0]!,
  participants,
  responses: Object.fromEntries(participants.map((p) => [p, "accepted" as const])),
  placeId: "cafe",
  at,
  reason: "x",
  status: "accepted",
  arrivals: { a: at },
  forgot: [],
  intentions: { a: "m1" },
  flags: ["left:a"],
  createdAt: 0,
  updatedAt: 0,
});

describe("InMemoryCommitmentStore", () => {
  it("guarda, actualiza, lista por agente y sigue la numeración", async () => {
    const s = new InMemoryCommitmentStore();
    await s.upsert(meeting("c1", 10));
    await s.upsert(meeting("c7", 20, ["b", "c"]));
    await s.upsert({ ...meeting("c1", 10), status: "done" });
    expect((await s.listFor("a")).map((c) => [c.id, c.status])).toEqual([["c1", "done"]]);
    expect((await s.listFor("b")).map((c) => c.id)).toEqual(["c7", "c1"]);
    expect(await s.maxSeq()).toBe(7);
  });
});

describe.skipIf(!url)("PgCommitmentStore (Postgres)", () => {
  let handle: DbHandle;
  const world = `cit-${randomUUID().slice(0, 8)}`;
  beforeAll(async () => {
    handle = createDb(url!);
    await handle.db.insert(worlds).values({ id: world, name: world, map: "seeds/town.tmj" });
  });
  afterAll(async () => {
    await handle.db.delete(worlds).where(eq(worlds.id, world));
    await handle.pool.end();
  });

  it("igual que en RAM, por mundo", async () => {
    const s = new PgCommitmentStore(handle.db, world);
    await s.upsert(meeting("c1", 10));
    await s.upsert(meeting("c3", 20, ["b", "c"]));
    await s.upsert({ ...meeting("c1", 10), status: "failed" });
    expect(await s.get("c1")).toMatchObject({
      status: "failed",
      flags: ["left:a"],
      intentions: { a: "m1" },
    });
    expect((await s.listFor("b")).map((c) => c.id)).toEqual(["c3", "c1"]);
    expect(await s.maxSeq()).toBe(3);
  });
});
