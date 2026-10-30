/** Factorías de los mundos: abrir un mundo (mapa, LLM, memoria, simulación, instantáneas). */
import {
  formatGameTime,
  InMemorySocialProfileStore,
  LLMConsolidator,
  type SocialProfileStore,
  type MemoryStore,
} from "@lethetown/agent-core";
import {
  RUNNING,
  SIM_SPEEDS,
  parseTiledMap,
  type SimSpeed,
  type WorldRunStatus,
} from "@lethetown/shared";
import { z } from "zod";
import { PgMemoryStore } from "../db/pg-memory-store";
import {
  InMemoryChronicleStore,
  InMemoryEventStore,
  InMemoryDramaStore,
  PgDramaStore,
  type DramaStore,
  PgChronicleStore,
  PgEventStore,
  PgSocialProfileStore,
  type ChronicleStore,
  type EventStore,
} from "../db/stores";
import { type WorldRow } from "../db/worlds";
import { GameClock } from "../sim/clock";
import { DramaDetector } from "../sim/dramas";
import { Simulation } from "../sim/simulation";
import { parseSnapshot } from "../sim/snapshot";
import { WorldMap } from "../sim/world";
import { readJson } from "./files";
import {
  InMemoryCommitmentStore,
  PgCommitmentStore,
  type CommitmentStore,
} from "../db/commitments";
import {
  InMemoryKnownPlaceStore,
  PgKnownPlaceStore,
  type KnownPlaceStore,
} from "../db/known-places";
import { InMemoryItemStore, PgItemStore, type ItemStore } from "../db/items";
import { InMemoryNoteStore, PgNoteStore, type NoteStore } from "../db/notes";
import { describeReport, pruneGlobalPg, pruneWorldPg, pruneWorldRam } from "../retention";
import { createWorldLlm } from "./llm";
import { createMaintenance, createWorldMemory } from "./memory";
import { createUserTextVetter } from "./security";
import type { Services, WorldRuntime } from "./types";

/** Mapa Tiled: fuente única de verdad del mundo (lo genera `pnpm map:generate`). */
export const MAP_FILE = "seeds/town.tmj";

/** Cada cuántos minutos de juego se guarda una instantánea. */
const SNAPSHOT_EVERY = 60;

/** La simulación arranca a las 06:50 del día 0 (o al día siguiente del último recuerdo guardado). */
const START_MINUTE_OF_DAY = 6 * 60 + 50;

/** Ruta de mapa segura: solo .tmj dentro de seeds/ (la ruta sale de la BD o de la API). */
export function safeMapPath(map: string): string {
  if (!/^seeds\/[\w-]+\.tmj$/.test(map)) throw new Error(`Mapa no permitido: ${map}`);
  return map;
}

