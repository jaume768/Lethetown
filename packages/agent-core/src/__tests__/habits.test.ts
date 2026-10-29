import { readFileSync } from "node:fs";
import { AgentSeed, parseTiledMap } from "@lethetown/shared";
import { describe, expect, it } from "vitest";
import { Agent } from "../agent/agent";
import { agentMockResponder } from "../agent/mock-responder";
import { LLMClient } from "../llm/client";
import { CostTracker } from "../llm/cost-tracker";
import { MockProvider } from "../llm/mock";
import { ModelRouter } from "../llm/router";
import { MemoryConfig } from "../memory/config";
import { HashEmbedder } from "../memory/hash-embedder";
import { LLMGistCompressor } from "../memory/human";
import {
  dayDiaryText,
  dueHabits,
  habitText,
  recordDay,
  slotOf,
  type DiaryEntry,
} from "../memory/habits";
import { InMemoryStore } from "../memory/in-memory-store";
import { MemoryMaintenance } from "../memory/maintenance";
import { MemorySystem } from "../memory/memory-system";

const places = parseTiledMap(
  JSON.parse(readFileSync(new URL("../../../../seeds/town.tmj", import.meta.url), "utf8")),
).places;
const cafe = places.find((p) => p.id === "cafe_ola")!;

function setup(rngValues: number[] = []) {
  const provider = new MockProvider(agentMockResponder);
  const llm = new LLMClient(
    provider,
    new ModelRouter({ fast: "mock-fast", reflection: "mock-reflection" }),
    new CostTracker({}),
  );
  const store = new InMemoryStore();
  let i = 0;
  const memory = new MemorySystem({
    store,
    embedder: new HashEmbedder(),
    rng: () => rngValues[i++ % Math.max(1, rngValues.length)] ?? 0.99,
  });
  const seed = AgentSeed.parse({
    id: "lucia",
    name: "Lucía",
    age: 30,
    traits: ["curiosa"],
    description: "Lucía es ilustradora.",
    homeId: "casa_azul",
  });
  return { provider, llm, store, memory, agent: new Agent(seed, { llm, memory, places }) };
}

const coffee = (day: number): DiaryEntry[] => [
  { minute: 8 * 60, activity: "tomar un café", placeId: "cafe_ola" },
  { minute: 10 * 60 + day, activity: `algo distinto ${day}`, placeId: "parque" },
];

describe("hábitos (lógica pura)", () => {
  it("franjas del día", () => {
    expect([slotOf(8 * 60), slotOf(13 * 60), slotOf(17 * 60), slotOf(23 * 60)]).toEqual([
      "mañana",
      "mediodía",
      "tarde",
      "noche",
    ]);
  });

  it("una rutina se vuelve hábito al repetirse minDays días dentro de la ventana", () => {
    let t = recordDay({}, coffee(0), 0, 7);
    t = recordDay(t, coffee(1), 1, 7);
    expect(dueHabits(t, 1, 3)).toEqual([]);
    t = recordDay(t, coffee(2), 2, 7);
    const due = dueHabits(t, 2, 3);
    expect(due).toHaveLength(1);
    expect(habitText(due[0]!, cafe.name)).toBe(
      `Suelo tomar un café en ${cafe.name} por las mañanas.`,
    );
    // Lo que no se repite sale de la ventana y se olvida del rastreador.
    t = recordDay(t, [], 20, 7);
    expect(t).toEqual({});
  });

  it("el texto del diario junta lo repetido seguido", () => {
    const text = dayDiaryText(
      3,
      [
        { minute: 480, activity: "leer", placeId: "a" },
        { minute: 490, activity: "leer", placeId: "a" },
        { minute: 600, activity: "comer", placeId: "b" },
      ],
      (id) => id.toUpperCase(),
    );
    expect(text).toBe("El día 3: leer en A, comer en B.");
  });
});

