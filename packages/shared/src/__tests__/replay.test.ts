import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { AgentState } from "../schemas/agent";
import type { SimEvent } from "../schemas/api";
import type { Drama } from "../schemas/drama";
import type { MemoryAuditAction, MemoryAuditEntry } from "../schemas/memory";
import { confirmedArcs, pairArcs, repeatedArcs, seedMemoryArcs } from "../replay/arcs";
import type { Goal } from "../schemas/goals";
import { positionAt } from "../map/movement";
import { EMPTY_REPLAY_DATA, ReplayBundle, ReplayData, type ReplayMemory } from "../replay/bundle";
import { storyStep, textFromAudit } from "../replay/memory-story";
import { ReplayScenes, SceneShot, sceneBundlePath, shotAt } from "../replay/scenes";
import {
  agentAt,
  agentPatch,
  agentsAt,
  expandFrames,
  indexTrack,
  lastAtOrBefore,
} from "../replay/motion";
import { findMoments, scoreMoment, splitSpeech, topMoments } from "../replay/moments";
import { goalAt, ReplayViews, strengthSample } from "../replay/views";

/** Rejilla 10×5 con un muro en x = 5 salvo en y = 4 (hay que rodearlo por abajo). */
const W = 10;
const H = 5;
const collision = Array.from({ length: W * H }, (_, i) =>
  i % W === 5 && Math.floor(i / W) < 4 ? 1 : 0,
);
const grid = { width: W, height: H, collision };
const ctx = { grid, walkTilesPerMinute: 6 };

function agent(id: string, patch: Partial<AgentState> = {}): AgentState {
  return {
    id,
    name: id,
    appearance: { sheet: "default", skin: "#000", hair: "#000", shirt: "#000", pants: "#000" },
    locationId: "plaza",
    targetId: null,
    spotId: null,
    tile: { x: 1, y: 1 },
    facing: "down",
    movement: null,
    action: "estar",
    activityKind: "idle",
    mood: { valence: 0, arousal: 0, label: "tranquilo" },
    needs: { energy: 1, hunger: 0, social: 0 },
    plan: [],
    lastUtterance: null,
    ...patch,
  } as AgentState;
}

describe("fotos", () => {
  it("expande las diferencias compartiendo los agentes que no cambian", () => {
    const a = agent("a");
    const b = agent("b");
    const b2 = agent("b", { tile: { x: 2, y: 2 } });
    const frames = expandFrames([
      { time: 0, agents: [a, b] },
      { time: 10, agents: [b2] },
      { time: 20, agents: [], removed: ["a"] },
    ]);
    expect(frames.map((f) => f.agents.map((x) => x.id))).toEqual([["a", "b"], ["a", "b"], ["b"]]);
    expect(frames[1]!.byId.get("a")).toBe(frames[0]!.byId.get("a"));
    expect(frames[1]!.byId.get("b")).toEqual(b2);
  });

  it("parches por campo: solo lo que cambia, y lo que deja de estar", () => {
    const a = agent("a", { talking: true, plan: [] });
    const b = agent("a", { tile: { x: 5, y: 5 }, plan: [] });
    expect(agentPatch(a, a)).toBeNull();
    const patch = agentPatch(a, b)!;
    expect(patch).toEqual({ id: "a", tile: { x: 5, y: 5 }, unset: ["talking"] });
    const [, second] = expandFrames([
      { time: 0, agents: [a] },
      { time: 10, agents: [patch] },
    ]);
    expect(second!.byId.get("a")).toEqual(b);
  });

  it("busca la última foto anterior", () => {
    const xs = [{ time: 0 }, { time: 10 }, { time: 20 }];
    expect(lastAtOrBefore(xs, -1)).toBe(-1);
    expect(lastAtOrBefore(xs, 0)).toBe(0);
    expect(lastAtOrBefore(xs, 15)).toBe(1);
    expect(lastAtOrBefore(xs, 99)).toBe(2);
  });
});