/** Crea el runtime de un mundo y, si hay una instantánea, restaura su estado. */
export async function openWorld(services: Services, row: WorldRow): Promise<WorldRuntime> {
  const { config, db, log } = services;
  const worldLog = (msg: string) => log(`[${row.id}] ${msg}`);
  const tmj = await readJson(z.unknown(), safeMapPath(row.map));
  const worldMap = new WorldMap(parseTiledMap(tmj));
  const { llm, costs } = createWorldLlm(services, row, worldLog);
  const { store, rng, guard, memory } = createWorldMemory(services, row, llm, worldLog);
  const seedNames = new Map(services.seeds.map((s) => [s.id, s.name]));
  // El reloj y la simulación se crean más abajo; el detector los consulta al ocurrir algo.
  let clockRef: GameClock | null = null;
  let placeOf: (agentId: string) => string | null = () => null;
  const detector = new DramaDetector({
    now: () => clockRef?.now() ?? 0,
    name: (id) => seedNames.get(id) ?? id,
    placeOf: (id) => placeOf(id),
  });
  // La ficha social se observa para detectar discusiones y amistades.
  const rawSocial = db ? new PgSocialProfileStore(db.db, row.id) : new InMemorySocialProfileStore();
  const social: SocialProfileStore = detector.observe(rawSocial);
  const dramas: DramaStore = db ? new PgDramaStore(db.db, row.id) : new InMemoryDramaStore();
  const events: EventStore = db ? new PgEventStore(db.db, row.id) : new InMemoryEventStore();
  const commitments: CommitmentStore = db
    ? new PgCommitmentStore(db.db, row.id)
    : new InMemoryCommitmentStore();
  const notes: NoteStore = db ? new PgNoteStore(db.db, row.id) : new InMemoryNoteStore();
  const items: ItemStore = db ? new PgItemStore(db.db, row.id) : new InMemoryItemStore();
  const knownPlaces: KnownPlaceStore = db
    ? new PgKnownPlaceStore(db.db, row.id)
    : new InMemoryKnownPlaceStore();
  const chronicles: ChronicleStore = db
    ? new PgChronicleStore(db.db, row.id)
    : new InMemoryChronicleStore();
  const seeds = services.seeds;
  const names = () => seeds.map((s) => ({ id: s.id, name: s.name }));
  const maintenance = createMaintenance(memory, llm, rng, worldLog);

  const saved = await services.snapshots.latest(row.id);
  const snapshot = saved ? parseSnapshot(saved.data) : null;
  if (saved && !snapshot) worldLog("⚠ Instantánea de otra versión o corrupta: se ignora.");
  const speed: SimSpeed =
    snapshot?.speed ??
    (SIM_SPEEDS.includes(config.SIM_SPEED as SimSpeed) ? (config.SIM_SPEED as SimSpeed) : 10);
  const startTime = snapshot?.time ?? (await resumeTime(store));
  const clock = new GameClock(startTime, speed, (e) => worldLog(`⚠ Error en evento: ${String(e)}`));
  clockRef = clock;
  const sim = new Simulation({
    world: worldMap,
    seeds,
    llm,
    memory,
    clock,
    tickMinutes: config.SIM_TICK_MINUTES,
    walkSpeed: config.SIM_WALK_TILES_PER_MINUTE,
    replyDelayMinutes: config.SIM_REPLY_DELAY_MINUTES,
    social,
    events,
    chronicles,
    consolidator: new LLMConsolidator(llm, memory, social, names),
    maintenance,
    rng,
    language: row.language,
    demoEveryMinutes: config.SIM_DEMO === "on" ? config.SIM_DEMO_EVERY_MINUTES : undefined,
    commitments,
    knownPlaces,
    items,
    notes,
    discoveryRadius: config.SIM_DISCOVERY_RADIUS,
    track: (w) => services.track(w),
  });
  placeOf = (id) => sim.agents.get(id)?.state.locationId ?? null;
  sim.onEvent((e) => detector.onEvent(e));
  memory.onEffect((e) => detector.onEffect(e));
  detector.onDrama((d) => {
    services.track(
      dramas.add(d).catch((e: unknown) => worldLog(`⚠ No se pudo guardar el drama: ${String(e)}`)),
    );
    sim.notifyDrama(d);
  });
  sim.onEvent((e) =>
    services.track(
      events
        .add(e)
        .catch((err: unknown) => worldLog(`⚠ No se pudo guardar el evento: ${String(err)}`)),
    ),
  );
  sim.onEvent((e) => services.metrics.simEvents.inc({ world: row.id, kind: e.kind }));
  sim.onTick(() => services.metrics.simTicks.inc({ world: row.id }));
  const seeded = await sim.seedMemoriesIfEmpty(startTime);
  if (seeded) worldLog(`Sembrados los recuerdos iniciales de ${seeded} agentes.`);
  sim.setMeetingSeq(await commitments.maxSeq());
  if (snapshot) {
    sim.restore(snapshot);
    worldLog(`Estado restaurado de la instantánea de ${formatGameTime(snapshot.time)}.`);
  }
  await sim.syncKnownPlaces();
  sim.loadItems(snapshot ? [] : await items.listAll());
  sim.loadNotes(snapshot ? [] : await notes.active(startTime));

  const saveSnapshot = (reason: string) =>
    services.snapshots.save(row.id, clock.now(), reason, sim.snapshot());
  const scheduleHourly = (from: number) => {
    const next = (Math.floor(from / SNAPSHOT_EVERY) + 1) * SNAPSHOT_EVERY;
    clock.schedule(next, () => {
      // La foto se toma ya (síncrona); la escritura no frena el reloj.
      services.track(
        saveSnapshot("hourly").catch((e: unknown) =>
          worldLog(`⚠ No se pudo guardar la instantánea: ${String(e)}`),
        ),
      );
      scheduleHourly(next);
    });
  };

  let status: WorldRunStatus =
    row.status === "paused" ? { state: "paused", reason: "manual", detail: "Pausado" } : RUNNING;
  /** Velocidad a la que volver al reanudar. */
  let resumeSpeed: SimSpeed = speed === 0 ? 10 : speed;
  if (status.state === "paused") clock.setSpeed(0);
  const setStatus = (next: WorldRunStatus) => {
    status = next;
    sim.notifyStatus(next);
    services.track(
      services.worldRepo
        .setStatus(row.id, next.state)
        .catch((e: unknown) => worldLog(`⚠ No se pudo guardar el estado: ${String(e)}`)),
    );
  };

  return {
    id: row.id,
    name: row.name,
    tmj,
    world: worldMap,
    sim,
    clock,
    memory,
    llm,
    social,
    events,
    chronicles,
    dramas,
    commitments,
    knownPlaces,
    items,
    notes,
    costs,
    restoredFrom: snapshot?.time ?? null,
    status: () => status,
    pause(reason, detail) {
      // Una pausa "más fuerte" (kill switch) sustituye a una manual o por falta de público.
      if (status.state === "paused" && status.reason === reason) return;
      if (clock.speed !== 0) resumeSpeed = clock.speed;
      clock.setSpeed(0);
      setStatus({ state: "paused", reason, detail });
      worldLog(`⏸ ${detail}`);
    },
    resume() {
      const blocked = services.budget.blockReason(row.id);
      if (blocked) return { ok: false, error: blocked };
      if (status.state === "running") return { ok: true };
      clock.setSpeed(resumeSpeed);
      setStatus(RUNNING);
      return { ok: true };
    },
    vetUserText: createUserTextVetter(services, row, llm, guard, worldLog),
    start() {
      sim.start();
      scheduleHourly(clock.now());
    },
    saveSnapshot,
    async prune() {
      // Retención: lo más antiguo se borra o se resume (ver retention.ts).
      return db
        ? pruneWorldPg(db.db, row.id, clock.now(), services.retention)
        : pruneWorldRam(
            { memory: store, social: rawSocial, events },
            clock.now(),
            services.retention,
          );
    },
    async close() {
      clock.stop();
      await saveSnapshot("shutdown").catch((e: unknown) =>
        worldLog(`⚠ No se pudo guardar la instantánea de apagado: ${String(e)}`),
      );
    },
  };
}