describe("diario sujeto a la memoria", () => {
  it("anotar una actividad ya no crea un recuerdo episódico", async () => {
    const { agent, store } = setup();
    const before = (await store.listByAgent("lucia")).length;
    agent.noteActivity(8 * 60, "tomar un café", "cafe_ola");
    expect(agent.state.doneToday).toHaveLength(1);
    expect(await store.listByAgent("lucia")).toHaveLength(before);
  });

  it("con poca energía el diario pierde o mezcla entradas", () => {
    // rng: 0.0 → se pierde; 0.3 → se mezcla (con energía 0, pérdida 0.4 y mezcla 0.3).
    const { agent } = setup([0.99, 0.0, 0.5]);
    agent.state.needs.energy = 0;
    agent.noteActivity(8 * 60, "desayunar", "casa_azul");
    agent.noteActivity(9 * 60, "pasear", "parque");
    agent.noteActivity(10 * 60, "tomar un café", "cafe_ola");
    expect(agent.state.doneToday).toEqual([
      { minute: 480, activity: "desayunar", placeId: "casa_azul" },
      // "pasear" se perdió y el café quedó anotado en casa (mezcla).
      { minute: 600, activity: "tomar un café", placeId: "casa_azul" },
    ]);
  });

  it("con energía alta el diario es fiel", () => {
    const { agent } = setup([0.0]);
    agent.state.needs.energy = 0.9;
    agent.noteActivity(8 * 60, "desayunar", "casa_azul");
    agent.noteActivity(9 * 60, "pasear", "parque");
    expect(agent.state.doneToday?.map((d) => d.placeId)).toEqual(["casa_azul", "parque"]);
  });

  it("al dormirse guarda el día y, si se repite, forma y luego refuerza un hábito", async () => {
    const { agent, store } = setup();
    for (const day of [0, 1, 2, 3]) {
      agent.state.doneToday = coffee(day);
      const r = await agent.endDay(day * 1440 + 22 * 60, day);
      expect(r.diaryMemoryId).not.toBeNull();
      if (day < 2) expect(r.habitsFormed).toEqual([]);
      if (day === 2)
        expect(r.habitsFormed).toEqual([`Suelo tomar un café en ${cafe.name} por las mañanas.`]);
      if (day === 3) expect(r.habitsReinforced).toHaveLength(1);
    }
    const habits = (await store.listByAgent("lucia")).filter((m) => m.type === "semantic");
    expect(habits).toHaveLength(1);
    expect(habits[0]!.accessCount).toBe(1);
    const audit = await store.audit("lucia");
    expect(audit.map((a) => a.action)).toEqual(["reinforced", "habit"]);
    expect(agent.mind.diaryMemoryIds).toHaveLength(4);
  });

  it("el plan recuerda ayer con olvido: días después el diario está vago o olvidado", async () => {
    const run = async (laterDay: number) => {
      const { agent, provider } = setup();
      agent.state.doneToday = coffee(0);
      await agent.endDay(22 * 60, 0);
      await agent.planDay(1440 + 7 * 60);
      expect(provider.calls.at(-1)!.prompt).toMatch(/- El día 0: tomar un café en/);
      await agent.planDay(laterDay * 1440 + 7 * 60);
      return provider.calls.at(-1)!.prompt;
    };
    // Tres días después solo queda la esencia (y no sale dos veces).
    const vague = await run(4);
    expect(vague).toContain("- (vagamente) El día 0: tomar un café…");
    expect(vague).not.toMatch(/- El día 0: tomar un café en/);
    // Diez días después, olvidado.
    expect(await run(11)).not.toContain("El día 0");
  });

  it("no pide al LLM la esencia de lo poco importante (se desvanece sin más)", async () => {
    const { llm, memory, provider } = setup();
    await memory.remember(
      { agentId: "lucia", text: "Vi pasar a alguien", type: "observation", importance: 2 },
      0,
    );
    await memory.remember(
      { agentId: "lucia", text: "Discutí con Mateo", type: "observation", importance: 5 },
      0,
    );
    const maintenance = new MemoryMaintenance({ memory, gist: new LLMGistCompressor(llm) });
    const owner = { agentId: "lucia", agentName: "Lucía", system: "x" };
    // A las 40 h los dos están vagos (estabilidades de 16.2 h y 28.8 h).
    await maintenance.run(owner, 0, []);
    const report = await maintenance.run(owner, 40 * 60, []);
    expect(report.gists).toHaveLength(1);
    expect(provider.calls.filter((c) => c.meta.task === "gist")).toHaveLength(1);
    expect(MemoryConfig.parse({}).gist.minImportance).toBe(4);
  });
});