describe("interpolación del movimiento", () => {
  const a = agent("a", { tile: { x: 1, y: 1 } });
  const b = agent("a", { tile: { x: 8, y: 1 } });

  it("anda por casillas transitables (rodea el muro) y llega a la hora de la foto siguiente", () => {
    const mid = agentAt(a, 0, b, 10, 9, ctx);
    expect(mid.movement).not.toBeNull();
    const m = mid.movement!;
    expect(m.endTime).toBe(10);
    // Ruta: 3 abajo, 7 a la derecha, 3 arriba = 13 baldosas a 6/min.
    expect(m.endTime - m.startTime).toBeCloseTo(13 / 6);
    for (let t = m.startTime; t <= m.endTime; t += 0.05) {
      const p = positionAt(mid, t);
      const tx = Math.round(p.x);
      const ty = Math.round(p.y);
      expect(collision[ty * W + tx], `(${p.x}, ${p.y}) en ${t}`).toBe(0);
    }
    // Antes de salir, quieto donde estaba; al final, donde lo vio la foto siguiente.
    expect(positionAt(mid, 0)).toMatchObject({ x: 1, y: 1 });
    expect(positionAt(mid, 10)).toMatchObject({ x: 8, y: 1 });
  });

  it("si no hay tiempo, anda más deprisa pero no se teletransporta", () => {
    const mid = agentAt(a, 0, b, 1, 0.5, ctx);
    expect(mid.movement).toMatchObject({ startTime: 0, endTime: 1 });
    const p = positionAt(mid, 0.5);
    expect(p.x === 1 && p.y === 1).toBe(false);
  });

  it("usa la ruta real de la foto mientras dura", () => {
    const real = {
      waypoints: [
        { x: 1, y: 1 },
        { x: 4, y: 1 },
      ],
      startTime: 0,
      endTime: 3,
    };
    const walking = agent("a", { movement: real });
    expect(agentAt(walking, 0, b, 10, 2, ctx).movement).toBe(real);
  });

  it("usa la ruta real de la foto siguiente desde que salió", () => {
    const real = {
      waypoints: [
        { x: 6, y: 4 },
        { x: 8, y: 4 },
      ],
      startTime: 8,
      endTime: 12,
    };
    const next = agent("a", { tile: { x: 6, y: 4 }, movement: real });
    expect(agentAt(a, 0, next, 10, 9, ctx).movement).toBe(real);
    // Antes, va hasta el principio de esa ruta.
    const before = agentAt(a, 0, next, 10, 7, ctx).movement!;
    expect(before.endTime).toBe(8);
    expect(before.waypoints.at(-1)).toEqual({ x: 6, y: 4 });
  });

  it("quieto entre dos fotos iguales: la misma foto", () => {
    expect(agentAt(a, 0, a, 10, 5, ctx)).toBe(a);
  });

  it("con la pista de posiciones, el tramo de cada minuto", () => {
    const track = indexTrack([
      { time: 3, p: [["a", 1, 1]] },
      { time: 4, p: [["a", 2, 1]] },
      { time: 5, p: [["a", 3, 1]] },
    ]);
    const mid = agentAt(a, 0, b, 10, 4.5, { ...ctx, track });
    expect(mid.movement).toMatchObject({ startTime: 4, endTime: 5 });
    expect(positionAt(mid, 4.5).x).toBeCloseTo(2.5);
    // Tras la última muestra, quieto donde se le vio.
    expect(agentAt(a, 0, b, 10, 6, { ...ctx, track })).toMatchObject({
      tile: { x: 3, y: 1 },
      movement: null,
    });
  });

  it("todos los agentes en un minuto", () => {
    const frames = expandFrames([
      { time: 0, agents: [a] },
      { time: 10, agents: [b] },
    ]);
    expect(agentsAt(frames, 10, ctx)[0]).toEqual(b);
    expect(agentsAt(frames, 99, ctx)[0]).toEqual(b);
    expect(agentsAt(frames, 9.9, ctx)[0]!.movement).not.toBeNull();
  });
});

function memory(patch: Partial<ReplayMemory>): ReplayMemory {
  return {
    id: "m1",
    agentId: "ana",
    text: "Leo me dijo que el lago estaba seco",
    gist: null,
    createdAt: 100,
    lastAccessedAt: 100,
    importance: 6,
    emotionalValence: 0.2,
    strength: 1,
    source: "vivido",
    type: "observation",
    people: ["leo"],
    placeId: null,
    eventId: "c1",
    links: [],
    status: "active",
    forgottenAt: null,
    meta: {},
    strengthAt: [
      [100, 1, "clear"],
      [200, 0.25, "vague"],
    ],
    archivedAt: null,
    ...patch,
  };
}

