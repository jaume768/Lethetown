/**
 * Proceso sim-worker: ejecuta hasta WORKER_MAX_WORLDS mundos. Se reparte el trabajo con otros
 * workers mediante leases en Postgres y habla con el proceso `api` por LISTEN/NOTIFY: publica
 * el estado vivo, las señales y los costes, y ejecuta las órdenes que le llegan.
 * Necesita Postgres (sin él, `pnpm dev` corre los mundos dentro del proceso api).
 */
import { hostname } from "node:os";
import { randomUUID } from "node:crypto";
import { attachWorlds, createServices, openWorld, type WorldRuntime } from "./bootstrap";
import { CHANNELS, PgBus } from "./bus/pg-bus";
import { AdminBusMessage, CommandBusMessage, ViewersBusMessage } from "./bus/protocol";
import { isProduction, loadConfig } from "./config";
import { worlds as worldsTable } from "./db/schema";
import { formatEvent } from "./log";
import { createLogger, initSentry } from "./observability";
import { loadKillSwitch, refreshBudget } from "./worker/shared";
import { LeaseManager } from "./worker/leases";
import { liveState, runCommand } from "./worlds/gateway";
import { ViewerPolicy } from "./worlds/viewers";
import { eq, inArray } from "drizzle-orm";

const LIVE_WITH_VIEWERS_MS = 500;
const LIVE_IDLE_MS = 10_000;
const BUDGET_REFRESH_MS = 30_000;
/** Si el api deja de mandar espectadores, se asume que no hay nadie mirando. */
const VIEWERS_STALE_MS = 15_000;

