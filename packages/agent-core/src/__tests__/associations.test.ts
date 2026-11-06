/** Pensamiento por asociación (fase 3.6): recuperar por pista, sin LLM, con refuerzo. */
import { describe, expect, it } from "vitest";
import { HashEmbedder } from "../memory/hash-embedder";
import { InMemoryStore } from "../memory/in-memory-store";
import { MemorySystem } from "../memory/memory-system";
import { seededRng } from "../util/random";

const HOUR = 60;

function setup() {
  const store = new InMemoryStore();
  let n = 0;
  const memory = new MemorySystem({
    store,
    embedder: new HashEmbedder(),
    rng: seededRng(3),
    idGenerator: () => `m${++n}`,
  });
  return { store, memory };
}

async function seed(memory: MemorySystem) {
  const cafe = await memory.remember(
    {
      agentId: "lucia",
      text: "Discutí con Mateo en el café por lo del alquiler",
      type: "observation",
      importance: 7,
      emotionalValence: -0.7,
      people: ["mateo"],
      placeId: "cafe_ola",
    },
    HOUR,
  );
  const lake = await memory.remember(
    {
      agentId: "lucia",
      text: "Dibujé los patos del lago al atardecer",
      type: "observation",
      importance: 4,
      emotionalValence: 0.5,
      placeId: "lago",
    },
    2 * HOUR,
  );
  const plan = await memory.remember(
    {
      agentId: "lucia",
      text: "Plan: ir al café",
      type: "plan",
      importance: 3,
      placeId: "cafe_ola",
    },
    3 * HOUR,
  );
  return { cafe, lake, plan };
}

describe("recallByCue", () => {
  it("un lugar trae lo que pasó allí (no lo de otros sitios ni los planes)", async () => {
    const { memory } = setup();
    const { cafe } = await seed(memory);
    const hits = await memory.recallByCue({
      agentId: "lucia",
      now: 5 * HOUR,
      moodValence: 0,
      query: "Café La Ola",
      placeId: "cafe_ola",
      k: 2,
    });
    expect(hits.map((h) => h.memory.id)).toEqual([cafe.id]);
  });

  it("una persona trae lo que vivió con ella", async () => {
    const { memory } = setup();
    const { cafe } = await seed(memory);
    const hits = await memory.recallByCue({
      agentId: "lucia",
      now: 5 * HOUR,
      moodValence: 0,
      query: "Mateo Ruiz",
      personId: "mateo",
    });
    expect(hits[0]?.memory.id).toBe(cafe.id);
  });

  it("recordar refuerza (como cualquier recuperación) y respeta lo que ya tiene en la cabeza", async () => {
    const { memory, store } = setup();
    const { cafe } = await seed(memory);
    const before = (await store.get(cafe.id))!;
    await memory.recallByCue({
      agentId: "lucia",
      now: 30 * HOUR,
      moodValence: 0,
      query: "Mateo Ruiz",
      personId: "mateo",
    });
    const after = (await store.get(cafe.id))!;
    expect(after.accessCount).toBe(before.accessCount + 1);
    expect(after.stability).toBeGreaterThan(before.stability);
    const again = await memory.recallByCue({
      agentId: "lucia",
      now: 31 * HOUR,
      moodValence: 0,
      query: "Mateo Ruiz",
      personId: "mateo",
      exclude: [cafe.id],
    });
    expect(again).toEqual([]);
  });

  it("lo trivial y lo de hace un momento no «vienen a la cabeza»", async () => {
    const { memory } = setup();
    await seed(memory);
    const ask = (minImportance: number, minAgeMinutes: number, now = 5 * HOUR) =>
      memory.recallByCue({
        agentId: "lucia",
        now,
        moodValence: 0,
        query: "Lago",
        placeId: "lago",
        minImportance,
        minAgeMinutes,
      });
    expect(await ask(5, 0)).toEqual([]); // el del lago es de importancia 4
    expect(await ask(3, 4 * HOUR)).toEqual([]); // y de hace 3 horas
    expect((await ask(3, 60)).length).toBe(1);
  });

  it("sin nada que ver con la pista, no trae nada", async () => {
    const { memory } = setup();
    await seed(memory);
    const hits = await memory.recallByCue({
      agentId: "lucia",
      now: 5 * HOUR,
      moodValence: 0,
      query: "Huerto",
      placeId: "huerto",
    });
    expect(hits).toEqual([]);
  });
});
