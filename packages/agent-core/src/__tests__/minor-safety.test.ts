import { readFileSync } from "node:fs";
import { AgentSeed, parseTiledMap, seedIsMinor } from "@lethetown/shared";
import { describe, expect, it } from "vitest";
import { Agent, type DecideInput } from "../agent/agent";
import { writeChronicle } from "../agent/chronicle";
import {
  MinorGuard,
  hasStrongRomance,
  minorsOf,
  minorsRule,
  type SafetyBlock,
} from "../agent/minor-safety";
import { agentMockResponder } from "../agent/mock-responder";
import { LLMClient } from "../llm/client";
import { CostTracker } from "../llm/cost-tracker";
import { MockProvider, type MockResponder } from "../llm/mock";
import { ModelRouter } from "../llm/router";
import { HashEmbedder } from "../memory/hash-embedder";
import {
  InMemorySocialProfileStore,
  LLMConsolidator,
  updateSocialAfterConversation,
} from "../memory/human";
import { InMemoryStore } from "../memory/in-memory-store";
import { MemorySystem } from "../memory/memory-system";

const places = parseTiledMap(
  JSON.parse(readFileSync(new URL("../../../../seeds/town.tmj", import.meta.url), "utf8")),
).places;

const base = { traits: ["amable"], description: "Vecino del pueblo.", homeId: "casa_azul" };
const hugo = AgentSeed.parse({ ...base, id: "hugo", name: "Hugo Peña", age: 29 });
const leo = AgentSeed.parse({ ...base, id: "leo", name: "Leo Gil", age: 10 });
const ines = AgentSeed.parse({ ...base, id: "ines", name: "Inés Ortega", age: 16 });
const marta = AgentSeed.parse({ ...base, id: "marta", name: "Marta Gil", age: 37 });
const minors = minorsOf([hugo, leo, ines, marta]);

/**
 * El mock de siempre, salvo las tareas que el test sobrescribe (el "LLM" que se porta mal).
 * `failModeration`: cuántas moderaciones fallan antes de que vuelva a funcionar.
 */
function setup(overrides: Record<string, MockResponder> = {}, failModeration = 0) {
  let failures = failModeration;
  const provider = new MockProvider((req) => {
    if (req.meta.task === "moderate_minor" && failures-- > 0) throw new Error("sin red");
    return overrides[req.meta.task]?.(req) ?? agentMockResponder(req);
  });
  const llm = new LLMClient(
    provider,
    new ModelRouter({ fast: "mock-fast", reflection: "mock-reflection" }),
    new CostTracker({}),
  );
  const blocks: SafetyBlock[] = [];
  const guard = new MinorGuard({
    minors,
    llm,
    onBlock: (b) => blocks.push(b),
    sleep: async () => {},
  });
  const store = new InMemoryStore();
  const memory = new MemorySystem({ store, embedder: new HashEmbedder(), guard });
  return { provider, llm, guard, blocks, store, memory };
}

const EMPTY: Omit<DecideInput, "salient"> = {
  present: [],
  heard: [],
  conversationWith: null,
  objectStates: [],
  weather: "sunny",
  socialNotes: [],
};

describe("menores: datos y prompt", () => {
  it("isMinor se deduce de la edad, salvo que se indique", () => {
    expect(seedIsMinor(leo)).toBe(true);
    expect(seedIsMinor(hugo)).toBe(false);
    expect(seedIsMinor({ age: 17, isMinor: false })).toBe(false);
    expect(minors.map((m) => m.id)).toEqual(["leo", "ines"]);
  });

  it("el prompt de identidad de todos lista a los menores y prohíbe el romance con ellos", () => {
    const { llm, memory } = setup();
    const adult = new Agent(hugo, { llm, memory, places, minors });
    const child = new Agent(leo, { llm, memory, places, minors });
    expect(adult.system).toContain("Leo Gil (10 años), Inés Ortega (16 años)");
    expect(adult.system).toMatch(/ningún adulto flirtea con un menor/);
    expect(adult.system).not.toContain("eres menor de edad");
    expect(child.system).toContain("Tú tienes 10 años: eres menor de edad");
    expect(minorsRule([], "hugo")).toBe("");
  });
});

