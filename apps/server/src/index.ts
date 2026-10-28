import websocket from "@fastify/websocket";
import Fastify from "fastify";
import { registerRest, type ApiContext } from "./api/rest";
import { registerWs } from "./api/ws";
import { bootstrap } from "./bootstrap";
import { loadConfig } from "./config";
import { formatEvent } from "./log";
import { LocalWorldGateway } from "./worlds/gateway";

const config = loadConfig();
const server = Fastify({ logger: { level: "warn" } });
const log = (msg: string) => console.log(`\x1b[35m[lethetown]\x1b[0m ${msg}`);

const app = await bootstrap(config, log);
const multi = app.worlds.size > 1;
for (const w of app.worlds.values()) {
  w.sim.onEvent((e) => console.log(`${multi ? `[${w.id}] ` : ""}${formatEvent(e)}`));
}

const ctx: ApiContext = {
  worlds: new Map([...app.worlds].map(([id, w]) => [id, new LocalWorldGateway(w)])),
  defaultWorldId: app.defaultWorld.id,
  provider: app.provider.name,
  storeKind: app.storeKind,
  embedder: app.embedder.name,
};
await server.register(websocket);
const ws = registerWs(server, ctx);
await registerRest(server, ctx);

for (const w of app.worlds.values()) {
  w.start();
  w.clock.start();
}

await server.listen({ port: config.PORT, host: "127.0.0.1" });
log(
  `Servidor en http://127.0.0.1:${config.PORT} · mundos: ${[...app.worlds.values()]
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
