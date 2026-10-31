/** Métricas de evolución: desde los almacenes de un mundo y desde una partida grabada en disco. */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MemoryAuditEntry, SimEvent } from "@lethetown/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootstrap, type App } from "../bootstrap";
import { loadConfig } from "../config";
import { analyzeEvolution, type EvolutionInput } from "./evolution";
import { evolutionMarkdown } from "./markdown";
import { loadStudy } from "./study-files";

let app: App;
let input: EvolutionInput;
const events: SimEvent[] = [];
const wallMs = new Map<string, number>();
let dir: string;

beforeAll(async () => {
  app = await bootstrap(
    loadConfig({ LLM_PROVIDER: "mock", EMBEDDINGS: "hash", DATABASE_URL: "", SIM_SEED: "7" }),
    () => {},
  );
  const w = app.defaultWorld;
  // Hora "real" de cada evento: un segundo por minuto de juego (como una grabación a x60).
  w.sim.onEvent((e) => {
    events.push(e);
    wallMs.set(e.id, 1_000_000 + e.time * 1000);
  });
  w.start();
  await w.clock.runUntil(w.clock.now() + 30 * 60);
  const audits: MemoryAuditEntry[] = [];
  for (const id of w.sim.agents.keys()) audits.push(...(await w.memory.store.audit(id, 100_000)));
  input = {
    seeds: app.seeds,
    events,
    wallMs,
    audits,
    socialHistory: await w.social.history(null, undefined, { limit: 100_000 }),
    llmCalls: [],
    costByTask: w.costs.summary().byTask,
    systems: w.sim.systemMetrics(),
  };
  dir = mkdtempSync(join(tmpdir(), "lethetown-estudio-"));
}, 60_000);
afterAll(async () => {
  await app.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe("evolución", () => {
  it("por día de juego: red, conversaciones, intenciones, acciones, memoria y coste", () => {
    const r = analyzeEvolution(input);
    expect(r.agents).toBe(20);
    expect(r.days.map((d) => d.day)).toEqual([0, 1]);
    expect(r.total.utterances).toBeGreaterThan(50);
    expect(r.total.pairsTalked).toBeGreaterThan(5);
    expect(r.total.pairsPct).toBeLessThan(100);
    expect(r.total.conversations.total).toBeGreaterThan(5);
    expect(r.total.intentions.proposed).toBeGreaterThan(0);
    expect(r.total.actions.say?.done).toBeGreaterThan(0);
    expect(r.cost.byTask.decide?.calls).toBeGreaterThan(0);
    expect(r.cost.bySystem["núcleo"]).toBeDefined();
    expect(r.replyLatency.replies).toBeGreaterThan(0);
    expect(r.replyLatency.meanSeconds).toBeGreaterThan(0);
    expect(Object.keys(r.speechByStyle).length).toBeGreaterThan(1);
    expect(r.systems?.agreements).toBeDefined();
    // Los días suman el total.
    expect(r.days.reduce((s, d) => s + d.utterances, 0)).toBe(r.total.utterances);
  });

  it("desde lo que graban record y world:export (y dos partidas se comparan)", () => {
    // world:export: columnas en snake_case.
    const jsonl = (rows: unknown[]) => rows.map((r) => JSON.stringify(r)).join("\n");
    const bd = mkdtempSync(join(dir, "partida-"));
    writeFileSync(
      join(bd, "sim_events.jsonl"),
      jsonl(events.map((e) => ({ ...e, agent_id: e.agentId, world_id: "default" }))),
    );
    writeFileSync(
      join(bd, "memory_audit.jsonl"),
      jsonl(
        input.audits.map((a) => ({
          agent_id: a.agentId,
          action: a.action,
          reason: a.reason,
          at: a.at,
        })),
      ),
    );
    writeFileSync(
      join(bd, "llm_calls.jsonl"),
      jsonl([
        {
          task: "decide",
          model: "claude-haiku-5-5",
          usd: 0.5,
          input_tokens: 10,
          output_tokens: 2,
          cache_read_tokens: 90,
          cache_write_tokens: 0,
          at: new Date(1_000_000 + 500 * 1000).toISOString(),
        },
      ]),
    );
    // record: los eventos llegan por el WebSocket con su hora real.
    writeFileSync(
      join(bd, "messages.jsonl"),
      jsonl(events.map((e) => ({ wallMs: wallMs.get(e.id), type: "event", event: e }))),
    );
    const fromDisk = analyzeEvolution(loadStudy(bd, app.seeds));
    expect(fromDisk.total.utterances).toBe(analyzeEvolution(input).total.utterances);
    expect(fromDisk.cost.byTask.decide).toMatchObject({ calls: 1, usd: 0.5, cacheReadPct: 90 });
    // La llamada se reparte en su día de juego (por la hora real).
    expect(fromDisk.days[0]?.usd).toBe(0.5);
    const md = evolutionMarkdown(fromDisk);
    expect(md).toContain("### En cifras");
    expect(md).toContain("### Por día de juego");
    expect(evolutionMarkdown(fromDisk, analyzeEvolution(input))).toContain("| A | B | Δ |");
  });
});