describe("MinorGuard", () => {
  it("sin menores implicados no revisa nada ni llama al LLM", async () => {
    const { guard, provider } = setup();
    expect(await guard.allows("Hugo está enamorado de Lucía", { kind: "memory" })).toBe(true);
    expect(await guard.allows("leo un libro en la biblioteca", { kind: "memory" })).toBe(true);
    expect(provider.calls).toHaveLength(0);
  });

  it("léxico romántico claro con un menor: se descarta sin preguntar", async () => {
    const { guard, blocks, provider } = setup();
    expect(await guard.allows("Creo que Inés es mi novia", { kind: "memory" })).toBe(false);
    expect(await guard.allows("Quiero ligar con ella", { kind: "speech", actors: ["ines"] })).toBe(
      false,
    );
    expect(blocks).toHaveLength(2);
    expect(blocks[0]!.reason).toMatch(/Inés Ortega/);
    expect(provider.calls).toHaveLength(0);
    expect(hasStrongRomance("Estoy ENAMORADO")).toBe(true);
  });

  it("léxico ambiguo: lo decide la moderación (familia sí, pareja no)", async () => {
    const { guard, provider } = setup();
    const family = "Mamá me dijo: «te quiero, cariño» antes de ir al colegio";
    expect(await guard.allows(family, { kind: "memory", actors: ["leo"] })).toBe(true);
    expect(await guard.allows("Leo, estás guapísimo hoy, mi amor", { kind: "speech" })).toBe(false);
    expect(provider.calls.map((c) => c.meta.task)).toEqual(["moderate_minor", "moderate_minor"]);
    // El mismo texto otra vez no vuelve a preguntar.
    await guard.allows(family, { kind: "memory", actors: ["leo"] });
    expect(provider.calls).toHaveLength(2);
  });

  it("si la moderación falla, se repite; si sigue fallando, se descarta (fail-closed)", async () => {
    const { guard, blocks, provider } = setup({}, Infinity);
    expect(await guard.allows("Te quiero mucho, Leo", { kind: "speech" })).toBe(false);
    expect(blocks[0]!.reason).toMatch(/no se pudo moderar/);
    expect(blocks[0]!.cause).toBe("error");
    // Una vez y dos repeticiones.
    expect(provider.calls).toHaveLength(3);
    expect(guard.stats()).toEqual({ blockedContent: 0, blockedError: 1, retries: 2 });
  });

  it("un fallo pasajero de la moderación no bloquea: se repite y decide el contenido", async () => {
    const { guard, blocks } = setup({}, 1);
    const family = "Mamá me dijo: «te quiero, cariño» antes de ir al colegio";
    expect(await guard.allows(family, { kind: "memory", actors: ["leo"] })).toBe(true);
    expect(blocks).toHaveLength(0);
    expect(await guard.allows("Leo, estás guapísimo hoy, mi amor", { kind: "speech" })).toBe(false);
    expect(blocks[0]!.cause).toBe("content");
    expect(guard.stats()).toEqual({ blockedContent: 1, blockedError: 0, retries: 1 });
  });
});

