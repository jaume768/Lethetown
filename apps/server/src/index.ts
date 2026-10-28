import { buildApi } from "./api/server";
import { bootstrap } from "./bootstrap";
import { isProduction, loadConfig } from "./config";
import { formatEvent } from "./log";
import { createLogger, initSentry } from "./observability";
import { localContext } from "./worlds/local";
import { ViewerPolicy } from "./worlds/viewers";
import { loadKillSwitch } from "./worker/shared";

const config = loadConfig();
await initSentry(config, "all-in-one");
const logger = createLogger(config, "all-in-one");
const log = (msg: string) => logger.info(msg);

const app = await bootstrap(config, log, { processName: "all-in-one" });
const multi = app.worlds.size > 1;
for (const w of app.worlds.values()) {
  w.sim.onEvent((e) => {
    // En desarrollo, el log de la simulación legible en la consola; en producción, estructurado.
    if (isProduction(config)) logger.debug({ world: w.id, event: e }, "evento");
    else console.log(`${multi ? `[${w.id}] ` : ""}${formatEvent(e)}`);
  });
}

const { server, ws } = await buildApi(localContext(app), app);
if (app.db && (await loadKillSwitch(app.db.db))) app.budget.setKilled(true);
for (const w of app.worlds.values()) {
  if (app.budget.killed) w.pause("kill_switch", "Kill switch activado por un administrador");
  w.start();
  w.clock.start();
}
// Sin espectadores: pausa o menos detalle (NO_VIEWERS_MODE).
const policy = new ViewerPolicy(config);
const viewersTimer = setInterval(() => {
  for (const w of app.worlds.values()) policy.update(w, ws.viewers(w.id));
}, 5000);

await server.listen({ port: config.PORT, host: config.HOST });
log(
  `Servidor en http://${config.HOST}:${config.PORT} · mundos: ${[...app.worlds.values()]
    .map((w) => `${w.id} (x${w.clock.speed})`)
    .join(", ")}`,
);

let closing = false;
const shutdown = async () => {
  if (closing) return;
  closing = true;
  clearInterval(viewersTimer);
  ws.close();
  await server.close();
  await app.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
