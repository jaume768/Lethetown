import { buildApi } from "./api/server";
import { bootstrap } from "./bootstrap";
import { isProduction, loadConfig } from "./config";
import { formatEvent } from "./log";
import { createLogger, initSentry } from "./observability";
import { localContext } from "./worlds/local";

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
for (const w of app.worlds.values()) {
  w.start();
  w.clock.start();
}

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
  ws.close();
  await server.close();
  await app.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
