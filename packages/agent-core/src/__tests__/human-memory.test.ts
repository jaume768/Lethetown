import { describe, expect, it } from "vitest";
import { agentMockResponder } from "../agent/mock-responder";
import { LLMClient } from "../llm/client";
import { CostTracker } from "../llm/cost-tracker";
import { MockProvider } from "../llm/mock";
import { ModelRouter } from "../llm/router";
import { MemoryConfig } from "../memory/config";
import { currentStrength } from "../memory/decay";
import { HashEmbedder } from "../memory/hash-embedder";
import {
  InMemorySocialProfileStore,
  LLMConsolidator,
  LLMEpisodeSummarizer,
  LLMGistCompressor,
  LLMReconsolidator,
  RandomSourceConfuser,
  applySocialUpdate,
  socialNote,
  updateSocialAfterConversation,
  type MemoryOwner,
} from "../memory/human";
import { InMemoryStore } from "../memory/in-memory-store";
import { MemoryMaintenance } from "../memory/maintenance";
import { MemorySystem, type MemoryEffect } from "../memory/memory-system";
import { seededRng } from "../util/random";

const HOUR = 60;
const owner: MemoryOwner = {
  agentId: "lucia",
  agentName: "Lucía",
  system: "Eres Lucía, 28 años, habitante de un pequeño pueblo.",
};
const agents = [
  { id: "lucia", name: "Lucía Ferrer" },
  { id: "mateo", name: "Mateo Ruiz" },
  { id: "carmen", name: "Carmen Vidal" },
];

function setup(overrides: Record<string, unknown> = {}) {
  const provider = new MockProvider(agentMockResponder);
  const llm = new LLMClient(
    provider,
    new ModelRouter({ fast: "mock-fast", reflection: "mock-reflection" }),
    new CostTracker({}),
  );
  const config = MemoryConfig.parse(overrides);
  const store = new InMemoryStore();
  const effects: MemoryEffect[] = [];
  let n = 0;
  const memory = new MemorySystem({
    store,
    embedder: new HashEmbedder(),
    config,
    reconsolidator: new LLMReconsolidator(llm),
    rng: seededRng(42),
    idGenerator: () => `m${++n}`,
  });
  memory.onEffect((e) => effects.push(e));
  const social = new InMemorySocialProfileStore();
  return { provider, llm, memory, store, social, effects, config };
}

describe("Consolidator (reflexión nocturna)", () => {
  it("crea reflexiones con citas, refuerza lo citado, debilita lo trivial y actualiza fichas", async () => {
    const { llm, memory, store, social } = setup();
    const talk = await memory.remember(
      {
        agentId: "lucia",
        text: 'Mateo Ruiz me dijo: "¡Hola!"',
        type: "observation",
        importance: 5,
        people: ["mateo"],
      },
      8 * HOUR,
    );
    const trivial = await memory.remember(
      { agentId: "lucia", text: "Vi pasar una paloma", type: "observation", importance: 1 },
      9 * HOUR,
    );
    const consolidator = new LLMConsolidator(llm, memory, social, () => agents);
    const result = await consolidator.consolidate(owner, 0, 22 * HOUR);

    const reflections = result.created.filter((m) => m.type === "reflection");
    expect(reflections.length).toBeGreaterThan(0);
    expect(reflections[0]!.links).toContain(talk.id);
    expect(reflections[0]!.source).toBe("inferido");
    expect(result.reinforced).toContain(talk.id);
    expect(result.weakened).toContain(trivial.id);
    expect((await store.get(trivial.id))!.strength).toBeCloseTo(0.5);
    expect((await social.get("lucia", "mateo"))?.affinity).toBeGreaterThan(0);
    const audit = await store.audit("lucia");
    expect(audit.some((a) => a.action === "weakened" && a.memoryId === trivial.id)).toBe(true);
  });
});

describe("Fichas sociales", () => {
  it("se actualizan tras una conversación y acotan afinidad y confianza", async () => {
    const { llm, social } = setup();
    const p = await updateSocialAfterConversation(llm, social, {
      owner,
      other: { id: "mateo", name: "Mateo Ruiz" },
      transcript: ['Mateo: "¡Qué tal!"', 'Yo: "Muy bien"'],
      now: 10 * HOUR,
    });
    expect(p.summary).toContain("Mateo");
    expect(p.affinity).toBeGreaterThan(0);
    const big = await applySocialUpdate(social, {
      ownerId: "lucia",
      aboutId: "mateo",
      affinityDelta: 5,
      trustDelta: -5,
      now: 11 * HOUR,
    });
    expect(big.affinity).toBe(1);
    expect(big.trust).toBe(0);
    expect(socialNote(big, "Mateo")).toMatch(/te cae muy bien.*no te fías/);
  });
});

