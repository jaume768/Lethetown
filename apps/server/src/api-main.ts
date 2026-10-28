/**
 * Proceso api: HTTP + WebSocket sin estado de simulación. Los mundos los ejecutan los
 * sim-worker; el api lee de Postgres, recibe el estado vivo por el bus (LISTEN/NOTIFY) y les
 * manda las órdenes. Sin Postgres no hay workers posibles, así que arranca en modo todo en uno.
 */
import { readFile } from "node:fs/promises";
import { buildApi } from "./api/server";
import type { ApiContext } from "./api/rest";
import { createServices, MAP_FILE, safeMapPath } from "./bootstrap";
import { CHANNELS, PgBus } from "./bus/pg-bus";
import { loadConfig } from "./config";
import { checkDb, createDb } from "./db/client";
import { createLogger, initSentry } from "./observability";
import { fromRoot } from "./paths";
import { LeaseManager } from "./worker/leases";
import { saveKillSwitch } from "./worker/shared";
import type { CommandResult } from "./worlds/gateway";
import { RemoteWorldGateway } from "./worlds/remote";

const VIEWERS_EVERY_MS = 5000;
const ADMIN_TIMEOUT_MS = 5000;

const config = loadConfig();

async function postgresReady(): Promise<boolean> {
  if (!config.DATABASE_URL) return false;
  const probe = createDb(config.DATABASE_URL);
  const ok = (await checkDb(probe)).ok;
  await probe.pool.end().catch(() => undefined);
  return ok;
}

if (!(await postgresReady())) {
  console.log("[api] Sin Postgres: arranco en modo todo en uno (los mundos corren aquí).");
  await import("./index");
} else {
  await runApi();
}

async function runApi() {
  await initSentry(config, "api");
  const logger = createLogger(config, "api");
  const log = (msg: string) => logger.info(msg);
  const services = await createServices(config, log, "api");
  const db = services.db!;
  const bus = await PgBus.connect(config.DATABASE_URL!, db.pool, db.db, log);
  const leases = new LeaseManager(db.db, "api", 0);
  await services.worldRepo.ensureDefault(MAP_FILE, config.SIM_SEED ?? null);

  const worlds = new Map<string, RemoteWorldGateway>();
  const openGateway = async (row: Awaited<ReturnType<typeof services.worldRepo.get>>) => {
    if (!row || worlds.has(row.id)) return;
    const tmj = JSON.parse(await readFile(fromRoot(safeMapPath(row.map)), "utf8")) as unknown;
    worlds.set(row.id, await RemoteWorldGateway.open(row, tmj, services, bus));
  };
  for (const row of await services.worldRepo.list()) {
    if (row.status !== "stopped") await openGateway(row);
  }

  const ctx: ApiContext = {
    config,
    worlds,
    defaultWorldId: "default",
    provider: services.provider.name,
    metrics: services.metrics,
    admin: {
      async health() {
        return {
          ok: true,
          mode: "split",
          provider: services.provider.name,
          store: services.storeKind,
          embedder: services.embedder.name,
          leases: await leases.list(),
          worlds: [...worlds.values()].map((w) => ({
            id: w.id,
            time: w.live().time,
            speed: w.live().speed,
            status: w.live().status,
          })),
          memoryMb: Math.round(process.memoryUsage().rss / 1e6),
          uptimeSeconds: Math.round(process.uptime()),
        };
      },
      budget: () =>
        bus
          .request(CHANNELS.admin, { kind: "budget" }, ADMIN_TIMEOUT_MS)
          .catch(() => ({ error: "Ningún sim-worker respondió" })),
      async setKillSwitch(on) {
        await saveKillSwitch(db.db, on);
        await bus.publish(CHANNELS.admin, { kind: "kill", on });
      },
      moderation: (worldId) => services.moderationLog.recent(worldId),
      async listWorlds() {
        const owners = new Map((await leases.list()).map((l) => [l.worldId, l]));
        return (await services.worldRepo.list()).map((r) => ({ ...r, lease: owners.get(r.id) }));
      },
      async createWorld(input): Promise<CommandResult> {
        if (await services.worldRepo.get(input.id)) {
          return { ok: false, status: 409, error: "Ya existe un mundo con ese id" };
        }
        const row = await services.worldRepo.create(input);
        await openGateway(row);
        // Un worker con hueco lo reclamará en su próxima vuelta de leases.
        return { ok: true, value: { id: row.id } };
      },
      async setWorldStatus(id, status): Promise<CommandResult> {
        const w = worlds.get(id);
        if (!w) return { ok: false, status: 404, error: "Mundo no encontrado" };
        await services.worldRepo.setStatus(id, status);
        if (status === "stopped") {
          // El worker lo suelta al no poder renovar… salvo que se lo digamos: se pausa y la
          // lease caduca sin renovarse porque el mundo ya no se reclama.
          await w.command({ type: "pause" });
          worlds.delete(id);
          return { ok: true };
        }
        return w.command({ type: status === "paused" ? "pause" : "resume" });
      },
    },
  };

  const { server, ws } = await buildApi(ctx, services);
  // Espectadores por mundo → workers (para pausar o bajar el detalle sin público).
  const viewersTimer = setInterval(() => {
    const counts = Object.fromEntries([...worlds.keys()].map((id) => [id, ws.viewers(id)]));
    void bus.publish(CHANNELS.viewers, { from: "api", counts }).catch(() => undefined);
  }, VIEWERS_EVERY_MS);

  await server.listen({ port: config.PORT, host: config.HOST });
  log(`api en http://${config.HOST}:${config.PORT} · mundos: ${[...worlds.keys()].join(", ")}`);

  let closing = false;
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    clearInterval(viewersTimer);
    ws.close();
    await server.close();
    await bus.close();
    await db.pool.end();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
