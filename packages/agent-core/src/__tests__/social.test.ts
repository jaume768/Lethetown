import { readFileSync } from "node:fs";
import { AgentSeed, parseTiledMap } from "@lethetown/shared";
import { describe, expect, it } from "vitest";
import { Agent } from "../agent/agent";
import { MinorGuard, minorsOf } from "../agent/minor-safety";
import { agentMockResponder } from "../agent/mock-responder";
import { personalityLine } from "../agent/prompts";
import { LLMClient } from "../llm/client";
import { CostTracker } from "../llm/cost-tracker";
import { MockProvider } from "../llm/mock";
import { ModelRouter } from "../llm/router";
import { MemoryConfig } from "../memory/config";
import { HashEmbedder } from "../memory/hash-embedder";
import { InMemorySocialProfileStore, applySocialUpdate } from "../memory/human";
import { InMemoryStore } from "../memory/in-memory-store";
import { MemorySystem } from "../memory/memory-system";
import {
  classifyRelationship,
  credibility,
  exposureDelta,
  forgive,
  grudgeAfter,
} from "../memory/social";

const cfg = MemoryConfig.parse({}).social;
const world = parseTiledMap(
  JSON.parse(readFileSync(new URL("../../../../seeds/town.tmj", import.meta.url), "utf8")),
);
const seeds = AgentSeed.array().parse(
  JSON.parse(readFileSync(new URL("../../../../seeds/agents.json", import.meta.url), "utf8")),
);
const names = Object.fromEntries(seeds.map((s) => [s.id, s.name]));

describe("relaciones (puro)", () => {
  const p = { affinity: 0, familiarity: 0.1, bond: null };
  const adults = { minorInvolved: false };

  it("tipo de relación según vínculo, afinidad y familiaridad", () => {
    expect(classifyRelationship({ ...p, bond: "family", affinity: -0.8 }, adults, cfg)).toBe(
      "family",
    );
    expect(classifyRelationship({ ...p, bond: "romantic" }, adults, cfg)).toBe("romantic");
    expect(classifyRelationship({ ...p, affinity: -0.5 }, adults, cfg)).toBe("rivalry");
    expect(classifyRelationship({ ...p, affinity: 0.5, familiarity: 0.5 }, adults, cfg)).toBe(
      "friendship",
    );
    // Afinidad sin trato: aún no es amistad.
    expect(classifyRelationship({ ...p, affinity: 0.5 }, adults, cfg)).toBe("neighbor");
    expect(classifyRelationship({ ...p, bond: "work" }, adults, cfg)).toBe("work");
  });

  it("nunca es romántica si hay un menor, ni siquiera por vínculo o por la opinión", () => {
    const minor = { minorInvolved: true, romanticHint: true };
    expect(classifyRelationship({ ...p, bond: "romantic" }, minor, cfg)).not.toBe("romantic");
    const close = { affinity: 0.9, familiarity: 0.9, bond: null };
    expect(classifyRelationship(close, minor, cfg)).toBe("friendship");
    expect(classifyRelationship(close, { minorInvolved: false, romanticHint: true }, cfg)).toBe(
      "romantic",
    );
  });

  it("rencor y perdón: la afinidad negativa vuelve hacia −rencor, antes si es amable", () => {
    expect(grudgeAfter(0, -0.1, cfg)).toBe(0);
    expect(grudgeAfter(0, -0.4, cfg)).toBeCloseTo(0.2);
    const hurt = { affinity: -0.6, grudge: 0.2 };
    const kind = forgive(hurt, 6, 1, cfg);
    const harsh = forgive(hurt, 6, 0, cfg);
    expect(kind).toBeGreaterThan(harsh);
    expect(forgive(hurt, 1000, 1, cfg)).toBeCloseTo(-0.2);
    expect(forgive({ affinity: -0.1, grudge: 0.2 }, 6, 1, cfg)).toBe(-0.1);
  });

  it("mera exposición: algo de familiaridad y un poco de afinidad, con tope", () => {
    expect(exposureDelta(10, 0, cfg)).toEqual({ familiarityDelta: 0, affinityDelta: 0 });
    const d = exposureDelta(180, 0, cfg);
    expect(d.familiarityDelta).toBeCloseTo(0.06);
    expect(d.affinityDelta).toBeCloseTo(0.012);
    expect(exposureDelta(180, 0.3, cfg).affinityDelta).toBe(0);
  });

  it("credibilidad: la confianza en quien lo cuenta, menos si es chismoso", () => {
    expect(credibility(0.8, false, cfg)).toBeCloseTo(0.8);
    expect(credibility(0.8, true, cfg)).toBeCloseTo(0.56);
  });

  it("cada cambio de la ficha queda en el historial con su motivo", async () => {
    const store = new InMemorySocialProfileStore();
    await applySocialUpdate(store, {
      ownerId: "a",
      aboutId: "b",
      affinityDelta: 0.5,
      familiarityDelta: 0.5,
      now: 10,
      reason: "hablaron",
      eventId: "c1",
    });
    await applySocialUpdate(store, { ownerId: "a", aboutId: "b", now: 20, reason: "nada" });
    const h = await store.history("a", "b");
    expect(h).toHaveLength(1);
    expect(h[0]).toMatchObject({
      reason: "hablaron",
      eventId: "c1",
      relationshipType: "friendship",
    });
  });
});

