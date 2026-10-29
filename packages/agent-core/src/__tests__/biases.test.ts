import { describe, expect, it } from "vitest";
import { agentMockResponder } from "../agent/mock-responder";
import { LLMClient } from "../llm/client";
import { CostTracker } from "../llm/cost-tracker";
import { MockProvider } from "../llm/mock";
import { ModelRouter } from "../llm/router";
import { LLMGistCompressor, LLMReconsolidator } from "../memory/human";
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
    const list = s.store.listActive.bind(s.store);
    s.store.listActive = async (id, opts) => {
      reads++;
      return list(id, opts);
    };
    expect(await s.memory.intrude(s.base)).toBeNull();
    expect(reads).toBe(0);
  });
});

describe("falsos recuerdos controlados", () => {
  async function setup(roll: number, suggestibility: number) {
    const store = new InMemoryStore();
    const llm = new LLMClient(
      new MockProvider(agentMockResponder),
      new ModelRouter({ fast: "mock-fast", reflection: "mock-reflection" }),
      new CostTracker({}),
    );
    const memory = new MemorySystem({
      store,
      embedder: new HashEmbedder(),
      reconsolidator: new LLMReconsolidator(llm),
      rng: () => roll,
      profiles: { x: { ...NEUTRAL_PROFILE, suggestibility } },
    });
    const effects: string[] = [];
    memory.onEffect((e) => effects.push(e.kind));
    // Importancia 5, fuerza 0.2: un recuerdo ya vago.
    const m = await memory.remember(
      {
        agentId: "x",
        text: "Hablé con Rafael en la plaza sobre el lago",
        type: "observation",
        importance: 5,
        strength: 0.2,
      },
      0,
    );
    const recall = { system: "x", moodLabel: "neutral", socialSummary: async () => "" };
    // Un día después (antigüedad mínima): fuerza ≈ 0.2 · e^(−24/16.6) ≈ 0.05.
    await memory.recallByIds([m.id], 24 * 60, 0, recall);
    return { store, m, effects };
  }

  it("con baja probabilidad (× sugestionabilidad) rellena huecos y queda marcado", async () => {
    // p = 0.015 × sugestionabilidad × (1 − fuerza ≈ 0.95): 0.018 queda por encima con 1 y
    // por debajo con 1.5.
    const neutral = await setup(0.018, 1);
    expect((await neutral.store.get(neutral.m.id))!.meta.falseMemory).toBeUndefined();
    const { store, m, effects } = await setup(0.018, 1.5);
    const after = (await store.get(m.id))!;
    expect(after.meta.falseMemory).toBe(true);
    expect(after.text).not.toBe(m.text);
    expect(after.text).toMatch(/^Hablé con Rafael en la plaza, y /);
    expect(effects).toContain("false_memory");
    const [v] = await store.versions(m.id);
    expect(v).toMatchObject({ text: m.text, reason: expect.stringMatching(/falso recuerdo/) });
    const audit = await store.audit("x");
    expect(audit[0]).toMatchObject({ action: "false_memory" });
  });

  it("lo reciente no se rellena (solo puede reconsolidarse)", async () => {
    const store = new InMemoryStore();
    const memory = new MemorySystem({
      store,
      embedder: new HashEmbedder(),
      reconsolidator: {
        reconsolidate: async () => null,
        confabulate: async () => ({ text: "x", emotionalValence: 0 }),
      },
      rng: () => 0,
    });
    const m = await memory.remember(
      { agentId: "x", text: "algo nítido", type: "observation", importance: 5 },
      0,
    );
    await memory.recallByIds([m.id], 1, 0, {
      system: "x",
      moodLabel: "",
      socialSummary: async () => "",
    });
    expect((await store.get(m.id))!.meta.falseMemory).toBeUndefined();
  });

  it("al volverse vago en el mantenimiento, a veces se reconstruye en vez de quedarse con la esencia", async () => {
    const store = new InMemoryStore();
    const llm = new LLMClient(
      new MockProvider(agentMockResponder),
      new ModelRouter({ fast: "mock-fast", reflection: "mock-reflection" }),
      new CostTracker({}),
    );
    const memory = new MemorySystem({
      store,
      embedder: new HashEmbedder(),
      reconsolidator: new LLMReconsolidator(llm),
      rng: () => 0,
    });
    const m = await memory.remember(
      {
        agentId: "x",
        text: "Vi a Rafael discutir en la plaza",
        type: "observation",
        importance: 5,
      },
      0,
    );
    const maintenance = new MemoryMaintenance({ memory, gist: new LLMGistCompressor(llm) });
    await maintenance.run(owner, 0, []);
    const r = await maintenance.run(owner, 40 * 60, []);
    expect(r.falseMemories).toEqual([m.id]);
    expect(r.gists).toEqual([]);
    expect((await store.get(m.id))!.meta.falseMemory).toBe(true);
    // La hora siguiente, la esencia sale ya del recuerdo reconstruido.
    const next = await maintenance.run(owner, 41 * 60, []);
    expect(next.gists).toEqual([m.id]);
  });
});