describe("vistas en un minuto", () => {
  const names = new Map([
    ["ana", "Ana"],
    ["leo", "Leo"],
  ]);
  const data = {
    ...EMPTY_REPLAY_DATA,
    memories: [
      memory({}),
      memory({ id: "m2", agentId: "leo", text: "Le conté a Ana lo del lago" }),
    ],
    versions: [
      {
        memoryId: "m1",
        version: 0,
        text: "Leo me dijo que el lago tenía poca agua",
        emotionalValence: 0,
        source: "vivido",
        at: 150,
        reason: "reconsolidación al recordar",
      },
    ],
    profiles: [
      {
        ownerId: "ana",
        aboutId: "leo",
        summary: "Mi vecino",
        affinity: 0.6,
        trust: 0.5,
        familiarity: 0.5,
        relationshipType: "friendship" as const,
        bond: null,
        grudge: 0,
        lastUpdated: 300,
      },
    ],
    history: [
      { ownerId: "ana", aboutId: "leo", at: 50, affinity: 0.1, trust: 0.5, familiarity: 0.2 },
      { ownerId: "ana", aboutId: "leo", at: 300, affinity: 0.6, trust: 0.5, familiarity: 0.5 },
    ].map((c) => ({ ...c, relationshipType: "neighbor" as const, reason: "", eventId: null })),
  };
  const views = new ReplayViews(data, names);

  it("el texto de antes de reconsolidarse y el de después", () => {
    expect(views.memoryAt(data.memories[0]!, 99)).toBeNull();
    expect(views.memoryAt(data.memories[0]!, 120)!.view.text).toBe(
      "Leo me dijo que el lago tenía poca agua",
    );
    expect(views.memoryAt(data.memories[0]!, 160)!.view.text).toBe(
      "Leo me dijo que el lago estaba seco",
    );
    expect(views.versionsAt("m1", 120)).toEqual([]);
    expect(views.versionsAt("m1", 160)).toHaveLength(1);
  });

  it("la fuerza se apaga entre muestras (escala logarítmica)", () => {
    const m = data.memories[0]!;
    expect(strengthSample(m, 100).strength).toBe(1);
    expect(strengthSample(m, 150).strength).toBeCloseTo(0.5);
    expect(strengthSample(m, 150).clarity).toBe("clear");
    expect(strengthSample(m, 250)).toEqual({ strength: 0.25, clarity: "vague" });
  });

  it("la ficha social del último cambio, sin el resumen final antes de tiempo", () => {
    const at100 = views.profilesAt(100)[0]!;
    expect(at100.affinity).toBe(0.1);
    expect(at100.summary).toBe("");
    expect(views.profilesAt(40)).toEqual([]);
    expect(views.profilesAt(400)[0]).toMatchObject({ affinity: 0.6, summary: "Mi vecino" });
  });

  it("Rashomon: los recuerdos de cada uno hasta ese minuto", () => {
    const r = views.rashomon("c1:2", null, 500);
    expect(r.accounts.map((a) => a.name)).toEqual(["Ana", "Leo"]);
    expect(views.rashomon("c1", null, 50).accounts).toEqual([]);
    expect(views.hasAccounts("c1:1")).toBe(true);
  });

  it("una meta, tal como estaba", () => {
    const g = {
      id: "g1",
      agentId: "ana",
      createdAt: 10,
      status: "achieved",
      progress: 1,
      motivation: 0.9,
      frustration: 0,
      updatedAt: 90,
      history: [
        { at: 10, status: "active", progress: 0, motivation: 0.6, frustration: 0, reason: "" },
        { at: 90, status: "achieved", progress: 1, motivation: 0.9, frustration: 0, reason: "" },
      ],
    } as unknown as Goal;
    expect(goalAt(g, 5)).toBeNull();
    expect(goalAt(g, 50)).toMatchObject({ status: "active", progress: 0 });
    expect(goalAt(g, 95)).toMatchObject({ status: "achieved", progress: 1 });
  });
});

