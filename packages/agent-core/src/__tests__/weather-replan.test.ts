import { readFileSync } from "node:fs";
import { AgentSeed, parseTiledMap, type PlanItem } from "@lethetown/shared";
import { describe, expect, it } from "vitest";
import { Agent, type DecideInput } from "../agent/agent";
import { agentMockResponder } from "../agent/mock-responder";
import { placeLine, weatherLine } from "../agent/prompts";
import { replanAt } from "../agent/replan";
import { LLMClient } from "../llm/client";
import { CostTracker } from "../llm/cost-tracker";
import { MockProvider } from "../llm/mock";
import { ModelRouter } from "../llm/router";
import { HashEmbedder } from "../memory/hash-embedder";
import { InMemoryStore } from "../memory/in-memory-store";
import { MemorySystem } from "../memory/memory-system";

const world = parseTiledMap(
  JSON.parse(readFileSync(new URL("../../../../seeds/town.tmj", import.meta.url), "utf8")),
);

function agentAt(placeId: string) {
  const provider = new MockProvider(agentMockResponder);
  const llm = new LLMClient(
    provider,
    new ModelRouter({ fast: "mock-fast", reflection: "mock-reflection" }),
    new CostTracker({}),
  );
  const memory = new MemorySystem({ store: new InMemoryStore(), embedder: new HashEmbedder() });
  const seed = AgentSeed.parse({
    id: "lucia",
    name: "Lucía",
    age: 30,
    traits: ["curiosa"],
    description: "Lucía es ilustradora.",
    homeId: "casa_azul",
  });
  const agent = new Agent(seed, { llm, memory, places: world.places });
  agent.state.locationId = placeId;
  agent.state.spotId = null;
  return { agent, provider };
}

const BASE: Omit<DecideInput, "weather"> = {
  present: [],
  heard: [],
  conversationWith: null,
  objectStates: [],
  socialNotes: [],
  salient: true,
};

const item = (startMinute: number, durationMin: number, activity: string): PlanItem => ({
  startMinute,
  durationMin,
  activity,
  activityKind: "idle",
  placeId: "parque",
  spotId: null,
});

describe("replanAt", () => {
  it("recorta el bloque en curso, mete el cambio y aparta lo que se solapa", () => {
    const plan = [item(480, 120, "pasear"), item(600, 60, "comprar"), item(660, 60, "comer")];
    const out = replanAt(
      plan,
      540,
      { activity: "refugiarse", activityKind: "sit", placeId: "cafe_ola", spotId: null },
      90,
    );
    expect(out.map((p) => [p.startMinute, p.durationMin, p.activity])).toEqual([
      [480, 60, "pasear"],
      [540, 90, "refugiarse"],
      [630, 30, "comprar"],
      [660, 60, "comer"],
    ]);
    expect(out.find((p) => p.activity === "refugiarse")?.replanned).toBe(true);
  });

  it("no pasa de medianoche", () => {
    const out = replanAt(
      [],
      1430,
      { activity: "x", activityKind: "idle", placeId: "a", spotId: null },
      60,
    );
    expect(out[0]).toMatchObject({ startMinute: 1430, durationMin: 10 });
  });
});

describe("tiempo en los prompts", () => {
  it("describe si está bajo techo, a cubierto o a la intemperie", () => {
    expect(weatherLine("rain", true)).toBe("lluvia; estás bajo techo");
    expect(weatherLine("rain", false)).toContain("te estás mojando");
    expect(weatherLine("rain", false, true)).toBe("lluvia; estás a cubierto");
    expect(weatherLine("storm", false, true)).toContain("bajo un árbol no es seguro");
    expect(weatherLine("heat", false)).toContain("asando");
  });

  it("marca los objetos que dan refugio en los lugares exteriores", () => {
    const parque = world.places.find((p) => p.id === "parque")!;
    expect(parque.objects.some((o) => o.shelter)).toBe(true);
    expect(placeLine(parque)).toContain(",refugio]");
  });

  it("con lluvia al aire libre (mock) busca refugio; con tormenta solo un techo", async () => {
    const rain = new Set<string>();
    const storm = new Set<string>();
    for (let t = 0; t < 16; t++) {
      const a = agentAt("parque").agent;
      const d = await a.decide(9 * 60 + t, { ...BASE, weather: "rain" });
      if (d.kind === "act" && d.action.type === "do_activity")
        rain.add(d.action.spotId ?? d.action.placeId);
      const b = agentAt("parque").agent;
      const e = await b.decide(9 * 60 + t, { ...BASE, weather: "storm" });
      if (e.kind === "act" && e.action.type === "do_activity") {
        const action = e.action;
        const place = world.places.find((p) => p.id === action.placeId)!;
        storm.add(place.indoor ? "techo" : "fuera");
      }
    }
    expect(rain.size).toBeGreaterThan(0);
    expect([...storm]).toEqual(["techo"]);
  });
});

