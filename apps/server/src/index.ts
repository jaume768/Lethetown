import websocket from "@fastify/websocket";
import Fastify from "fastify";
import { registerRest } from "./api/rest";
import { registerWs } from "./api/ws";
import { bootstrap } from "./bootstrap";
import { loadConfig } from "./config";
import { formatEvent } from "./log";

const config = loadConfig();
const server = Fastify({ logger: { level: "warn" } });
const log = (msg: string) => console.log(`\x1b[35m[lethetown]\x1b[0m ${msg}`);

const app = await bootstrap(config, log);
app.sim.onEvent((e) => console.log(formatEvent(e)));

await server.register(websocket);
const ws = registerWs(server, app);
registerRest(server, app, ws.broadcastTick);

app.sim.start();
app.clock.start();

await server.listen({ port: config.PORT, host: "127.0.0.1" });
log(`Servidor en http://127.0.0.1:${config.PORT} (velocidad x${app.clock.speed})`);

const shutdown = async () => {
  ws.close();
  await server.close();
  await app.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
