import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryConfig } from "@lethetown/agent-core";
import { ReplayBundle, expandFrames, parseTiledMap } from "@lethetown/shared";
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fromRoot } from "../paths";
import { buildBundle, camel, clockFrom, readExport, readRecording, strengthSamples } from "./pack";

const memory = MemoryConfig.parse({});
const tmj = JSON.parse(readFileSync(fromRoot("seeds/town.tmj"), "utf8")) as Record<string, unknown>;
const world = parseTiledMap(tmj);

const jsonl = (rows: unknown[]) => rows.map((r) => JSON.stringify(r)).join("\n") + "\n";
const SECRET = "sk-ant-SECRETO";
const EMAIL = "vecina@example.com";
const LOCAL = "/home/alguien/lethetown";

function agent(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    name: id,
    appearance: { sheet: "default" },
    locationId: "plaza",
    targetId: null,
    spotId: null,
    tile: { x: 30, y: 20 },
    facing: "down",
    movement: null,
    action: "estar",
    activityKind: "idle",
    mood: { valence: 0, arousal: 0.3, label: "tranquilo" },
    needs: { energy: 1, hunger: 0, social: 0.5 },
    plan: [],
    lastUtterance: null,
    ...extra,
  };
}

/** Una grabación pequeña con todo lo que NO debe llegar al paquete mezclado con lo bueno. */
function fixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "replay-"));
  writeFileSync(
    join(dir, "manifest.json"),
    JSON.stringify({
      sha: "0123456789abcdef0123",
      dirty: false,
      seed: 7,
      speed: 10,
      nightSpeed: 360,
      provider: "anthropic",
      models: { fast: "claude-haiku-5-5" },
      routing: { secret: SECRET },
      pricing: { "claude-haiku-5-5": { input: 1 } },
      ablation: [],
      cognition: "on",
      env: { SIM_SEED: "7", ANTHROPIC_API_KEY: SECRET, HOME: LOCAL },
      createdAt: "2026-11-03T18:51:34.597Z",
    }),
  );
  writeFileSync(
    join(dir, "meta.json"),
    JSON.stringify({ startedAt: "2026-11-03T18:51:34.597Z", outDir: LOCAL, user: EMAIL }),
  );
  writeFileSync(
    join(dir, "messages.jsonl"),
    jsonl([
      { wallMs: 1000, type: "snapshot", clock: { time: 100, speed: 10 } },
      {
        wallMs: 2000,
        type: "event",
        event: {
          id: "c1:1",
          time: 101,
          agentId: "ana",
          kind: "speech",
          text: 'ana → leo: "Hola"',
          participants: ["ana", "leo"],
          email: EMAIL,
        },
      },
      { wallMs: 2500, type: "cost", summary: { total: { usd: 99, calls: 3 } } },
      {
        wallMs: 2600,
        type: "status",
        status: { state: "paused", reason: "manual", detail: EMAIL },
      },
      { wallMs: 3000, type: "thinking", agentId: "ana", task: "decide", phase: "start", usd: 1 },
      {
        wallMs: 3000,
        type: "memory_effect",
        agentId: "ana",
        memoryId: "m1",
        kind: "recall",
        text: "un texto que el mapa no usa",
      },
      {
        wallMs: 4000,
        type: "drama",
        drama: {
          id: "d1",
          time: 103,
          kind: "argument",
          score: 0.8,
          title: "Discuten",
          agents: ["ana", "leo"],
          placeId: "plaza",
          eventId: "c1:1",
          cost: 4,
        },
      },
    ]),
  );
  writeFileSync(
    join(dir, "states.jsonl"),
    jsonl([
      { wallMs: 1000, time: 100, agents: [agent("ana", { token: SECRET }), agent("leo")] },
      { wallMs: 5000, time: 110, agents: [agent("ana", { tile: { x: 31, y: 20 } }), agent("leo")] },
    ]),
  );
  const bd = join(dir, "bd");
  mkdirSync(bd);
  const memoryRow = {
    id: "m1",
    agent_id: "ana",
    text: "Discutí con Leo",
    gist: null,
    created_at: 101,
    last_accessed_at: 101,
    importance: 7,
    emotional_valence: -0.5,
    strength: 1,
    stability: 24,
    access_count: 1,
    source: "vivido",
    type: "observation",
    people: ["leo"],
    place_id: "plaza",
    event_id: "c1",
    links: [],
    status: "active",
    forgotten_at: null,
    world_id: "default",
    meta: {},
    embedding: [0.1, 0.2],
    owner_email: EMAIL,
  };
  writeFileSync(join(bd, "memories.jsonl"), jsonl([memoryRow]));
  writeFileSync(
    join(bd, "memory_audit.jsonl"),
    jsonl([
      {
        id: 1,
        agent_id: "ana",
        memory_id: "m1",
        memory_text: "Discutí con Leo",
        action: "gist",
        reason: "esencia",
        at: 105,
        world_id: "default",
      },
      {
        id: 2,
        agent_id: "ana",
        memory_id: "m1",
        memory_text: "x",
        action: "reinforced",
        reason: "",
        at: 106,
        world_id: "default",
      },
    ]),
  );
  writeFileSync(
    join(bd, "llm_calls.jsonl"),
    jsonl([{ id: 1, model: "claude-haiku-5-5", usd: 12.5, input_tokens: 99 }]),
  );
  writeFileSync(
    join(bd, "moderation_log.jsonl"),
    jsonl([{ id: 1, text: "rechazado", user_id: EMAIL }]),
  );
  writeFileSync(
    join(bd, "users.jsonl"),
    jsonl([{ username: "admin", password_hash: SECRET, email: EMAIL }]),
  );
  writeFileSync(
    join(bd, "social_profiles.jsonl"),
    jsonl([
      {
        world_id: "default",
        owner_id: "ana",
        about_id: "leo",
        summary: "Mi vecino",
        affinity: -0.4,
        trust: 0.4,
        familiarity: 0.5,
        relationship_type: "neighbor",
        bond: null,
        grudge: 0,
        last_updated: 104,
      },
    ]),
  );
  return dir;
}