describe("voz interior", () => {
  it("responde con un razonamiento y casi siempre le hace caso", async () => {
    const kinds = new Set<string>();
    for (let t = 0; t < 12; t++) {
      const { agent, provider } = agentAt("cafe_ola");
      const d = await agent.decide(10 * 60 + t, {
        ...BASE,
        weather: "sunny",
        innerVoice: ["Me apetece ir a Lago Leteo a ver quién hay."],
      });
      expect(provider.calls.at(-1)?.prompt).toContain("VOZ INTERIOR");
      expect(d.reason).toBeTruthy();
      kinds.add(d.kind === "act" ? d.action.type : d.kind);
    }
    expect(kinds.has("do_activity")).toBe(true);
  });
});

describe("conversación frente al plan", () => {
  it("con el aviso de que toca irse, se despide, se queda o se va, pero siempre lo razona", async () => {
    const kinds = new Set<string>();
    for (let t = 0; t < 15; t++) {
      const { agent } = agentAt("cafe_ola");
      agent.workingMemory.push({
        text: "Según tu plan ahora toca comprar pan en Panadería Miga, pero estás hablando con Mateo.",
        addedAt: 0,
      });
      const d = await agent.decide(10 * 60 + t, {
        ...BASE,
        weather: "sunny",
        present: [{ id: "mateo", name: "Mateo", action: "charlando" }],
        conversationWith: "mateo",
      });
      expect(d.reason).toBeTruthy();
      if (d.kind === "act" && d.action.type === "say") expect(d.action.to).toBe("mateo");
      kinds.add(d.kind === "act" ? d.action.type : d.kind);
    }
    expect(kinds.has("say")).toBe(true);
    expect(kinds.has("do_activity")).toBe(true);
  });
});

describe("diario del día", () => {
  it("anota cada actividad nueva (sin repetir la última) y la pasa al prompt", async () => {
    const { agent, provider } = agentAt("cafe_ola");
    agent.noteActivity(8 * 60, "tomar un café", "cafe_ola");
    agent.noteActivity(8 * 60 + 10, "tomar un café", "cafe_ola");
    agent.noteActivity(9 * 60, "leer en la biblioteca", "biblioteca");
    expect(agent.state.doneToday?.map((d) => d.activity)).toEqual([
      "tomar un café",
      "leer en la biblioteca",
    ]);
    await agent.decide(9 * 60 + 5, { ...BASE, weather: "sunny" });
    expect(provider.calls.at(-1)?.prompt).toContain(
      "HOY YA HAS HECHO:\n- 08:00 tomar un café (cafe_ola)",
    );
  });

  it("al planificar el día siguiente recuerda lo de ayer (de la memoria) y empieza otro diario", async () => {
    const { agent, provider } = agentAt("casa_azul");
    agent.noteActivity(10 * 60, "pasear junto al lago", "lago");
    await agent.endDay(22 * 60, 0);
    await agent.planDay(1440 + 7 * 60);
    expect(provider.calls.at(-1)?.prompt).toContain("Lo que recuerdas de ayer y tus costumbres");
    expect(provider.calls.at(-1)?.prompt).toMatch(/- El día 0: pasear junto al lago en \S/);
    expect(agent.state.doneToday).toEqual([]);
  });
});