describe("protección de menores en la salida del LLM (el mock se porta mal)", () => {
  it("una frase de flirteo de un adulto a un menor se convierte en seguir el plan", async () => {
    const { llm, memory, blocks } = setup({
      decide: () =>
        JSON.stringify({
          choice: "talk",
          to: "leo",
          say: "Estás muy guapo hoy, ¿quieres una cita romántica?",
        }),
    });
    const agent = new Agent(hugo, { llm, memory, places, minors });
    const decision = await agent.decide(0, {
      ...EMPTY,
      present: [{ id: "leo", name: "Leo Gil", action: "jugando" }],
      salient: true,
    });
    expect(decision.kind).toBe("follow_plan");
    expect(blocks.map((b) => b.kind)).toEqual(["speech"]);
  });

  it("un plan con una actividad romántica con un menor pierde ese bloque", async () => {
    const { llm, memory } = setup({
      plan: () =>
        JSON.stringify({
          plan: [
            { start: "08:00", durationMin: 60, activity: "desayunar", placeId: "casa_azul" },
            {
              start: "09:00",
              durationMin: 60,
              activity: "una cita romántica con Inés",
              placeId: "parque",
            },
          ],
        }),
    });
    const agent = new Agent(hugo, { llm, memory, places, minors });
    const plan = await agent.planDay(0);
    expect(plan.map((p) => p.activity)).toEqual(["desayunar"]);
  });

  it("un recuerdo así no se guarda (tryRemember devuelve null)", async () => {
    const { memory, store } = setup();
    const r = await memory.tryRemember(
      { agentId: "hugo", text: "Besé a Inés en el lago", type: "observation", importance: 5 },
      0,
    );
    expect(r).toBeNull();
    expect(await store.listByAgent("hugo")).toHaveLength(0);
    await expect(
      memory.remember(
        { agentId: "hugo", text: "Inés es mi novia", type: "observation", importance: 5 },
        0,
      ),
    ).rejects.toThrow(/protección de menores/);
  });

  it("la ficha social no cambia si la opinión es romántica sobre un menor", async () => {
    const { llm, guard } = setup({
      social: () =>
        JSON.stringify({ summary: "Me he enamorado de Inés.", affinityDelta: 0.3, trustDelta: 0 }),
    });
    const social = new InMemorySocialProfileStore();
    const p = await updateSocialAfterConversation(llm, social, {
      owner: { agentId: "hugo", agentName: "Hugo", system: "x" },
      other: { id: "ines", name: "Inés Ortega" },
      transcript: ["Hugo: hola"],
      now: 10,
      guard,
    });
    expect(p.summary).toBe("");
    expect(p.affinity).toBe(0);
  });

  it("la consolidación descarta reflexiones y opiniones románticas sobre un menor", async () => {
    const { llm, memory, store } = setup({
      consolidate: () =>
        JSON.stringify({
          insights: [
            { text: "Estoy enamorado de Inés", cites: [1] },
            { text: "Me gusta tocar en la plaza", cites: [1] },
          ],
          people: [{ id: "ines", summary: "Inés me atrae mucho", affinityDelta: 0.3 }],
        }),
    });
    await memory.remember(
      { agentId: "hugo", text: "Toqué la guitarra", type: "observation", importance: 3 },
      0,
    );
    const social = new InMemorySocialProfileStore();
    const consolidator = new LLMConsolidator(llm, memory, social, () => [
      { id: "ines", name: "Inés Ortega" },
    ]);
    const r = await consolidator.consolidate(
      { agentId: "hugo", agentName: "Hugo", system: "x" },
      0,
      60,
    );
    expect(r.created.map((m) => m.text)).toEqual(["Me gusta tocar en la plaza"]);
    expect((await store.listByAgent("hugo")).some((m) => /Inés/.test(m.text))).toBe(false);
    expect(await social.get("hugo", "ines")).toBeUndefined();
  });

  it("la crónica pierde las frases que no pasan", async () => {
    const { llm, guard } = setup({
      chronicle: () =>
        JSON.stringify({
          title: "Un día cualquiera",
          text: "Hugo tocó en la plaza. Hugo coqueteó con Inés junto al lago. Llovió por la tarde.",
        }),
    });
    const c = await writeChronicle(llm, 1, ["algo"], 120, "es", guard);
    expect(c.text).toBe("Hugo tocó en la plaza. Llovió por la tarde.");
  });
});
