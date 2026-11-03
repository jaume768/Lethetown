/** Noche rápida (SIM_NIGHT_SPEED): cuándo acelera el reloj, cuándo vuelve y que no oscila. */
import { describe, expect, it } from "vitest";
import { bootstrap } from "../bootstrap";
import { loadConfig } from "../config";
import { liveState } from "../worlds/gateway";
import { GameClock } from "./clock";
import { NightSpeed } from "./night-speed";

const at = (day: number, h: number, m = 0) => day * 1440 + h * 60 + m;

function setup(start = at(0, 23, 30)) {
  const clock = new GameClock(start, 10);
  const state = { asleep: true, conversations: 0 };
  const notes: string[] = [];
  const night = new NightSpeed({
    clock,
    nightSpeed: 360,
    wakeMarginMinutes: 30,
    everyoneAsleep: () => state.asleep,
    conversations: () => state.conversations,
    notify: (t) => notes.push(t),
  });
  night.update();
  /** Avanza el reloj minuto a minuto, reevaluando como lo harían los ticks. */
  const advance = async (minutes: number) => {
    const end = clock.now() + minutes;
    for (let t = Math.floor(clock.now()) + 1; t <= end; t++) {
      await clock.runUntil(t);
      night.update();
    }
  };
  return { clock, state, notes, night, advance };
}

describe("GameClock: noche rápida", () => {
  it("el ritmo sube sin cambiar la velocidad elegida; en pausa no corre", () => {
    const clock = new GameClock(0, 10);
    clock.setBoost(360);
    expect(clock.speed).toBe(10);
    expect(clock.rate).toBe(360);
    clock.setSpeed(0);
    expect(clock.rate).toBe(0);
    clock.setSpeed(10);
    clock.setBoost(null);
    expect(clock.rate).toBe(10);
  });

  it("con el reloj en marcha, el tiempo de juego avanza al ritmo de la noche", () => {
    let real = 0;
    const clock = new GameClock(0, 10, undefined, () => real);
    clock.start();
    real += 60_000;
    expect(clock.now()).toBeCloseTo(10);
    clock.setBoost(360);
    real += 60_000;
    expect(clock.now()).toBeCloseTo(370);
    clock.stop();
  });
});

describe("NightSpeed", () => {
  it("acelera solo tras 15 min de juego con todos dormidos y nada pendiente", async () => {
    const { clock, notes, advance } = setup();
    await advance(14);
    expect(clock.rate).toBe(10);
    await advance(1);
    expect(clock.rate).toBe(360);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatch(/x360/);
  });

  it("nadie se despierta con reflexiones pendientes: con una llamada en curso no acelera", async () => {
    const { clock, night, advance } = setup();
    night.callStarted("consolidate");
    await advance(120);
    expect(clock.rate).toBe(10);
    // Acaba la consolidación: la calma empieza ahora.
    night.callEnded("consolidate");
    await advance(14);
    expect(clock.rate).toBe(10);
    await advance(1);
    expect(clock.rate).toBe(360);
  });

  it("una llamada nueva (la crónica, una decisión) frena enseguida", async () => {
    const { clock, night, notes, advance } = setup();
    await advance(15);
    expect(clock.rate).toBe(360);
    night.callStarted("chronicle");
    expect(clock.rate).toBe(10);
    expect(notes.at(-1)).toMatch(/tareas del LLM pendientes.*x10/);
  });

  it("el mantenimiento de la memoria impide entrar, pero ya dentro no frena", async () => {
    const { clock, night, advance } = setup();
    night.callStarted("summarize");
    await advance(30);
    expect(clock.rate).toBe(10);
    night.callEnded("summarize");
    await advance(15);
    expect(clock.rate).toBe(360);
    night.callStarted("gist");
    await advance(5);
    expect(clock.rate).toBe(360);
    night.callEnded("gist");
    expect(clock.rate).toBe(360);
  });

  it("no acelera antes de la crónica de las 23:00 ni con alguien despierto o hablando", async () => {
    const early = setup(at(0, 22, 10));
    await early.advance(45);
    expect(early.clock.rate).toBe(10);
    await early.advance(19);
    expect(early.clock.rate).toBe(360);

    const awake = setup();
    awake.state.asleep = false;
    await awake.advance(60);
    expect(awake.clock.rate).toBe(10);

    const talking = setup();
    talking.state.conversations = 1;
    await talking.advance(60);
    expect(talking.clock.rate).toBe(10);
  });

  it("vuelve a x10 justo en el margen antes de despertar (06:30), aunque no haya ticks", async () => {
    const { clock, notes, night, advance } = setup(at(0, 23, 30));
    await advance(15);
    expect(clock.rate).toBe(360);
    // Sin reevaluar a mano: lo hace el evento programado al acelerar.
    await clock.runUntil(at(1, 6, 29));
    expect(clock.rate).toBe(360);
    await clock.runUntil(at(1, 6, 30));
    expect(clock.rate).toBe(10);
    expect(notes.at(-1)).toMatch(/hora de despertar/);
    // Ya no vuelve a acelerar de día.
    await advance(120);
    night.update();
    expect(clock.rate).toBe(10);
  });

  it("no oscila: llamadas cortas y seguidas no lo encienden y apagan cada vez", async () => {
    const { clock, night, notes, advance } = setup();
    await advance(15);
    expect(clock.rate).toBe(360);
    // Una llamada corta cada 5 min de juego durante una hora.
    for (let i = 0; i < 12; i++) {
      night.callStarted("social");
      await advance(1);
      night.callEnded("social");
      await advance(4);
    }
    expect(clock.rate).toBe(10);
    // Una sola bajada (y ninguna subida mientras siga habiendo actividad).
    expect(notes).toHaveLength(2);
    await advance(15);
    expect(clock.rate).toBe(360);
  });

  it("en pausa no acelera; desactivada (0) no hace nada", async () => {
    const paused = setup();
    paused.clock.setSpeed(0);
    await paused.advance(30);
    expect(paused.clock.boost).toBeNull();

    const clock = new GameClock(at(0, 23, 30), 10);
    const off = new NightSpeed({
      clock,
      nightSpeed: 0,
      wakeMarginMinutes: 30,
      everyoneAsleep: () => true,
      conversations: () => 0,
      notify: () => {},
    });
    await clock.runUntil(at(1, 3));
    off.update();
    expect(clock.rate).toBe(10);
  });
});

