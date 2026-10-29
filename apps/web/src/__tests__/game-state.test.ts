import { AgentState, type ServerMessage } from "@lethetown/shared";
import { describe, expect, it } from "vitest";
import {
  INITIAL_STATE,
  MAX_DRAMAS,
  MAX_EVENTS,
  applyMessage,
  worldApiPath,
  type GameState,
} from "../net/game-state";

const agent = (id: string, action = "estar") =>
  AgentState.parse({
    id,
    name: id,
    appearance: {},
    locationId: "plaza",
    targetId: null,
    spotId: null,
    tile: { x: 0, y: 0 },
    facing: "down",
    movement: null,
    action,
    activityKind: "idle",
    mood: { valence: 0, label: "neutral" },
    needs: { energy: 1, hunger: 0, social: 1 },
    plan: [],
    lastUtterance: null,
  });

const run = (msgs: ServerMessage[], from: GameState = INITIAL_STATE) =>
  msgs.reduce(applyMessage, from);

describe("estado de la partida en el cliente", () => {
  it("delta: actualiza los que cambian, quita los borrados y añade los nuevos", () => {
    const s0 = { ...INITIAL_STATE, agents: [agent("a"), agent("b")] };
    const s1 = applyMessage(s0, {
      type: "delta",
      clock: { time: 10, speed: 10 },
      agents: [agent("a", "leer"), agent("c")],
      removed: ["b"],
    });
    expect(s1.agents.map((a) => [a.id, a.action])).toEqual([
      ["a", "leer"],
      ["c", "estar"],
    ]);
    expect(s1.clock.time).toBe(10);
    // Un delta sin agentes solo mueve el reloj (misma lista).
    const s2 = applyMessage(s1, {
      type: "delta",
      clock: { time: 20, speed: 10 },
      agents: [],
      removed: [],
    });
    expect(s2.agents).toBe(s1.agents);
  });

  it("pensando: cuenta llamadas en curso sin bajar de cero", () => {
    const s = run([
      { type: "thinking", agentId: "a", task: "decide", phase: "start" },
      { type: "thinking", agentId: "a", task: "decide", phase: "end" },
      { type: "thinking", agentId: "a", task: "plan", phase: "end" },
    ]);
    expect(s.thinking.a).toEqual({ count: 0, task: "plan" });
  });

  it("dramas: el más reciente primero, sin repetidos y con tope", () => {
    const drama = (id: string) => ({
      type: "drama" as const,
      drama: {
        id,
        time: 0,
        kind: "rumor" as const,
        score: 1,
        title: id,
        agents: [],
        placeId: null,
        eventId: null,
      },
    });
    const s = run([drama("x"), drama("y"), drama("x")]);
    expect(s.dramas.map((d) => d.id)).toEqual(["x", "y"]);
    const many = run(Array.from({ length: MAX_DRAMAS + 5 }, (_, i) => drama(`d${i}`)));
    expect(many.dramas).toHaveLength(MAX_DRAMAS);
  });

  it("eventos con tope; crónicas sustituidas por día; los efectos de memoria no cambian nada", () => {
    const events = Array.from({ length: MAX_EVENTS + 3 }, (_, i) => ({
      type: "event" as const,
      event: {
        id: `e${i}`,
        time: i,
        agentId: null,
        kind: "action" as const,
        text: "",
        participants: [],
      },
    }));
    expect(run(events).events).toHaveLength(MAX_EVENTS);
    const s = run([
      { type: "chronicle", chronicle: { day: 1, title: "a", text: "" } },
      { type: "chronicle", chronicle: { day: 1, title: "b", text: "" } },
    ]);
    expect(s.chronicles.map((c) => c.title)).toEqual(["b"]);
    const same = applyMessage(s, {
      type: "memory_effect",
      agentId: "a",
      memoryId: "m",
      kind: "recall",
      text: "",
    });
    expect(same).toBe(s);
  });

  it("mundo: cambia el tiempo y el estado de los objetos", () => {
    const world = {
      name: "x",
      width: 1,
      height: 1,
      tileSize: 16,
      places: [{ id: "p", objects: [{ id: "cafetera", state: "idle" }] }],
    } as unknown as GameState["world"];
    const s = applyMessage(
      { ...INITIAL_STATE, world },
      {
        type: "world",
        weather: "rain",
        spots: [{ id: "cafetera", state: "rota" }],
      },
    );
    expect(s.weather).toBe("rain");
    expect(s.world?.places[0]?.objects[0]?.state).toBe("rota");
  });

  it("rutas de la API por mundo (salvo las generales)", () => {
    expect(worldApiPath("/api/agents/lucia/memory", "w 1")).toBe(
      "/api/worlds/w%201/agents/lucia/memory",
    );
    expect(worldApiPath("/api/auth/login", "w")).toBe("/api/auth/login");
    expect(worldApiPath("/otra", "w")).toBe("/otra");
  });
});
