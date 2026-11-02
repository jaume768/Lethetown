/** Habilidades y saberes en RAM y en Postgres (este, solo con TEST_DATABASE_URL). */
import { randomUUID } from "node:crypto";
import type { Lore, LoreHolder, SkillState } from "@lethetown/shared";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb } from "./client";
import { worlds } from "./schema";
import {
  InMemoryLoreStore,
  InMemorySkillStore,
  PgLoreStore,
  PgSkillStore,
  type LoreStore,
  type SkillStore,
} from "./skills";

const url = process.env.TEST_DATABASE_URL;

const skill: SkillState = {
  agentId: "ines",
  skill: "photography",
  level: 0.35,
  peak: 0.35,
  practiceMinutes: 0,
  lastUsedAt: 400,
  learnedFrom: null,
  history: [{ at: 400, level: 0.35, reason: "de partida" }],
  updatedAt: 400,
};
const lore: Lore = {
  id: "l1",
  kind: "recipe",
  title: "Las magdalenas de Francisca",
  skill: "baking",
  placeId: "panaderia",
  elements: [{ id: "e1", text: "cuatro huevos", variants: ["cinco huevos"] }],
  origin: { agentId: null, person: "Francisca" },
  createdAt: 400,
  lostAt: null,
};
const holder: LoreHolder = {
  loreId: "l1",
  agentId: "julian",
  fidelity: 0.9,
  elements: [{ id: "e1", text: "cuatro huevos", altered: false }],
  learnedFrom: null,
  learnedAt: 400,
  lastUsedAt: 400,
  forgottenAt: null,
};

function contract(name: string, make: () => { skills: SkillStore; lore: LoreStore }) {
  describe(name, () => {
    it("guarda, actualiza y lista por agente", async () => {
      const { skills, lore: store } = make();
      await skills.upsert(skill);
      await skills.upsert({ ...skill, level: 0.5, learnedFrom: "valentina", practiceMinutes: 600 });
      expect(await skills.listFor("ines")).toEqual([
        { ...skill, level: 0.5, learnedFrom: "valentina", practiceMinutes: 600 },
      ]);
      expect(await skills.listFor("leo")).toEqual([]);
      await store.upsertLore(lore);
      await store.upsertHolder(holder);
      await store.upsertHolder({
        ...holder,
        agentId: "ines",
        learnedFrom: "julian",
        fidelity: 0.7,
      });
      await store.upsertLore({ ...lore, lostAt: 900 });
      expect((await store.lore())[0]!.lostAt).toBe(900);
      expect((await store.holders()).map((h) => h.agentId).sort()).toEqual(["ines", "julian"]);
    });
  });
}

contract("en RAM", () => ({ skills: new InMemorySkillStore(), lore: new InMemoryLoreStore() }));

describe.skipIf(!url)("en Postgres", () => {
  const world = `sk-${randomUUID().slice(0, 8)}`;
  let handle: ReturnType<typeof createDb>;
  beforeAll(async () => {
    handle = createDb(url!);
    await handle.db.insert(worlds).values({ id: world, name: world, map: "seeds/town.tmj" });
  });
  afterAll(async () => {
    await handle.db.delete(worlds).where(eq(worlds.id, world));
    await handle.pool.end();
  });
  contract("PgSkillStore y PgLoreStore", () => ({
    skills: new PgSkillStore(handle.db, world),
    lore: new PgLoreStore(handle.db, world),
  }));
});
