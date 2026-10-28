import { describe, expect, it } from "vitest";
import { DEFAULT_DECAY, currentStrength, initialStability, reinforce } from "../memory/decay";
import { HashEmbedder } from "../memory/hash-embedder";
import { InMemoryStore } from "../memory/in-memory-store";
import { MemorySystem } from "../memory/memory-system";
import {
  DEFAULT_RETRIEVAL,
  clarityFor,
  cosine,
  recallText,
  scoreMemory,
} from "../memory/retrieval";
import type { MemoryRecord } from "../memory/types";
import { WorkingMemory } from "../memory/working-memory";

const HOUR = 60;

function mem(overrides: Partial<MemoryRecord> = {}): MemoryRecord {
  return {
    id: "m1",
    agentId: "a",
    text: "Tomé un café con Lucía en el parque",
    gist: null,
    embedding: [1, 0, 0],
    createdAt: 0,
    lastAccessedAt: 0,
    importance: 5,
    emotionalValence: 0,
    strength: 1,
    stability: 24,
    accessCount: 0,
    source: "vivido",
    type: "observation",
    people: [],
    placeId: null,
    ...overrides,
  };
}

describe("puntuación de recuperación", () => {
  const query = { embedding: [1, 0, 0], now: 0, moodValence: 0 };

  it("con todo al máximo y fuerza 1 la puntuación es 1", () => {
    const s = scoreMemory(mem({ importance: 10 }), query);
    expect(s.scores.recency).toBeCloseTo(1);
    expect(s.scores.relevance).toBeCloseTo(1);
    expect(s.scores.moodMatch).toBeCloseTo(1);
    expect(s.scores.total).toBeCloseTo(1);
  });

  it("la relevancia sigue al coseno (y no baja de 0)", () => {
    expect(cosine([1, 0], [0, 1])).toBeCloseTo(0);
    const opposite = scoreMemory(mem({ embedding: [-1, 0, 0] }), query);
    expect(opposite.scores.relevance).toBe(0);
    const relevant = scoreMemory(mem(), query).scores.total;
    const irrelevant = scoreMemory(mem({ embedding: [0, 1, 0] }), query).scores.total;
    expect(relevant).toBeGreaterThan(irrelevant);
  });

  it("favorece recuerdos más importantes y más recientes", () => {
    const later = { ...query, now: 48 * HOUR };
    const important = scoreMemory(mem({ importance: 9, stability: 1e9 }), later).scores.total;
    const trivial = scoreMemory(mem({ importance: 1, stability: 1e9 }), later).scores.total;
    expect(important).toBeGreaterThan(trivial);
    const recent = scoreMemory(mem({ lastAccessedAt: 47 * HOUR, stability: 1e9 }), later);
    const old = scoreMemory(mem({ lastAccessedAt: 0, stability: 1e9 }), later);
    expect(recent.scores.recency).toBeGreaterThan(old.scores.recency);
    expect(old.scores.recency).toBeCloseTo(Math.pow(0.995, 48));
  });

  it("la coincidencia de ánimo favorece recuerdos de la misma valencia", () => {
    const sad = { ...query, moodValence: -0.8 };
    const sadMemory = scoreMemory(mem({ emotionalValence: -0.8 }), sad).scores.moodMatch;
    const happyMemory = scoreMemory(mem({ emotionalValence: 0.8 }), sad).scores.moodMatch;
    expect(sadMemory).toBeCloseTo(1);
    expect(happyMemory).toBeCloseTo(0.2);
  });

  it("todo queda multiplicado por la fuerza", () => {
    const strong = scoreMemory(mem({ strength: 1 }), query).scores.total;
    const weak = scoreMemory(mem({ strength: 0.5 }), query).scores.total;
    expect(weak).toBeCloseTo(strong * 0.5);
  });
});

describe("decaimiento", () => {
  it("es exponencial con el tiempo de juego", () => {
    const m = mem({ stability: 10 });
    expect(currentStrength(m, 0)).toBe(1);
    expect(currentStrength(m, 10 * HOUR)).toBeCloseTo(Math.exp(-1));
    expect(currentStrength(m, 20 * HOUR)).toBeCloseTo(Math.exp(-2));
  });

  it("los recuerdos importantes y emotivos son más estables", () => {
    expect(initialStability(9, 0)).toBeGreaterThan(initialStability(2, 0));
    expect(initialStability(5, -0.9)).toBeGreaterThan(initialStability(5, 0));
    expect(initialStability(1, 0)).toBe(DEFAULT_DECAY.baseStabilityHours);
  });
});

