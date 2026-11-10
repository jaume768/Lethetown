import { gzipSync } from "node:zlib";
import { AgentState, ReplayBundle, type Moment, type ServerMessage } from "@lethetown/shared";
import { describe, expect, it } from "vitest";
import { applyMessage, INITIAL_STATE } from "../net/game-state";
import { ReplayPlayer } from "../net/replay-player";
import { decodeBundle, ReplaySource } from "../net/replay-source";
import { dayAlpha, drawCineOverlay, formatPlayedOn, subtitleMs } from "../ui/cine";
import { cardsFor, safeReplaySrc } from "../ui/replay-cards";

const agent = (id: string, x: number) =>
  AgentState.parse({
    id,
    name: id === "ana" ? "Ana Gil" : "Leo Gil",
    appearance: {},
    locationId: "plaza",
    targetId: null,
    spotId: null,
    tile: { x, y: 1 },
    facing: "down",
    movement: null,
    action: "estar",
    activityKind: "idle",
    mood: { valence: 0, label: "neutral" },
    needs: { energy: 1, hunger: 0, social: 1 },
    plan: [],
    lastUtterance: null,
  });

const speech = (id: string, time: number, who: string, line: string) => ({
  t: time,
  msg: {
    type: "event" as const,
    event: {
      id,
      time,
      agentId: who,
      kind: "speech" as const,
      text: `${who} → x: "${line}"`,
      participants: [who, who === "ana" ? "leo" : "ana"],
    },
  },
});

const bundle = ReplayBundle.parse({
  format: "lethetown-replay",
  version: 1,
  meta: {
    seed: 7,
    playedOn: "2026-11-03",
    models: ["mock"],
    code: null,
    from: 100,
    to: 200,
    durationMinutes: 100,
  },
  world: {
    name: "x",
    width: 10,
    height: 3,
    tileSize: 16,
    places: [
      {
        id: "plaza",
        name: "Plaza",
        kind: "park",
        area: { x: 0, y: 0, w: 10, h: 3 },
        indoor: false,
        anchor: { x: 0, y: 0 },
        objects: [],
      },
    ],
    collision: Array(30).fill(0),
    lights: [],
    windows: [],
  },
  map: { width: 10 },
  messages: [
    speech("c1:1", 110, "ana", "Hola, Leo"),
    speech("c1:2", 111, "leo", "Hola"),
    {
      t: 112,
      msg: {
        type: "drama",
        drama: {
          id: "d1",
          time: 112,
          kind: "argument",
          score: 0.9,
          title: "Ana y Leo discuten",
          agents: ["ana", "leo"],
          placeId: "plaza",
          eventId: "c1:2",
        },
      },
    },
    { t: 150, msg: { type: "world", weather: "rain", spots: [] } },
    { t: 190, msg: { type: "chronicle", chronicle: { day: 0, title: "Lluvia", text: "Llovió." } } },
  ],
  frames: [
    { time: 100, agents: [agent("ana", 1), agent("leo", 2)] },
    { time: 150, agents: [{ id: "ana", tile: { x: 8, y: 1 } }] },
  ],
});

const reduce = (msgs: ServerMessage[], from = INITIAL_STATE) => msgs.reduce(applyMessage, from);

