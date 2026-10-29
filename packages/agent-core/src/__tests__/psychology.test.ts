import { readFileSync } from "node:fs";
import { AgentSeed } from "@lethetown/shared";
import { describe, expect, it } from "vitest";
import { MemoryConfig } from "../memory/config";
import { currentStrength } from "../memory/decay";
import { HashEmbedder } from "../memory/hash-embedder";
import { RandomSourceConfuser } from "../memory/human";
import { InMemoryStore } from "../memory/in-memory-store";
import { MemoryMaintenance } from "../memory/maintenance";
import { MemorySystem } from "../memory/memory-system";
import {
  NEUTRAL_PROFILE,
  isYouthMemory,
  mentionsDate,
  profilesFor,
  resolveProfile,
  stabilityFactor,
} from "../memory/psychology";

const seeds = AgentSeed.array().parse(
  JSON.parse(readFileSync(new URL("../../../../seeds/agents.json", import.meta.url), "utf8")),
);
const byId = Object.fromEntries(seeds.map((s) => [s.id, s]));
const cfg = MemoryConfig.parse({}).profile;
const profiles = profilesFor(seeds, cfg);

describe("personalidades de las semillas (revisadas a mano)", () => {
  it("los 20 agentes tienen personalidad completa", () => {
    expect(seeds).toHaveLength(20);
    for (const s of seeds) {
      expect(Object.values(s.personality).every((v) => v >= 0 && v <= 1)).toBe(true);
    }
  });

  it("encajan con su descripción", () => {
    const p = (id: string) => byId[id]!.personality;
    expect(profiles.carmen!.episodicStability).toBeGreaterThan(1.3); // memoriosa
    expect(profiles.aurora!.episodicStability).toBeLessThan(0.5); // desmemoriada y 82 años
    expect(profiles.andres!.dateForgetting).toBeGreaterThan(2); // olvidadizo con las fechas
    expect(profiles.tomas!.dateForgetting).toBeGreaterThan(2); // no sabe qué día es el aniversario
    expect(p("hugo").conscientiousness).toBeLessThan(0.3); // impuntual
    expect(p("hugo").extraversion).toBeGreaterThan(0.7); // alegre
    expect(p("ernesto").conscientiousness).toBeGreaterThan(0.7); // puntual
    expect(p("ernesto").neuroticism).toBeGreaterThan(0.7); // hipocondríaco
    expect(profiles.leo!.suggestibility).toBeGreaterThan(1.5); // niño fantasioso
    expect(profiles.leo!.sourceConfusion).toBeGreaterThan(1.5);
    expect(p("julian").extraversion).toBeLessThan(0.3); // tímido
  });
});

describe("perfil de memoria (edad y personalidad)", () => {
  const base = { personality: byId.lucia!.personality, memoryProfile: undefined };

  it("los mayores: episódica más frágil, semántica estable y pico de reminiscencia", () => {
    const old = resolveProfile({ ...base, age: 80 }, cfg);
    const young = resolveProfile({ ...base, age: 30 }, cfg);
    expect(old.episodicStability).toBeCloseTo(1 - 15 * 0.02);
    expect(old.semanticStability).toBeGreaterThan(young.semanticStability);
    expect(old.reminiscenceStability).toBe(3);
    expect(young.reminiscenceStability).toBe(1);
    expect(resolveProfile({ ...base, age: 99 }, cfg).episodicStability).toBe(0.5);
  });

  it("los niños confunden más la fuente y son más sugestionables", () => {
    const child = resolveProfile({ ...base, age: 9 }, cfg);
    const teen = resolveProfile({ ...base, age: 16 }, cfg);
    const adult = resolveProfile({ ...base, age: 30 }, cfg);
    expect(child.sourceConfusion).toBeGreaterThan(teen.sourceConfusion);
    expect(teen.sourceConfusion).toBeGreaterThan(adult.sourceConfusion);
    expect(child.suggestibility).toBeGreaterThan(adult.suggestibility);
  });

  it("responsabilidad y neuroticismo", () => {
    const tidy = resolveProfile(
      { ...base, age: 30, personality: { ...base.personality, conscientiousness: 1 } },
      cfg,
    );
    const messy = resolveProfile(
      { ...base, age: 30, personality: { ...base.personality, conscientiousness: 0 } },
      cfg,
    );
    expect(tidy.intentionForgetting).toBeCloseTo(0.5);
    expect(messy.intentionForgetting).toBeCloseTo(1.5);
    const anxious = resolveProfile(
      { ...base, age: 30, personality: { ...base.personality, neuroticism: 1 } },
      cfg,
    );
    expect(anxious.moodCongruence).toBeCloseTo(1.5);
  });

  it("fechas, juventud y tipo de recuerdo", () => {
    expect(mentionsDate("Nuestro aniversario es el jueves")).toBe(true);
    expect(mentionsDate("Me gusta el pan")).toBe(false);
    expect(isYouthMemory("Nací en Lethetown hace ochenta y dos años")).toBe(true);
    expect(isYouthMemory("Ayer comí pan")).toBe(false);
    const p = {
      ...NEUTRAL_PROFILE,
      dateForgetting: 2,
      episodicStability: 0.5,
      reminiscenceStability: 3,
    };
    expect(stabilityFactor(p, { type: "observation", text: "comí pan" })).toBe(0.5);
    expect(stabilityFactor(p, { type: "semantic", text: "el aniversario" })).toBe(0.5);
    expect(stabilityFactor(p, { type: "semantic", text: "x", youth: true })).toBe(3);
  });
});