describe("refuerzo al recordar", () => {
  it("sube la fuerza, aumenta la estabilidad y actualiza el acceso", () => {
    const m = mem({ stability: 10 });
    const now = 10 * HOUR;
    const before = currentStrength(m, now);
    const r = reinforce(m, now);
    expect(r.strength).toBeGreaterThan(before);
    expect(r.strength).toBeLessThanOrEqual(1);
    expect(r.stability).toBeGreaterThan(m.stability);
    expect(r.lastAccessedAt).toBe(now);
    expect(r.accessCount).toBe(1);
  });

  it("un recuerdo repasado decae más despacio que uno sin repasar", () => {
    const m = mem({ stability: 10 });
    const reviewed = { ...m, ...reinforce(m, 5 * HOUR) };
    expect(currentStrength(reviewed, 40 * HOUR)).toBeGreaterThan(currentStrength(m, 40 * HOUR));
  });

  it("repasar cuando ya está débil consolida más (efecto de espaciado)", () => {
    const m = mem({ stability: 10 });
    const early = reinforce(m, 1 * HOUR);
    const late = reinforce(m, 20 * HOUR);
    expect(late.stability).toBeGreaterThan(early.stability);
  });
});

describe("umbrales de olvido y vaguedad", () => {
  it("clasifica por fuerza", () => {
    expect(clarityFor(0.9)).toBe("clear");
    expect(clarityFor(DEFAULT_RETRIEVAL.vagueThreshold - 0.01)).toBe("vague");
    expect(clarityFor(DEFAULT_RETRIEVAL.forgetThreshold - 0.01)).toBe("forgotten");
  });

  it("un recuerdo vago solo devuelve la esencia", () => {
    const scored = scoreMemory(mem({ strength: 0.2 }), { embedding: [1, 0, 0], now: 0, moodValence: 0 });
    expect(scored.scores.clarity).toBe("vague");
    expect(recallText(scored)).toMatch(/^\(vagamente\)/);
    const withGist = scoreMemory(mem({ strength: 0.2, gist: "un café con alguien" }), {
      embedding: [1, 0, 0],
      now: 0,
      moodValence: 0,
    });
    expect(recallText(withGist)).toBe("un café con alguien");
  });

  it("MemorySystem no recupera lo olvidado, sí lo inspecciona, y refuerza lo recuperado", async () => {
    let n = 0;
    const store = new InMemoryStore();
    const memory = new MemorySystem({
      store,
      embedder: new HashEmbedder(),
      idGenerator: () => `m${++n}`,
    });
    const fresh = await memory.remember(
      { agentId: "a", text: "Lucía me regaló un libro de poesía", type: "observation", importance: 6 },
      100 * HOUR,
    );
    const old = await memory.remember(
      { agentId: "a", text: "Lucía llevaba un libro rojo", type: "observation", importance: 1 },
      0,
    );
    const now = 100 * HOUR;
    const got = await memory.retrieve({ agentId: "a", query: "libro de Lucía", now, moodValence: 0 });
    expect(got.map((s) => s.memory.id)).toEqual([fresh.id]);

    const inspected = await memory.inspect({ agentId: "a", query: "libro", now, moodValence: 0 });
    expect(inspected.find((s) => s.memory.id === old.id)?.scores.clarity).toBe("forgotten");

    const updated = await store.get(fresh.id);
    expect(updated?.accessCount).toBe(1);
    expect(updated?.stability).toBeGreaterThan(fresh.stability);
  });
});

describe("memoria de trabajo", () => {
  it("guarda como máximo 7 elementos y descarta los más antiguos", () => {
    const wm = new WorkingMemory();
    for (let i = 0; i < 10; i++) wm.push({ text: `item ${i}`, addedAt: i });
    expect(wm.contents).toHaveLength(7);
    expect(wm.contents[0]?.text).toBe("item 3");
  });

  it("no duplica el mismo recuerdo", () => {
    const wm = new WorkingMemory(3);
    wm.push({ text: "a", memoryId: "x", addedAt: 0 });
    wm.push({ text: "a", memoryId: "x", addedAt: 1 });
    expect(wm.contents).toHaveLength(1);
  });
});