describe("Mantenimiento: olvido, esencia y confusión de fuente", () => {
  it("marca lo olvidado (una vez), emite el efecto y lo registra con motivo", async () => {
    const { memory, store, effects, llm } = setup();
    const m = await memory.remember(
      { agentId: "lucia", text: "Un detalle sin importancia", type: "observation", importance: 1 },
      0,
    );
    const maintenance = new MemoryMaintenance({ memory, gist: new LLMGistCompressor(llm) });
    await maintenance.run(owner, 100 * HOUR, []);
    await maintenance.run(owner, 101 * HOUR, []);
    expect((await store.get(m.id))!.forgottenAt).toBe(100 * HOUR);
    expect(effects.filter((e) => e.kind === "forget" && e.memoryId === m.id)).toHaveLength(1);
    const audit = await store.audit("lucia");
    expect(audit.filter((a) => a.action === "forgotten")).toHaveLength(1);
    expect(audit[0]!.reason).toMatch(/umbral de olvido/);
  });

  it("al volverse vago genera y guarda la esencia; el texto completo se conserva", async () => {
    const { memory, store, llm, effects } = setup();
    const m = await memory.remember(
      {
        agentId: "lucia",
        text: 'Carmen me dijo: "El jueves llega el cartero a las 10"',
        type: "observation",
        // Lo de importancia < gist.minImportance (4) no se resume con el LLM.
        importance: 4,
      },
      0,
    );
    const stability = (await store.get(m.id))!.stability;
    const now = Math.ceil(stability * Math.log(1 / 0.2) * HOUR);
    expect(currentStrength((await store.get(m.id))!, now)).toBeLessThan(0.3);
    await new MemoryMaintenance({ memory, gist: new LLMGistCompressor(llm) }).run(owner, now, []);
    const after = (await store.get(m.id))!;
    expect(after.gist).toBeTruthy();
    expect(after.gist).not.toContain("10");
    expect(after.text).toContain("10");
    expect(effects.some((e) => e.kind === "gist")).toBe(true);
  });

  it("con el tiempo puede confundir la fuente y guarda la versión anterior", async () => {
    const { memory, store } = setup({
      sourceConfusion: { dailyProbability: 1, toLivedShare: 1, minAgeHours: 0 },
    });
    const m = await memory.remember(
      {
        agentId: "lucia",
        text: "Dicen que Mateo cierra el café",
        type: "observation",
        importance: 7,
        source: "contado por carmen",
      },
      0,
    );
    const maintenance = new MemoryMaintenance({
      memory,
      confuser: new RandomSourceConfuser(seededRng(1), 1),
    });
    await maintenance.run(owner, 0, ["mateo", "carmen"]);
    await maintenance.run(owner, 48 * HOUR, ["mateo", "carmen"]);
    expect((await store.get(m.id))!.source).toBe("vivido");
    const versions = await store.versions(m.id);
    expect(versions[0]).toMatchObject({
      source: "contado por carmen",
      reason: "confusión de fuente",
    });
  });

  it("RandomSourceConfuser puede atribuirlo a otra persona", () => {
    const confuser = new RandomSourceConfuser(seededRng(3), 0);
    const m = { source: "contado por carmen" } as Parameters<typeof confuser.confuse>[0];
    expect(confuser.confuse(m, 1, ["mateo", "carmen"])).toBe("contado por mateo");
    expect(confuser.confuse({ ...m, source: "vivido" }, 1, ["mateo"])).toBeNull();
  });
});

