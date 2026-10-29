import { describe, expect, it } from "vitest";
import { MemoryConfig } from "../memory/config";
import { HashEmbedder } from "../memory/hash-embedder";
import { InMemoryStore } from "../memory/in-memory-store";
import { MemoryMaintenance } from "../memory/maintenance";
import { MemorySystem } from "../memory/memory-system";
import { NEUTRAL_PROFILE, resolveProfile } from "../memory/psychology";

const cfg = MemoryConfig.parse({});
const DAY = 24 * 60;
const owner = { agentId: "x", agentName: "X", system: "x" };
const avg = { openness: 0.5, conscientiousness: 0.5, extraversion: 0.5, agreeableness: 0.5 };

describe("sesgo de negatividad", () => {
  it("lo negativo dura más que lo positivo de igual intensidad, y más con neuroticismo", async () => {
    const neurotic = resolveProfile(
      { age: 40, personality: { ...avg, neuroticism: 1 } },
      cfg.profile,
    );
    const stable = resolveProfile(
      { age: 40, personality: { ...avg, neuroticism: 0 } },
      cfg.profile,
    );
    expect(neurotic.negativityBias).toBeGreaterThan(stable.negativityBias);
    const memory = new MemorySystem({
      store: new InMemoryStore(),
      embedder: new HashEmbedder(),
      profiles: { x: { ...NEUTRAL_PROFILE, negativityBias: 1.5 } },
    });
    const base = { agentId: "x", text: "algo", type: "observation" as const, importance: 5 };
    const bad = await memory.remember({ ...base, emotionalValence: -0.8 }, 0);
    const good = await memory.remember({ ...base, emotionalValence: 0.8 }, 0);
    expect(bad.stability / good.stability).toBeCloseTo(1 + 0.8 * 0.5);
  });
});

describe("sesgo de desvanecimiento afectivo", () => {
  async function setup() {
    const store = new InMemoryStore();
    const memory = new MemorySystem({ store, embedder: new HashEmbedder() });
    const base = { agentId: "x", type: "semantic" as const, importance: 9 };
    const bad = await memory.remember({ ...base, text: "La discusión", emotionalValence: -0.8 }, 0);
    const good = await memory.remember({ ...base, text: "La fiesta", emotionalValence: 0.8 }, 0);
    const mild = await memory.remember({ ...base, text: "Un día", emotionalValence: 0.1 }, 0);
    return { store, memory, bad, good, mild, maintenance: new MemoryMaintenance({ memory }) };
  }

  it("lo negativo se suaviza antes que lo positivo, con versión y auditoría", async () => {
    const { store, bad, good, mild, maintenance } = await setup();
    await maintenance.run(owner, 0, []);
    const r = await maintenance.run(owner, 12 * DAY, []);
    expect(r.faded.sort()).toEqual([bad.id, good.id].sort());
    expect((await store.get(bad.id))!.emotionalValence).toBeCloseTo(-0.4);
    expect((await store.get(good.id))!.emotionalValence).toBeCloseTo(0.8 * 0.5 ** (12 / 40), 2);
    expect((await store.get(mild.id))!.emotionalValence).toBe(0.1);
    const versions = await store.versions(bad.id);
    expect(versions[0]).toMatchObject({
      emotionalValence: -0.8,
      reason: "desvanecimiento afectivo",
    });
    const audit = (await store.audit("x")).filter((a) => a.action === "affect_faded");
    expect(audit).toHaveLength(2);
    expect(audit.find((a) => a.memoryId === bad.id)!.reason).toMatch(/duele.*-0\.80 → -0\.40/);
  });

  it("los cambios pequeños no se aplican hasta que suman un salto", async () => {
    const { store, bad, maintenance } = await setup();
    await maintenance.run(owner, 0, []);
    expect((await maintenance.run(owner, 1 * DAY, [])).faded).toEqual([]);
    // El reloj del desvanecimiento sigue contando desde la creación: al cabo de 3 días, sí.
    expect((await maintenance.run(owner, 3 * DAY, [])).faded).toContain(bad.id);
    expect((await store.get(bad.id))!.meta.affectAt).toBe(3 * DAY);
  });
});

describe("recuerdos intrusivos", () => {
  async function setup(rolls: number[]) {
    let i = 0;
    const store = new InMemoryStore();
    const memory = new MemorySystem({
      store,
      embedder: new HashEmbedder(),
      rng: () => rolls[i++] ?? 0.99,
    });
    const effects: string[] = [];
    memory.onEffect((e) => effects.push(e.kind));
    const bad = await memory.remember(
      {
        agentId: "x",
        text: "Discutí a gritos con Rafael en la taberna",
        type: "observation",
        importance: 8,
        emotionalValence: -0.8,
        people: ["rafael"],
        placeId: "taberna",
      },
      0,
    );
    await memory.remember(
      {
        agentId: "x",
        text: "Un buen día",
        type: "observation",
        importance: 8,
        emotionalValence: 0.8,
      },
      0,
    );
    const base = {
      agentId: "x",
      now: 60,
      minutes: 10,
      moodValence: 0,
      neuroticism: 0.5,
      placeId: "plaza",
      present: [] as string[],
    };
    return { store, memory, effects, bad, base };
  }
  const perTick = (perHour: number) => 1 - Math.pow(1 - perHour, 10 / 60);

  it("casi nunca sin pistas; con una pista (lugar o persona) es más probable", async () => {
    const roll = perTick(0.02) * 2; // por encima del umbral sin pista, por debajo con pista
    const quiet = await setup([roll]);
    expect(await quiet.memory.intrude(quiet.base)).toBeNull();
    const cued = await setup([roll, 0]);
    const hit = await cued.memory.intrude({ ...cued.base, placeId: "taberna" });
    expect(hit?.memory.id).toBe(cued.bad.id);
    expect(cued.effects).toEqual(["intrusive"]);
    // Rumiarlo lo refuerza.
    expect((await cued.store.get(cued.bad.id))!.accessCount).toBe(1);
  });

  it("el ánimo bajo y el neuroticismo lo hacen más probable; solo salen recuerdos negativos", async () => {
    const roll = perTick(0.02) * 1.5;
    const calm = await setup([roll]);
    expect(await calm.memory.intrude(calm.base)).toBeNull();
    const low = await setup([roll, 0]);
    const hit = await low.memory.intrude({ ...low.base, moodValence: -0.8, neuroticism: 0.9 });
    expect(hit?.memory.emotionalValence).toBeLessThan(0);
  });

  it("la tirada que falla no lee la memoria", async () => {
    const s = await setup([0.99]);
    let reads = 0;
    const list = s.store.listByAgent.bind(s.store);
    s.store.listByAgent = async (id) => {
      reads++;
      return list(id);
    };
    expect(await s.memory.intrude(s.base)).toBeNull();
    expect(reads).toBe(0);
  });
});