function setup(id: string) {
  const provider = new MockProvider(agentMockResponder);
  const llm = new LLMClient(
    provider,
    new ModelRouter({ fast: "mock-fast", reflection: "mock-reflection" }),
    new CostTracker({}),
  );
  const store = new InMemoryStore();
  const social = new InMemorySocialProfileStore();
  const memory = new MemorySystem({
    store,
    embedder: new HashEmbedder(),
    guard: new MinorGuard({ minors: minorsOf(seeds) }),
  });
  const seed = seeds.find((s) => s.id === id)!;
  const agent = new Agent(seed, {
    llm,
    memory,
    places: world.places,
    names,
    social,
    gossips: new Set(["rafael", "carmen", "ernesto"]),
  });
  return { provider, store, social, agent };
}

describe("lo social en el agente", () => {
  it("relaciones de partida: familia, pareja y rivalidad (no recíprocas)", async () => {
    const tomas = setup("tomas");
    await tomas.agent.seedRelationships(0);
    expect((await tomas.social.get("tomas", "pilar"))?.relationshipType).toBe("romantic");
    const julian = setup("julian");
    await julian.agent.seedRelationships(0);
    expect((await julian.social.get("julian", "ines"))?.relationshipType).toBe("family");
    const rafael = setup("rafael");
    await rafael.agent.seedRelationships(0);
    expect((await rafael.social.get("rafael", "mateo"))?.affinity).toBe(-0.3);
    expect((await rafael.social.history("rafael"))[0]!.reason).toBe("relación de partida");
  });

  it("ninguna relación de las semillas con un menor es romántica", () => {
    const minors = new Set(minorsOf(seeds).map((m) => m.id));
    for (const s of seeds) {
      for (const r of s.relationships) {
        if (minors.has(s.id) || minors.has(r.with)) expect(r.bond).not.toBe("romantic");
      }
    }
  });

  it("un rumor de alguien en quien no confía (y chismoso) se graba con duda y menos fuerza", async () => {
    const { agent, store, social } = setup("lucia");
    await applySocialUpdate(social, {
      ownerId: "lucia",
      aboutId: "rafael",
      trustDelta: -0.4,
      now: 0,
    });
    await agent.perceive(
      [
        {
          kind: "speech",
          fromId: "rafael",
          fromName: "Rafael",
          text: "¿Sabes? Dicen que la alcaldesa vende la casa vacía",
          placeId: "taberna",
        },
        { kind: "speech", fromId: "mateo", fromName: "Mateo", text: "Hola", placeId: "taberna" },
      ],
      0,
    );
    const [rumor, hello] = await store.listByAgent("lucia");
    expect(rumor!.text).toMatch(/^\(no sé si creérmelo\) Rafael me dijo/);
    expect(rumor!.strength).toBeLessThan(hello!.strength);
  });

  it("coincidir a menudo acerca un poco y la afinidad negativa se perdona con el tiempo", async () => {
    const { agent, social } = setup("rafael");
    await agent.seedRelationships(0);
    agent.noteCompany(["clara"], 120);
    agent.noteCompany(["clara"], 60);
    await agent.endDay(22 * 60, 0);
    const clara = await social.get("rafael", "clara");
    expect(clara?.familiarity).toBeGreaterThan(0.1);
    expect(clara?.affinity).toBeGreaterThan(0);
    const mateo = await social.get("rafael", "mateo");
    expect(mateo!.affinity).toBeGreaterThan(-0.3);
    const reasons = (await social.history("rafael")).map((c) => c.reason);
    expect(reasons.some((r) => r.startsWith("coincidieron 3.0 h"))).toBe(true);
    expect(reasons.some((r) => r.startsWith("con el tiempo le perdona"))).toBe(true);
  });

  it("el prompt fijo lleva personalidad, forma de hablar y libertad para negarse", () => {
    const { agent } = setup("ines");
    expect(agent.system).toContain("Personalidad: ");
    expect(agent.system).toMatch(
      /Cómo hablas: sarcástico y adolescente; cada vez que hablas, una frase corta o menos; muletillas: «en plan…»/,
    );
    expect(agent.system).toMatch(
      /puedes discrepar, negarte, molestarte o no tener ganas de hablar/,
    );
    expect(personalityLine(seeds.find((s) => s.id === "julian")!.personality)).toContain(
      "necesitas ratos a solas",
    );
    // Todos hablan distinto.
    const registers = new Set(seeds.map((s) => s.speechStyle?.register));
    expect(registers.size).toBe(20);
  });
});
