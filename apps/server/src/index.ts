import { buildApi } from "./api/server";
import { bootstrap } from "./bootstrap";
import { loadConfig } from "./config";
import { formatEvent } from "./log";
import { localContext } from "./worlds/local";

const config = loadConfig();
const log = (msg: string) => console.log(`\x1b[35m[lethetown]\x1b[0m ${msg}`);

const app = await bootstrap(config, log);
const multi = app.worlds.size > 1;
for (const w of app.worlds.values()) {
  w.sim.onEvent((e) => console.log(`${multi ? `[${w.id}] ` : ""}${formatEvent(e)}`));
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