describe("noche rápida en un mundo (mock)", () => {
  const env = {
    LLM_PROVIDER: "mock",
    EMBEDDINGS: "hash",
    DATABASE_URL: "",
    SIM_SEED: "7",
    SIM_SPEED: "10",
    SIM_NIGHT_SPEED: "360",
  };

  it("acelera de madrugada tras consolidar y vuelve a x10 a las 06:30", async () => {
    const app = await bootstrap(loadConfig(env), () => {});
    const w = app.defaultWorld;
    const notes: { time: number; text: string }[] = [];
    w.sim.onEvent((e) => {
      if (e.kind === "system" && /noche rápida/i.test(e.text))
        notes.push({ time: e.time, text: e.text });
    });
    const consolidated = new Set<string>();
    w.sim.onEvent((e) => {
      if (e.kind === "memory" && e.agentId && e.text.includes("consolida el día"))
        consolidated.add(e.agentId);
    });
    w.start();
    await w.clock.runUntil(at(1, 3));
    expect(w.clock.speed).toBe(10);
    expect(w.clock.rate).toBe(360);
    expect(liveState(w).rate).toBe(360);
    // Nadie acelera la noche antes de la crónica ni sin haber consolidado.
    const first = notes.find((n) => n.text.startsWith("⏩"))!;
    expect(first.time).toBeGreaterThanOrEqual(at(0, 23, 15));
    expect(consolidated.size).toBe(20);
    await w.clock.runUntil(at(1, 6, 31));
    expect(w.clock.rate).toBe(10);
    expect(notes.at(-1)!.text).toMatch(/hora de despertar/);
    // Una subida y una bajada en toda la noche: el mantenimiento horario no la corta.
    expect(notes.map((n) => n.text[0])).toEqual(["⏩", "▶"]);
    await app.close();
  }, 30_000);

  it("sin SIM_NIGHT_SPEED, la noche va a SIM_SPEED", async () => {
    const app = await bootstrap(loadConfig({ ...env, SIM_NIGHT_SPEED: "0" }), () => {});
    const w = app.defaultWorld;
    w.start();
    await w.clock.runUntil(at(1, 3));
    expect(w.clock.rate).toBe(10);
    await app.close();
  }, 30_000);
});
