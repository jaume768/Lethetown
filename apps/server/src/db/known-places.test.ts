/** Lugares conocidos en RAM y en Postgres (este, solo con TEST_DATABASE_URL). */
import { randomUUID } from "node:crypto";
import type { KnownPlace } from "@lethetown/shared";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type DbHandle } from "./client";
import { InMemoryKnownPlaceStore, PgKnownPlaceStore, type KnownPlaceStore } from "./known-places";
import { worlds } from "./schema";

const url = process.env.TEST_DATABASE_URL;

const known = (placeId: string, at: number, source: KnownPlace["source"] = "seen"): KnownPlace => ({
  placeId,
  source,
  at,
  toldBy: source === "told" ? "lucia" : null,
});

/** Lo mismo para los dos almacenes. */
async function contract(s: KnownPlaceStore) {
  await s.addMany("a", [known("plaza", 0, "seed"), known("cafe", 30, "told")]);
  // Lo ya conocido no cambia.
  await s.addMany("a", [known("cafe", 99), known("lago", 50)]);
  expect(await s.list("a")).toEqual([
    known("plaza", 0, "seed"),
    known("cafe", 30, "told"),
    known("lago", 50),
  ]);
  await s.replace("a", [known("plaza", 0, "seed")]);
  expect((await s.list("a")).map((k) => k.placeId)).toEqual(["plaza"]);
  expect(await s.list("b")).toEqual([]);
}

describe("InMemoryKnownPlaceStore", () => {
  it("añade sin pisar, sustituye y lista por orden", () => contract(new InMemoryKnownPlaceStore()));
});

describe.skipIf(!url)("PgKnownPlaceStore", () => {
  let handle: DbHandle;
  const world = `kp-${randomUUID().slice(0, 8)}`;
  beforeAll(async () => {
    handle = createDb(url!);
    await handle.db.insert(worlds).values({ id: world, name: world, map: "seeds/town.tmj" });
  });
  afterAll(async () => {
    await handle.db.delete(worlds).where(eq(worlds.id, world));
    await handle.pool.end();
  });

  it("añade sin pisar, sustituye y lista por orden", () =>
    contract(new PgKnownPlaceStore(handle.db, world)));
});