describe("fuente de la repetición", () => {
  const src = new ReplaySource(bundle);

  it("lee gzip y JSON, y rechaza otra versión", async () => {
    const json = JSON.stringify(bundle);
    const gz = gzipSync(json);
    const b1 = await decodeBundle(gz.buffer.slice(gz.byteOffset, gz.byteOffset + gz.length));
    expect(b1.meta.seed).toBe(7);
    const plain = new TextEncoder().encode(json).buffer;
    expect((await decodeBundle(plain)).frames).toHaveLength(2);
    const v9 = new TextEncoder().encode(JSON.stringify({ ...bundle, version: 9 })).buffer;
    await expect(decodeBundle(v9)).rejects.toThrow("Versión de paquete no soportada: 9");
  });

  it("saltar a un minuto: el mismo reductor que el WebSocket, con lo que ya pasó", () => {
    const state = reduce(src.seek(160, 0));
    expect(state.loaded).toBe(true);
    expect(state.events.map((e) => e.id)).toEqual(["c1:1", "c1:2"]);
    expect(state.dramas.map((d) => d.id)).toEqual(["d1"]);
    expect(state.weather).toBe("rain");
    expect(state.chronicles).toEqual([]);
    expect(state.agents.find((a) => a.id === "ana")!.tile).toEqual({ x: 8, y: 1 });
  });

  it("avanzar: solo lo nuevo, y un tick con todos en su sitio", () => {
    src.seek(100, 0);
    const msgs = src.advance(111, 60);
    expect(msgs.map((m) => m.type)).toEqual(["event", "event", "tick"]);
    const tick = msgs.at(-1) as Extract<ServerMessage, { type: "tick" }>;
    expect(tick.clock).toEqual({ time: 111, speed: 1, rate: 60 });
    // Entre fotos, Ana va andando hacia donde estará.
    const ana = src.advance(149, 60).at(-1) as Extract<ServerMessage, { type: "tick" }>;
    expect(ana.agents.find((a) => a.id === "ana")!.movement).not.toBeNull();
    // (El drama del minuto 112 ya salió en el paso anterior.)
    expect(src.advance(195, 60).map((m) => m.type)).toEqual(["world", "chronicle", "tick"]);
  });

  it("la API de los paneles, en el minuto de la repetición y de solo lectura", () => {
    expect(src.api("/api/chronicles", 150)).toEqual([]);
    expect(src.api("/api/chronicles", 195)).toEqual([{ day: 0, title: "Lluvia", text: "Llovió." }]);
    expect((src.api("/api/events?day=0&limit=10", 110.5) as unknown[]).length).toBe(1);
    expect(src.api("/api/agents/ana/inventory", 150)).toEqual({
      agentId: "ana",
      now: 150,
      items: [],
    });
    expect(src.api("/api/agents/ana/memory?limit=5", 150)).toMatchObject({
      agentId: "ana",
      memories: [],
    });
    expect(src.api("/api/social/graph", 150)).toMatchObject({
      nodes: [{ id: "ana" }, { id: "leo" }],
    });
    expect(src.api("/api/rashomon/c1:2", 150)).toMatchObject({
      event: { id: "c1:2" },
      accounts: [],
    });
    expect(src.api("/api/evolution", 150)).toBeUndefined();
    expect(src.api("/api/admin/budget", 150)).toBeUndefined();
  });

  it("momentos del paquete", () => {
    expect(src.moments.map((m) => m.kind).sort()).toEqual(["chronicle", "drama"]);
    expect(src.moments.find((m) => m.kind === "drama")!.quote).toBe("Hola");
  });

  it("el reproductor: play, velocidad, saltos y frases para los subtítulos", () => {
    const fed: ServerMessage[][] = [];
    const heard: string[] = [];
    const player = new ReplayPlayer(
      new ReplaySource(bundle),
      (m) => fed.push(m),
      (lines) => heard.push(...lines.map((l) => l.id)),
    );
    player.seek(109);
    expect(player.state).toMatchObject({ t: 109, playing: false, speed: 60 });
    player.seek(112);
    player.step();
    expect(heard).toEqual([]);
    player.seek(105);
    player.seek(999);
    expect(player.now()).toBe(200);
    player.seek(109.5);
    // Un paso sin reproducir no avanza; con «step» tras saltar, oye lo que quede.
    player.step();
    player.dispose();
  });
});

describe("piezas del modo cine", () => {
  it("solo paquetes de /replays/ del propio sitio", () => {
    expect(safeReplaySrc("/replays/s7.replay.json.gz")).toBe("/replays/s7.replay.json.gz");
    expect(safeReplaySrc("/replays/demo.json")).toBe("/replays/demo.json");
    for (const bad of [
      "https://malo.example/x.json.gz",
      "//malo.example/replays/x.json",
      "/replays/../api/admin.json",
      "/api/state",
      "/replays/x.html",
      "javascript:alert(1)",
    ]) {
      expect(safeReplaySrc(bad), bad).toBeNull();
    }
  });

  it("tarjetas de un momento (Rashomon solo si hay recuerdos de varios)", () => {
    const m = { kind: "teaching", agents: ["ana", "leo"], eventId: "c1" } as Moment;
    expect(cardsFor(m, () => false).map((c) => c.kind)).toEqual([
      "skills",
      "garden",
      "goals",
      "network",
    ]);
    expect(cardsFor(m, () => true)[0]).toEqual({ kind: "rashomon", eventId: "c1" });
    expect(cardsFor({ kind: "chronicle", agents: [], eventId: null } as never, () => true)).toEqual(
      [{ kind: "network" }],
    );
  });

  it("subtítulos: tiempo de lectura acotado, fecha y dibujo en el lienzo", () => {
    expect(subtitleMs("hola")).toBeLessThan(subtitleMs("una frase bastante más larga"));
    expect(subtitleMs("x".repeat(1000))).toBe(8000);
    expect(formatPlayedOn("2026-11-03")).toBe("03/11/2026");
    // El contador de días: entero y luego se apaga.
    expect(dayAlpha(5000, 1000)).toBe(1);
    expect(dayAlpha(1300, 1000)).toBeCloseTo(0.5);
    expect(dayAlpha(1000, 2000)).toBe(0);
    const calls: string[] = [];
    const ctx = new Proxy(
      {},
      {
        get: (_t, k) =>
          k === "measureText"
            ? (s: string) => ({ width: s.length * 10 })
            : typeof k === "string" && ["fillText", "fillRect", "save", "restore"].includes(k)
              ? (...a: unknown[]) => calls.push(`${k}:${String(a[0])}`)
              : undefined,
        set: () => true,
      },
    ) as CanvasRenderingContext2D;
    drawCineOverlay(ctx, 1080, 1920, {
      format: "9:16",
      lines: [{ id: "1", name: "Ana", color: "#f00", text: "Hola, Leo" }],
      watermark: ["Repetición de una partida real · mock · 03/11/2026", "lethetown.com"],
      day: { label: "Día 3", alpha: 1 },
      label: "Semilla 7",
    });
    const texts = calls.filter((c) => c.startsWith("fillText")).join("|");
    expect(texts).toContain("lethetown.com");
    expect(texts).toContain("Día 3");
    expect(texts).toContain("Semilla 7");
    expect(texts).toContain("Ana: ");
    expect(texts).toContain("Hola, Leo");
  });
});