describe("Reconsolidación", () => {
  it("al recordar puede reescribir el recuerdo según el ánimo y guarda el historial", async () => {
    const { memory, store, effects } = setup({
      reconsolidation: { probability: 1, minImportance: 1 },
    });
    const m = await memory.remember(
      {
        agentId: "lucia",
        text: "Comí con Mateo en el parque",
        type: "observation",
        importance: 6,
        people: ["mateo"],
      },
      0,
    );
    const got = await memory.retrieve({
      agentId: "lucia",
      query: "Mateo parque",
      now: HOUR,
      moodValence: -0.6,
      recall: { system: owner.system, moodLabel: "triste", socialSummary: async () => "" },
    });
    expect(got[0]!.memory.text).toMatch(/más triste/);
    const versions = await store.versions(m.id);
    expect(versions).toHaveLength(1);
    expect(versions[0]!.text).toBe("Comí con Mateo en el parque");
    expect(effects.some((e) => e.kind === "reconsolidate")).toBe(true);
    expect((await store.audit("lucia"))[0]!.action).toBe("reconsolidated");
  });

  it("sin contexto de recuerdo no reescribe", async () => {
    const { memory, store } = setup({ reconsolidation: { probability: 1, minImportance: 1 } });
    const m = await memory.remember(
      { agentId: "lucia", text: "Comí con Mateo", type: "observation", importance: 6 },
      0,
    );
    await memory.retrieve({ agentId: "lucia", query: "Mateo", now: HOUR, moodValence: 0 });
    expect((await store.get(m.id))!.text).toBe("Comí con Mateo");
  });
});

describe("Olvido por presupuesto", () => {
  const filler = (i: number) =>
    `Recuerdo número ${i} de una tarde cualquiera en el café con Mateo, sin nada especial`;

  it("borra primero los triviales viejos y nunca toca los planes recientes", async () => {
    const { memory, store, llm } = setup({ budget: { tokensPerAgent: 25, trivialMinAgeHours: 1 } });
    const plan = await memory.remember(
      { agentId: "lucia", text: "Mi plan para hoy: dibujar", type: "plan", importance: 1 },
      47 * HOUR,
    );
    const trivial = await memory.remember(
      { agentId: "lucia", text: filler(1), type: "observation", importance: 1 },
      0,
    );
    const important = await memory.remember(
      {
        agentId: "lucia",
        text: "Mateo me confesó que le gusto",
        type: "observation",
        importance: 9,
      },
      0,
    );
    const report = await new MemoryMaintenance({
      memory,
      summarizer: new LLMEpisodeSummarizer(llm),
    }).run(owner, 48 * HOUR, []);
    expect(report.deleted).toContain(trivial.id);
    expect(await store.get(plan.id)).toBeDefined();
    expect(await store.get(important.id)).toBeDefined();
    const audit = await store.audit("lucia");
    expect(audit.find((a) => a.memoryId === trivial.id)?.reason).toMatch(/trivial/);
  });

  it("resume grupos de episodios parecidos (con enlaces) y archiva los originales", async () => {
    const { memory, store, llm } = setup({
      budget: {
        tokensPerAgent: 80,
        trivialImportanceMax: 1,
        clusterMinSize: 3,
        clusterSimilarity: 0.3,
      },
    });
    const ids = [];
    for (let i = 0; i < 4; i++) {
      ids.push(
        (
          await memory.remember(
            {
              agentId: "lucia",
              text: filler(i),
              type: "observation",
              importance: 4,
              people: ["mateo"],
              placeId: "cafe_ola",
            },
            i * HOUR,
          )
        ).id,
      );
    }
    const report = await new MemoryMaintenance({
      memory,
      summarizer: new LLMEpisodeSummarizer(llm),
    }).run(owner, 10 * HOUR, []);
    expect(report.summaries).toHaveLength(1);
    const summary = (await store.get(report.summaries[0]!))!;
    expect(summary.type).toBe("reflection");
    expect(summary.links.length).toBeGreaterThanOrEqual(3);
    for (const id of summary.links) expect((await store.get(id))!.status).toBe("archived");
    // Los archivados ya no se recuperan.
    const got = await memory.retrieve({
      agentId: "lucia",
      query: "café Mateo",
      now: 10 * HOUR,
      moodValence: 0,
      k: 10,
    });
    expect(got.every((s) => s.memory.status === "active")).toBe(true);
  });

  it("si aún sobra, descarta lo de menor importancia × fuerza", async () => {
    const { memory, store } = setup({ budget: { tokensPerAgent: 15, trivialImportanceMax: 1 } });
    const low = await memory.remember(
      {
        agentId: "lucia",
        text: "Algo de importancia media baja que pasó",
        type: "observation",
        importance: 3,
      },
      0,
    );
    const high = await memory.remember(
      {
        agentId: "lucia",
        text: "Algo muy importante que pasó aquel día",
        type: "observation",
        importance: 8,
      },
      0,
    );
    await new MemoryMaintenance({ memory }).run(owner, HOUR, []);
    expect(await store.get(low.id)).toBeUndefined();
    expect(await store.get(high.id)).toBeDefined();
    expect((await store.audit("lucia")).find((a) => a.memoryId === low.id)?.reason).toMatch(
      /importancia × fuerza/,
    );
  });
});