describe("paquete de repetición", () => {
  const dir = fixture();
  const bundle = buildBundle(readRecording(dir), readExport(dir), { world, map: tmj, memory });
  const json = JSON.stringify(bundle);

  it("lista blanca: ni costes, ni usuarios, ni correos, ni claves, ni rutas locales", () => {
    for (const bad of [
      SECRET,
      EMAIL,
      LOCAL,
      "usd",
      "cost",
      "password",
      "embedding",
      "rechazado",
      "wallMs",
      "un texto que el mapa no usa",
      "pricing",
      "routing",
      "ANTHROPIC",
    ]) {
      expect(json, bad).not.toContain(bad);
    }
    // Ni mensajes de coste ni de estado del director.
    expect(bundle.messages.map((m) => m.msg.type).sort()).toEqual([
      "drama",
      "event",
      "memory_effect",
      "thinking",
    ]);
    expect(ReplayBundle.safeParse(JSON.parse(json)).success).toBe(true);
  });

  it("meta: semilla, fecha, modelos y código", () => {
    expect(bundle.meta).toEqual({
      seed: 7,
      playedOn: "2026-11-03",
      models: ["claude-haiku-5-5"],
      code: "0123456789",
      from: 100,
      to: 110,
      durationMinutes: 10,
      walkTilesPerMinute: 6,
    });
  });

  it("fotos por diferencias y minuto de juego de cada mensaje", () => {
    expect(bundle.frames[1]!.agents).toEqual([{ id: "ana", tile: { x: 31, y: 20 } }]);
    expect(expandFrames(bundle.frames)[1]!.byId.get("ana")!.tile).toEqual({ x: 31, y: 20 });
    // «pensando» no trae minuto: sale de la hora real (entre el 101 a 2000 ms y el 110 a 5000 ms).
    expect(bundle.messages.find((m) => m.msg.type === "thinking")!.t).toBeCloseTo(104);
  });

  it("los datos de los paneles, sin el ruido de la auditoría", () => {
    expect(bundle.data!.memories.map((m) => m.text)).toEqual(["Discutí con Leo"]);
    expect(bundle.data!.audit.map((a) => a.action)).toEqual(["gist"]);
    expect(bundle.data!.profiles[0]).toMatchObject({ ownerId: "ana", affinity: -0.4 });
  });

  it("recorta por minutos", () => {
    const cut = buildBundle(readRecording(dir), null, {
      world,
      map: tmj,
      memory,
      from: 105,
      to: 110,
    });
    expect(cut.frames).toHaveLength(1);
    expect(cut.frames[0]!.agents).toHaveLength(2);
    expect(cut.messages).toEqual([]);
    expect(cut.data).toBeUndefined();
  });
});

describe("piezas", () => {
  it("camelCase del primer nivel", () => {
    expect(camel({ agent_id: "a", last_accessed_at: 1, meta: { a_b: 1 } })).toEqual({
      agentId: "a",
      lastAccessedAt: 1,
      meta: { a_b: 1 },
    });
  });

  it("de hora real a minuto de juego, interpolando", () => {
    const toGame = clockFrom([
      { wallMs: 0, time: 10 },
      { wallMs: 1000, time: 20 },
    ]);
    expect(toGame(-5)).toBe(10);
    expect(toGame(500)).toBe(15);
    expect(toGame(9999)).toBe(20);
  });

  it("la fuerza muestreada se apaga y para al olvidarse", () => {
    const s = strengthSamples(
      { strength: 1, stability: 2, lastAccessedAt: 0, createdAt: 0 },
      0,
      10_000,
      memory.retrieval,
    );
    expect(s[0]).toEqual([0, 1, "clear"]);
    expect(s.at(-1)![2]).toBe("forgotten");
    expect(s.length).toBeLessThan(10);
    for (let i = 1; i < s.length; i++) expect(s[i]![1]).toBeLessThanOrEqual(s[i - 1]![1]);
  });
});
