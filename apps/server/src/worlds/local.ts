import type { App } from "../bootstrap";
import type { ApiContext } from "../api/rest";
import { LocalWorldGateway } from "./gateway";

/** Contexto de la API para el modo todo en uno: los mundos corren en este mismo proceso. */
export function localContext(app: App): ApiContext {
  return {
    config: app.config,
    worlds: new Map([...app.worlds].map(([id, w]) => [id, new LocalWorldGateway(w)])),
    defaultWorldId: app.defaultWorld.id,
    provider: app.provider.name,
    admin: {
      async health() {
        return {
          ok: true,
          mode: "all-in-one",
          provider: app.provider.name,
          models: app.models,
          store: app.storeKind,
          embedder: app.embedder.name,
          llmQueue: { active: app.provider.activeCount, pending: app.provider.pendingCount },
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
      budget: () => app.budget.status(),
      async setKillSwitch(on) {
        app.budget.setKilled(on);
        for (const w of app.worlds.values()) {
          if (on) w.pause("kill_switch", "Kill switch activado por un administrador");
        }
      },
      moderation: (worldId) => app.moderationLog.recent(worldId),
    },
  };
}