/**
 * Enlaza los servicios compartidos con los mundos que corre este proceso: la Batch API solo si
 * ningún mundo va más rápido que LLM_BATCH_MAX_SPEED.
 */
export function attachWorlds(services: Services, worlds: () => Iterable<WorldRuntime>): void {
  const max = services.config.LLM_BATCH_MAX_SPEED;
  services.setBatchGate(() =>
    [...worlds()].every((w) => w.clock.speed === 0 || w.clock.speed <= max),
  );
}

async function resumeTime(store: MemoryStore): Promise<number> {
  const latest = store instanceof PgMemoryStore ? await store.latestGameTime() : 0;
  // Los recuerdos sembrados llevan la hora de inicio: solo reanudamos si hubo simulación real.
  if (latest <= START_MINUTE_OF_DAY) return START_MINUTE_OF_DAY;
  return (Math.floor(latest / 1440) + 1) * 1440 + START_MINUTE_OF_DAY;
}

/**
 * Job de retención del proceso: cada `everyMinutes` minutos reales poda cada mundo y, con
 * Postgres, las tablas globales. Devuelve con qué pararlo.
 */
export function startRetention(
  services: Services,
  worlds: () => Iterable<WorldRuntime>,
): () => void {
  const cfg = services.retention;
  if (!cfg.enabled) return () => {};
  const run = async () => {
    try {
      for (const w of worlds()) {
        const r = await w.prune();
        if (Object.values(r).some((n) => n > 0))
          services.log(`[${w.id}] 🧹 Retención: ${describeReport(r)}`);
      }
      if (services.db) {
        const g = await pruneGlobalPg(services.db.db, cfg);
        if (Object.values(g).some((n) => n > 0))
          services.log(`🧹 Retención global: ${describeReport(g)}`);
      }
    } catch (e) {
      services.log(`⚠ Error en la retención: ${String(e)}`);
    }
  };
  const timer = setInterval(() => void run(), cfg.everyMinutes * 60_000);
  timer.unref();
  return () => clearInterval(timer);
}
