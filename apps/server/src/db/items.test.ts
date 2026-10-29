/** Objetos del inventario en RAM y en Postgres (este, solo con TEST_DATABASE_URL). */
import { randomUUID } from "node:crypto";
import type { Item } from "@lethetown/shared";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type DbHandle } from "./client";
import { InMemoryItemStore, PgItemStore, type ItemStore } from "./items";
import { worlds } from "./schema";

const url = process.env.TEST_DATABASE_URL;

const item = (id: string, over: Partial<Item> = {}): Item => ({
  id,
  kind: "libro",
  name: "el libro",
  description: "",
  ownerId: "a",
  holderId: "a",
  placeId: null,
  loan: null,
  value: 0,
  createdAt: 0,
  updatedAt: 0,
  ...over,
});

async function contract(s: ItemStore) {
  await s.upsert(item("i2"));
  await s.upsert(item("i10", { ownerId: "b", holderId: "c" }));
  await s.upsert(
    item("i2", {
      holderId: "b",
      loan: { from: "a", to: "b", since: 5, dueAt: 100, overdueNoticed: false },
    }),
  );
  expect((await s.listAll()).map((i) => i.id)).toEqual(["i2", "i10"]);
  expect((await s.listFor("b")).map((i) => i.id)).toEqual(["i2", "i10"]);
  expect((await s.listFor("a"))[0]!.loan).toMatchObject({ to: "b", dueAt: 100 });
  expect(await s.listFor("z")).toEqual([]);
}

describe("InMemoryItemStore", () => {
  it("guarda, actualiza y lista por dueño o portador", () => contract(new InMemoryItemStore()));
});

describe.skipIf(!url)("PgItemStore", () => {
  let handle: DbHandle;
  const world = `it-${randomUUID().slice(0, 8)}`;
  beforeAll(async () => {
    handle = createDb(url!);
    await handle.db.insert(worlds).values({ id: world, name: world, map: "seeds/town.tmj" });
  });
  afterAll(async () => {
    await handle.db.delete(worlds).where(eq(worlds.id, world));
    await handle.pool.end();
  });

  it("guarda, actualiza y lista por dueño o portador", () =>
    contract(new PgItemStore(handle.db, world)));
});