const config = loadConfig();
await initSentry(config, "sim-worker");
const logger = createLogger(config, "sim-worker");
const log = (msg: string) => logger.info(msg);
if (!config.DATABASE_URL) {
  log("Sin DATABASE_URL: el sim-worker necesita Postgres. El proceso api corre los mundos.");
  process.exit(0);
}
const services = await createServices(config, log, "sim-worker");
if (!services.db) {
  log("Postgres no disponible: el sim-worker no arranca (el api corre los mundos).");
  process.exit(0);
}
const db = services.db;
const owner = `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;
const leases = new LeaseManager(db.db, owner, config.WORKER_LEASE_SECONDS * 1000);
const bus = await PgBus.connect(config.DATABASE_URL, db.pool, db.db, log);
const running = new Map<string, WorldRuntime>();
const viewers = new Map<string, { count: number; at: number }>();
const policy = new ViewerPolicy(config);
attachWorlds(services, () => running.values());
services.budget.setKilled(await loadKillSwitch(db.db));
await refreshBudget(services);

const viewersOf = (id: string) => {
  const v = viewers.get(id);
  return v && Date.now() - v.at < VIEWERS_STALE_MS ? v.count : 0;
};

const publish = (msg: unknown) =>
  void bus.publish(CHANNELS.world, msg).catch((e: unknown) => log(`⚠ Bus: ${String(e)}`));

async function start(id: string): Promise<void> {
  const [row] = await db.db.select().from(worldsTable).where(eq(worldsTable.id, id));
  if (!row) return;
  const w = await openWorld(services, {
    ...row,
    status: row.status === "paused" ? "paused" : "running",
  });
  w.sim.onSignal((signal) => publish({ kind: "signal", w: id, signal }));
  w.sim.onEvent((e) => {
    if (isProduction(config)) logger.debug({ world: id, event: e }, "evento");
    else console.log(`[${id}] ${formatEvent(e)}`);
  });
  // Costes: como mucho un aviso por segundo y mundo.
  let costTimer: NodeJS.Timeout | null = null;
  w.costs.onRecord(() => {
    costTimer ??= setTimeout(() => {
      costTimer = null;
      publish({
        kind: "cost",
        w: id,
        summary: w.costs.summary(),
        unpricedModels: [...w.costs.unpricedModels],
      });
    }, 1000);
  });
  if (services.budget.killed) w.pause("kill_switch", "Kill switch activado por un administrador");
  w.start();
  w.clock.start();
  running.set(id, w);
  log(`▶ Mundo ${id} en marcha en ${owner}`);
}

async function stop(id: string, save: boolean): Promise<void> {
  const w = running.get(id);
  if (!w) return;
  running.delete(id);
  if (save) await w.close();
  else w.clock.stop();
  log(`■ Mundo ${id} detenido${save ? "" : " (lease perdida)"}`);
}

// Órdenes del api para los mundos de este worker.
await bus.subscribe(CHANNELS.command, (raw) => {
  const parsed = CommandBusMessage.safeParse(raw);
  if (!parsed.success) return;
  const { requestId, worldId, cmd } = parsed.data;
  const w = running.get(worldId);
  if (!w) return; // Lo tiene otro worker.
  void runCommand(w, cmd)
    .catch((e: unknown) => ({ ok: false as const, status: 500, error: String(e) }))
    .then((result) => {
      // El estado cambió: que el api lo vea ya, haya o no espectadores.
      publish({ kind: "live", w: worldId, live: liveState(w) });
      return bus.reply(requestId, result);
    });
});

await bus.subscribe(CHANNELS.viewers, (raw) => {
  const parsed = ViewersBusMessage.safeParse(raw);
  if (!parsed.success) return;
  for (const [id, count] of Object.entries(parsed.data.counts)) {
    viewers.set(id, { count, at: Date.now() });
  }
});

await bus.subscribe(CHANNELS.admin, (raw) => {
  const parsed = AdminBusMessage.safeParse(raw);
  if (!parsed.success) return;
  const msg = parsed.data;
  if (msg.kind === "kill") {
    services.budget.setKilled(msg.on);
    if (msg.on) {
      for (const w of running.values())
        w.pause("kill_switch", "Kill switch activado por un administrador");
    }
  } else if (msg.kind === "budget") {
    void bus.reply(msg.requestId, { owner, ...services.budget.status() });
  }
});

// Leases: renovar, soltar las perdidas y reclamar mundos libres.
async function leaseLoop(): Promise<void> {
  try {
    const lost = await leases.renew([...running.keys()]);
    for (const id of lost) await stop(id, false);
    // Mundos que un admin ha parado: se guardan y se suelta su lease.
    if (running.size) {
      const rows = await db.db
        .select({ id: worldsTable.id, status: worldsTable.status })
        .from(worldsTable)
        .where(inArray(worldsTable.id, [...running.keys()]));
      for (const r of rows.filter((r) => r.status === "stopped")) {
        await stop(r.id, true);
        await leases.release([r.id]);
      }
    }
    const free = config.WORKER_MAX_WORLDS - running.size;
    for (const id of await leases.claim(free, [...running.keys()])) {
      await start(id).catch(async (e: unknown) => {
        log(`⚠ No se pudo abrir el mundo ${id}: ${String(e)}`);
        await leases.release([id]);
      });
    }
    for (const w of running.values()) policy.update(w, viewersOf(w.id));
  } catch (error) {
    log(`⚠ Leases: ${String(error)}`);
  }
}
await leaseLoop();
const leaseTimer = setInterval(() => void leaseLoop(), (config.WORKER_LEASE_SECONDS * 1000) / 4);

// Estado vivo: cada medio segundo si hay espectadores; si no, de vez en cuando.
const lastLive = new Map<string, number>();
const liveTimer = setInterval(() => {
  const now = Date.now();
  for (const w of running.values()) {
    const every = viewersOf(w.id) > 0 ? LIVE_WITH_VIEWERS_MS : LIVE_IDLE_MS;
    if (now - (lastLive.get(w.id) ?? 0) < every) continue;
    lastLive.set(w.id, now);
    publish({ kind: "live", w: w.id, live: liveState(w) });
  }
}, LIVE_WITH_VIEWERS_MS);
const budgetTimer = setInterval(
  () => void refreshBudget(services).catch(() => undefined),
  BUDGET_REFRESH_MS,
);

log(`sim-worker ${owner} listo (máx. ${config.WORKER_MAX_WORLDS} mundos)`);

let closing = false;
const shutdown = async () => {
  if (closing) return;
  closing = true;
  clearInterval(leaseTimer);
  clearInterval(liveTimer);
  clearInterval(budgetTimer);
  const ids = [...running.keys()];
  for (const id of ids) await stop(id, true);
  await leases.release(ids).catch(() => undefined);
  await services.flush();
  await bus.close();
  await db.pool.end();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
