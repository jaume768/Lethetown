import { openWorld, type App } from "../bootstrap";
import type { ApiContext, NewWorld } from "../api/rest";
import { saveKillSwitch } from "../worker/shared";
import { LocalWorldGateway, type CommandResult } from "./gateway";

/** Contexto de la API para el modo todo en uno: los mundos corren en este mismo proceso. */
export function localContext(app: App): ApiContext {
  const worlds = new Map([...app.worlds].map(([id, w]) => [id, new LocalWorldGateway(w)]));
  return {
    config: app.config,
    worlds,
    defaultWorldId: app.defaultWorld.id,
    provider: app.provider.name,
    metrics: app.metrics,
    admin: {
      async health() {
        return {
          ok: true,
          mode: "all-in-one",
          provider: app.provider.name,
          models: app.models,
          store: app.storeKind,
          embedder: app.embedder.name,
          llmQueue: {
            active: app.llmQueue.activeCount,
            pending: app.llmQueue.pendingCount,
            waits: app.llmQueue.waitStats(),
          },
          llmBreaker: app.llmResilience.breakerState,
          killSwitch: app.budget.killed,
          worlds: [...app.worlds.values()].map((w) => ({
            id: w.id,
            time: w.clock.now(),
            speed: w.clock.speed,
            status: w.status(),
          })),
          memoryMb: Math.round(process.memoryUsage().rss / 1e6),
          uptimeSeconds: Math.round(process.uptime()),
        };
      },
      budget: async () => app.budget.status(),
      async setKillSwitch(on) {
        app.budget.setKilled(on);
        if (app.db) await saveKillSwitch(app.db.db, on);
        for (const w of app.worlds.values()) {
          if (on) w.pause("kill_switch", "Kill switch activado por un administrador");
        }
      },
      moderation: (worldId) => app.moderationLog.recent(worldId),
      async listWorlds() {
        const rows = await app.worldRepo.list();
        return rows.map((r) => ({ ...r, running: app.worlds.has(r.id), status: r.status }));
      },
      async createWorld(input: NewWorld): Promise<CommandResult> {
        if (await app.worldRepo.get(input.id)) {
          return { ok: false, status: 409, error: "Ya existe un mundo con ese id" };
        }
        try {
          const row = await app.worldRepo.create(input);
          const w = await openWorld(app, row);
          app.worlds.set(w.id, w);
          worlds.set(w.id, new LocalWorldGateway(w));
          w.start();
          w.clock.start();
          return { ok: true, value: { id: w.id } };
        } catch (error) {
          return { ok: false, status: 400, error: String(error) };
        }
      },
      async setWorldStatus(id, status): Promise<CommandResult> {
        const w = app.worlds.get(id);
        if (!w) return { ok: false, status: 404, error: "Mundo no encontrado o parado" };
        if (status === "paused") w.pause("manual", "Pausado por un administrador");
        else if (status === "running") {
          const r = w.resume();
          if (!r.ok) return { ok: false, status: 409, error: r.error };
        } else {
          await w.close();
          app.worlds.delete(id);
          worlds.delete(id);
        }
        await app.worldRepo.setStatus(id, status);
        return { ok: true };
      },
    },
  };
}