describe("momentos", () => {
  const names = new Map([
    ["ana", "Ana"],
    ["leo", "Leo"],
    ["eva", "Eva"],
  ]);
  const speech = (conv: string, turn: number, who: string, line: string): SimEvent => ({
    id: `${conv}:${turn}`,
    time: 100 + turn,
    agentId: who,
    kind: "speech",
    text: `${names.get(who)} → Leo: "${line}"`,
    participants: [who, "leo"],
  });
  const long = Array.from({ length: 8 }, (_, i) =>
    speech(
      "c1",
      i + 1,
      i % 2 ? "leo" : "ana",
      i === 3 ? "Esta es la frase más larga de todas" : "Sí",
    ),
  );
  const short = [speech("c2", 1, "eva", "Hola"), speech("c2", 2, "leo", "Ya no me acuerdo")];
  const drama: Drama = {
    id: "d1",
    time: 200,
    kind: "argument",
    score: 0.9,
    title: "Ana y Leo discuten",
    agents: ["ana", "leo"],
    placeId: "plaza",
    eventId: "c1:4",
  };

  it("parte una frase del log", () => {
    expect(splitSpeech('Ana → Leo: "Hola, ¿qué tal?"')).toEqual({
      head: "Ana → Leo",
      line: "Hola, ¿qué tal?",
    });
    expect(splitSpeech("Ana se sienta")).toEqual({ head: "", line: "Ana se sienta" });
  });

  it("conversaciones largas, dramas y olvidos, con la frase literal", () => {
    const moments = findMoments({
      names,
      events: [...long, ...short],
      dramas: [drama, { ...drama, id: "d2", time: 250 }],
      chronicles: [],
    });
    const kinds = moments.map((m) => m.kind);
    expect(kinds.filter((k) => k === "conversation")).toHaveLength(1);
    // El drama repetido (mismo tipo y vecinos en menos de dos horas) no cuenta dos veces.
    expect(kinds.filter((k) => k === "drama")).toHaveLength(1);
    const conv = moments.find((m) => m.kind === "conversation")!;
    expect(conv).toMatchObject({
      title: "8 turnos: Ana, Leo",
      quote: "Esta es la frase más larga de todas",
    });
    expect(moments.find((m) => m.kind === "drama")!.quote).toBe(
      "Esta es la frase más larga de todas",
    );
    expect(moments.find((m) => m.kind === "forgetting")!.quote).toBe("Ya no me acuerdo");
    // De más a menos puntuación.
    const scores = moments.map((m) => m.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
  });

  it("la puntuación se explica y sube con el largo, la carga y los vecinos", () => {
    const base = { kind: "conversation" as const, textLength: 10, charge: 0, agents: 2 };
    const a = scoreMoment({ ...base, turns: 6 });
    const b = scoreMoment({ ...base, turns: 12 });
    const c = scoreMoment({ ...base, turns: 12, charge: 0.8 });
    const d = scoreMoment({ ...base, turns: 12, charge: 0.8, agents: 4 });
    expect(a.score).toBeLessThan(b.score);
    expect(b.score).toBeLessThan(c.score);
    expect(c.score).toBeLessThan(d.score);
    expect(d.why).toMatch(
      /^base 0,30 \+ largo 0,21 \(12 turnos\) \+ carga 0,24 \+ vecinos 0,24 \(4\)$/,
    );
  });

  it("la carga emocional sale de las fichas de los implicados", () => {
    const profiles = [
      {
        ownerId: "ana",
        aboutId: "leo",
        summary: "",
        affinity: -0.9,
        trust: 0.1,
        familiarity: 0.5,
        relationshipType: "rivalry" as const,
        bond: null,
        grudge: 0.5,
        lastUpdated: 0,
      },
    ];
    const plain = findMoments({ names, events: long, dramas: [], chronicles: [] })[0]!;
    const charged = findMoments({ names, events: long, dramas: [], chronicles: [], profiles })[0]!;
    expect(charged.score).toBeGreaterThan(plain.score);
  });

  it("un mismo hecho recordado distinto, metas, saberes y nombres externos", () => {
    const moments = findMoments({
      names,
      events: [],
      dramas: [],
      chronicles: [
        {
          t: 1440,
          chronicle: {
            day: 0,
            title: "Día de lluvia",
            text: "Llovió mucho en todo el pueblo. Y más.",
          },
        },
      ],
      memories: [
        {
          id: "m1",
          agentId: "ana",
          text: "Leo me gritó",
          eventId: "c1",
          createdAt: 1,
          importance: 6,
          emotionalValence: -0.6,
        },
        {
          id: "m2",
          agentId: "leo",
          text: "Ana y yo bromeamos",
          eventId: "c1",
          createdAt: 2,
          importance: 4,
          emotionalValence: 0.5,
        },
      ],
      goals: [
        {
          id: "g1",
          agentId: "eva",
          text: "Abrir un taller",
          history: [
            {
              at: 500,
              status: "achieved",
              progress: 1,
              motivation: 1,
              frustration: 0,
              reason: "lo abrió",
            },
          ],
        } as unknown as Goal,
      ],
      lore: [
        {
          id: "l1",
          kind: "recipe",
          title: "Pa amb oli",
          skill: null,
          placeId: null,
          elements: [{ id: "e1", text: "tomate" }],
          origin: "seed",
          createdAt: 0,
          lostAt: null,
        } as never,
      ],
      holders: [
        {
          loreId: "l1",
          agentId: "leo",
          fidelity: 1,
          elements: [{ id: "e1", text: "tomate", altered: false }],
          learnedFrom: "ana",
          learnedAt: 300,
          lastUsedAt: null,
          forgottenAt: null,
        },
        {
          loreId: "l1",
          agentId: "ana",
          fidelity: 1,
          elements: [],
          learnedFrom: null,
          learnedAt: 0,
          lastUsedAt: null,
          forgottenAt: null,
        },
      ],
      externals: [
        {
          at: 50,
          agentId: "leo",
          term: "Pablo",
          label: "persona inventada",
          text: "Pablo lo sabe",
        },
      ],
      from: 0,
    });
    const byKind = Object.fromEntries(moments.map((m) => [m.kind, m]));
    expect(byKind.rashomon!.quote).toBe("Ana: «Leo me gritó» / Leo: «Ana y yo bromeamos»");
    expect(byKind.goal!).toMatchObject({
      title: "Eva consigue una meta (lo abrió)",
      quote: "Abrir un taller",
    });
    expect(byKind.teaching!.agents).toEqual(["ana", "leo"]);
    expect(byKind.external!.quote).toBe("Pablo lo sabe");
    expect(byKind.chronicle!.quote).toBe("Llovió mucho en todo el pueblo.");
    expect(moments.filter((m) => m.kind === "teaching")).toHaveLength(1);
  });

  it("los mejores, con tope por tipo", () => {
    const many = Array.from({ length: 10 }, (_, i) => ({ kind: "drama", score: 1 - i / 100 }));
    const few = [{ kind: "goal", score: 0.1 }];
    const top = topMoments([...many, ...few] as never, 5, 3, 1);
    expect(top.map((m) => m.kind)).toEqual(["drama", "drama", "drama", "goal"]);
    // Con un mínimo por tipo, entra el de poca puntuación aunque no quepan todos.
    expect(topMoments([...many, ...few] as never, 2, 3, 1).map((m) => m.kind)).toEqual([
      "drama",
      "goal",
    ]);
  });
});

describe("esquema del paquete", () => {
  it("descarta lo que no está en la lista blanca", () => {
    const a = { ...agent("a"), apiKey: "sk-secreta" };
    const bundle = ReplayBundle.parse({
      format: "lethetown-replay",
      version: 1,
      meta: {
        seed: 7,
        playedOn: "2026-11-03",
        models: ["mock"],
        code: "abc1234",
        from: 0,
        to: 10,
        durationMinutes: 10,
        cost: 3.2,
        user: "admin",
      },
      world: {
        name: "x",
        width: 1,
        height: 1,
        tileSize: 16,
        places: [
          {
            id: "p",
            name: "P",
            kind: "park",
            area: { x: 0, y: 0, w: 1, h: 1 },
            indoor: false,
            anchor: { x: 0, y: 0 },
            objects: [],
          },
        ],
        collision: [0],
        lights: [],
        windows: [],
      },
      map: {},
      messages: [
        {
          t: 1,
          wallMs: 123,
          msg: {
            type: "event",
            cost: 1,
            event: { id: "e", time: 1, agentId: null, kind: "world", text: "x", email: "a@b.c" },
          },
        },
      ],
      frames: [{ time: 0, agents: [a] }],
    });
    const json = JSON.stringify(bundle);
    for (const bad of ["sk-secreta", "apiKey", "cost", "admin", "wallMs", "a@b.c"]) {
      expect(json).not.toContain(bad);
    }
  });

  it("rechaza una versión que no entiende", () => {
    expect(ReplayBundle.safeParse({ format: "lethetown-replay", version: 99 }).success).toBe(false);
  });
});

describe("así muere un recuerdo", () => {
  const names = new Map([
    ["aurora", "Aurora Vidal"],
    ["valentina", "Valentina Ríos"],
  ]);
  const audit = (action: MemoryAuditAction, at: number, reason: string) => ({
    agentId: "aurora",
    memoryId: "alma",
    memoryText: "Alma fue una amiga mía que se marchó del pueblo y nunca volvió.",
    action,
    reason,
    at,
  });
  const data = ReplayData.parse({
    ...EMPTY_REPLAY_DATA,
    memories: [
      {
        id: "alma",
        agentId: "aurora",
        text: "Alma fue una amiga mía que se marchó del pueblo y nunca volvió.",
        gist: "Tuve una amiga de juventud que se fue del pueblo.",
        createdAt: 0,
        lastAccessedAt: 100,
        importance: 3,
        emotionalValence: -0.2,
        strength: 0.9,
        source: "vivido",
        type: "observation",
        people: [],
        placeId: null,
        eventId: null,
        links: [],
        status: "active",
        forgottenAt: 900,
        meta: {},
        strengthAt: [
          [100, 0.9, "clear"],
          [500, 0.2, "vague"],
          [900, 0.04, "forgotten"],
        ],
      },
    ],
    audit: [
      audit("gist", 400, 'se volvió vago; solo queda la esencia: "Tuve una amiga de juventud."'),
      audit(
        "source_changed",
        600,
        'ya no recuerda bien quién se lo contó: "contado por valentina" → "vivido"',
      ),
      audit("reinforced", 650, "ruido"),
      audit(
        "forgotten",
        900,
        "su fuerza bajó a 0.049 (umbral de olvido 0.05) sin volver a recordarlo",
      ),
    ],
  });
  const views = new ReplayViews(data, names);

  it("en cada minuto, la curva y los cambios hasta entonces, con el motivo legible", () => {
    expect(views.story("alma", -1)).toBeNull();
    expect(views.story("nada", 500)).toBeNull();
    const mid = views.story("alma", 650)!;
    expect(mid.steps.map((s) => s.action)).toEqual(["gist", "source_changed"]);
    expect(mid.steps[0]!.detail).toEqual({ kind: "gist", gist: "Tuve una amiga de juventud." });
    expect(mid.steps[1]!.detail).toEqual({
      kind: "source",
      from: "contado por Valentina",
      to: "vivido",
    });
    expect(mid.curve.map(([t]) => t)).toEqual([100, 500, 650]);
    expect(mid.strength).toBeLessThan(0.2);
    expect(mid.forgottenAt).toBeNull();
    const end = views.story("alma", 1000, { forget: 0.05, vague: 0.3 })!;
    expect(end.clarity).toBe("forgotten");
    expect(end.forgottenAt).toBe(900);
    expect(end.steps.at(-1)!.detail).toEqual({
      kind: "forgotten",
      strength: 0.049,
      threshold: 0.05,
    });
  });

  it("un recuerdo borrado: el texto sale de la auditoría (también el falso)", () => {
    const rows = [
      {
        ...audit("false_memory", 10, "su mente rellenó los huecos: «Creo que se acordó.»"),
        memoryText: "Se acordó del aniversario.",
      },
      { ...audit("gist", 20, "se volvió vago"), memoryText: "Creo que se acordó." },
      {
        ...audit("deleted", 30, "presupuesto de memoria superado"),
        memoryText: "Creo que se acordó.",
      },
    ].map((r) => ({ ...r, memoryId: "borrado" }));
    const v = new ReplayViews(ReplayData.parse({ ...EMPTY_REPLAY_DATA, audit: rows }), names);
    expect(textFromAudit(rows, 5)).toBe("Se acordó del aniversario.");
    expect(textFromAudit(rows.slice(0, 1), 15)).toBe("Creo que se acordó.");
    const s = v.story("borrado", 15)!;
    expect(s.text).toBe("Creo que se acordó.");
    expect(s.strengthKnown).toBe(false);
    expect(s.steps[0]!.detail).toEqual({ kind: "false", text: "Creo que se acordó." });
    const end = v.story("borrado", 40)!;
    expect(end.steps.at(-1)!.action).toBe("deleted");
    expect(end.clarity).toBe("forgotten");
  });

  it("un motivo que no se sabe leer se enseña tal cual", () => {
    const s = storyStep(
      { ...audit("false_memory", 1, "mezcló dos recuerdos"), action: "false_memory" },
      names,
    );
    expect(s.detail).toEqual({ kind: "reason", reason: "mezcló dos recuerdos" });
  });
});

describe("escenas guardadas", () => {
  it("docs/videos/escenas.json es válido (ids únicos, planos en orden)", () => {
    const file = readFileSync(
      fileURLToPath(new URL("../../../../docs/videos/escenas.json", import.meta.url)),
      "utf8",
    );
    const { scenes } = ReplayScenes.parse(JSON.parse(file));
    expect(scenes.length).toBeGreaterThanOrEqual(13);
    for (const s of scenes) {
      const starts = s.shots.map((x) => x.from);
      expect(starts, s.id).toEqual([...starts].sort((a, b) => a - b));
    }
    expect(scenes.find((s) => s.id === "aniversario-partido")!.src2).toBe("s13");
  });

  it("el plano de un minuto, y rechaza planos al revés", () => {
    const shots = [
      { from: 10, to: 20 },
      { from: 50, to: 60 },
    ];
    expect(shotAt(shots, 5)).toBe(0);
    expect(shotAt(shots, 25)).toBe(1);
    expect(shotAt(shots, 60)).toBe(-1);
    expect(sceneBundlePath("s7")).toBe("/replays/s7.replay.json.gz");
    expect(() => SceneShot.parse({ from: 5, to: 4 })).toThrow();
  });
});

describe("arcos largos", () => {
  const names = new Map([
    ["julian", "Julián Ortega"],
    ["ines", "Inés Ortega"],
    ["tomas", "Tomás Herrero"],
    ["pilar", "Pilar Herrero"],
  ]);
  let n = 0;
  const say = (time: number, who: string, to: string, line: string): SimEvent => ({
    id: `c${n++}:1`,
    time,
    agentId: who,
    kind: "speech",
    text: `${names.get(who)} → ${names.get(to)}: "${line}"`,
    participants: [who, to],
  });
  const events = [
    say(100, "julian", "ines", "Inés… me da miedo quedarme solo aquí."),
    say(1600, "julian", "ines", "Me da miedo quedarme solo. Si no es molestia."),
    say(3000, "julian", "ines", "Inés, me da miedo quedarme solo en esta casa."),
    say(3001, "ines", "julian", "Ya, pero no te quedas solo. Yo estoy aquí."),
    // Otras parejas (para la rareza de las palabras).
    ...[0, 1, 2, 3].map((d) => say(d * 1440 + 50, "tomas", "pilar", "Pásame el pan, Pilar.")),
    ...[0, 1, 2].map((d) => say(d * 1440 + 60, "pilar", "tomas", "Toma el pan.")),
  ];
  const goal = (over: Partial<Goal>): Goal =>
    ({
      id: "g1",
      agentId: "julian",
      level: "project",
      parentId: null,
      text: "Contarle a Inés que me da miedo quedarme solo",
      status: "achieved",
      progress: 1,
      motivation: 1,
      frustration: 0,
      criterion: {
        type: "confirmed",
        question: "¿Le ha dicho a Inés que le da miedo quedarse solo?",
        measure: { type: "conversations", personId: "ines", topics: ["miedo"], count: 1 },
      },
      measured: 1,
      baseline: null,
      seen: [],
      resource: null,
      departure: null,
      createdAt: 50,
      updatedAt: 3100,
      lastProgressAt: 3000,
      history: [
        {
          at: 1500,
          status: "active",
          progress: 0.95,
          motivation: 1,
          frustration: 0,
          reason: "comprobado al repasar el día: aún no: no lo dijo",
        },
        {
          at: 3100,
          status: "active",
          progress: 0.95,
          motivation: 1,
          frustration: 0,
          reason: "comprobado al repasar el día: se ha logrado: se lo dijo",
        },
        {
          at: 3100,
          status: "achieved",
          progress: 1,
          motivation: 1,
          frustration: 0,
          reason: "conseguida (el motor midió el criterio)",
        },
      ],
      ...over,
    }) as Goal;

  it("lo mismo de A a B en ≥ 3 días: primero, último y cuántas veces", () => {
    const arcs = repeatedArcs({ names, events, dramas: [], chronicles: [] });
    const julian = arcs.find((a) => a.agents[0] === "julian")!;
    expect(julian.title).toMatch(/miedo/);
    expect(julian.title).toContain("en 3 días (3 veces)");
    expect(julian.span).toEqual({ from: 100, to: 3000, count: 3 });
    expect(julian.quote).toMatch(/^«Inés… me da miedo quedarme solo aquí\.» … «Inés, me da miedo/);
    // Inés solo lo dice un día.
    expect(arcs.some((a) => a.agents[0] === "ines")).toBe(false);
  });

  it("meta confirmada: la frase que lo logró y las noches que costó", () => {
    const [arc] = confirmedArcs({ names, events, dramas: [], chronicles: [], goals: [goal({})] });
    expect(arc!.subkind).toBe("confirmed");
    expect(arc!.quote).toBe("Inés, me da miedo quedarme solo en esta casa.");
    expect(arc!.time).toBe(3000);
    expect(arc!.title).toContain("tras 2 noches");
    expect(arc!.why).toContain("se lo dijo");
    // Las medibles (sin consolidación) no son de este tipo.
    expect(
      confirmedArcs({
        names,
        events,
        dramas: [],
        chronicles: [],
        goals: [
          goal({ criterion: { type: "visits", placeId: "lago", count: 1 } } as Partial<Goal>),
        ],
      }),
    ).toEqual([]);
  });

  it("recuerdos de la semilla que se apagan, con el día", () => {
    const mem = (id: string, createdAt: number) => ({
      id,
      agentId: "tomas",
      text: "No sé qué día es el aniversario.",
      eventId: null,
      createdAt,
      importance: 6,
      emotionalValence: -0.3,
    });
    const row = (memoryId: string, action: MemoryAuditAction, at: number) => ({
      agentId: "tomas",
      memoryId,
      memoryText: "No sé qué día es el aniversario.",
      action,
      reason: "",
      at,
    });
    const arcs = seedMemoryArcs({
      names,
      events: [],
      dramas: [],
      chronicles: [],
      from: 420,
      memories: [mem("seed", 410), mem("nuevo", 900)],
      audit: [
        row("seed", "gist", 2000),
        row("seed", "forgotten", 5000),
        row("nuevo", "forgotten", 6000),
      ],
    });
    expect(arcs).toHaveLength(1);
    expect(arcs[0]!.title).toBe(
      "Tomás Herrero: un recuerdo de toda la vida se vuelve vago el día 1 y se olvida el día 3",
    );
    expect(arcs[0]!.memoryId).toBe("seed");
  });

  it("dos semillas: la misma intención y cómo acabó en cada una", () => {
    const intention = (action: MemoryAuditAction, at: number, extra = "") => ({
      agentId: "tomas",
      memoryId: `i${at}`,
      memoryText: `Quiero felicitar a Pilar por nuestro aniversario.${extra}`,
      action,
      reason: "",
      at,
    });
    const input = (audit: MemoryAuditEntry[], goals: Goal[] = []) => ({
      names,
      events: [],
      dramas: [],
      chronicles: [],
      audit,
      goals,
    });
    const pairs = pairArcs(
      { label: "s7", input: input([intention("intention_kept", 430)], [goal({})]) },
      {
        label: "s13",
        input: input(
          [
            intention("intention_forgotten", 745, " Cuarenta y cinco años ya."),
            intention("intention_dropped", 2269, " Cuarenta y cinco años ya."),
          ],
          [goal({ status: "active" })],
        ),
      },
    );
    const anniversary = pairs.find((p) => p.title.includes("aniversario"))!;
    expect(anniversary.pair).toEqual({
      s7: { done: true, label: "se acordó", at: 430 },
      s13: { done: false, label: "se le pasó, luego lo dejó", at: 745 },
    });
    expect(anniversary.time).toBe(430);
    expect(pairs.find((p) => p.id.includes(":goal:"))!.title).toContain(
      "s7: la consiguió · s13: sigue en ello",
    );
  });
});