describe("el perfil en la memoria", () => {
  const memory = () =>
    new MemorySystem({ store: new InMemoryStore(), embedder: new HashEmbedder(), profiles });

  it("decaimiento: Aurora olvida antes lo vivido que Carmen", async () => {
    const m = memory();
    const input = { text: "Vi a Leo en el parque", type: "observation" as const, importance: 4 };
    const aurora = await m.remember({ ...input, agentId: "aurora" }, 0);
    const carmen = await m.remember({ ...input, agentId: "carmen" }, 0);
    expect(currentStrength(aurora, 24 * 60)).toBeLessThan(currentStrength(carmen, 24 * 60) / 2);
  });

  it("pico de reminiscencia: Aurora conserva y evoca sus recuerdos de juventud", async () => {
    const m = memory();
    const text = "Tuve una amiga de joven que se marchó del pueblo";
    const old = await m.remember(
      { agentId: "aurora", text, type: "semantic", importance: 6, meta: { youth: true } },
      0,
    );
    const plain = await m.remember(
      { agentId: "aurora", text: "Clara trabaja en el mercado", type: "semantic", importance: 6 },
      0,
    );
    expect(old.stability).toBeGreaterThan(plain.stability * 2.9);
    const ranked = await m.inspect({ agentId: "aurora", query: "algo", now: 10, moodValence: 0 });
    const score = (id: string) => ranked.find((s) => s.memory.id === id)!.scores.total;
    expect(score(old.id)).toBeGreaterThan(score(plain.id));
  });

  it("confusión de fuente: Leo confunde más que Carmen", async () => {
    const m = memory();
    for (const agentId of ["leo", "carmen"]) {
      for (let i = 0; i < 100; i++) {
        await m.remember(
          {
            agentId,
            text: `Rumor ${i}`,
            type: "observation",
            importance: 9,
            source: "contado por rafael",
          },
          0,
        );
      }
    }
    let n = 0;
    const rng = () => (n = (n * 9301 + 49297) % 233280) / 233280;
    const maintenance = new MemoryMaintenance({
      memory: m,
      confuser: new RandomSourceConfuser(rng, 1),
    });
    const changed: Record<string, number> = {};
    for (const agentId of ["leo", "carmen"]) {
      const owner = { agentId, agentName: agentId, system: "x" };
      await maintenance.run(owner, 0, ["rafael", "mateo"]);
      const r = await maintenance.run(owner, 2 * 24 * 60, ["rafael", "mateo"]);
      changed[agentId] = r.sourceChanged.length;
    }
    // Probabilidad esperada 3 veces mayor (1.8 frente a 0.6).
    expect(changed.leo).toBeGreaterThan(changed.carmen! * 1.5);
  });
});
