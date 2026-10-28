import { ClientMessage, type ServerMessage } from "@lethetown/shared";
import type { FastifyInstance } from "fastify";
import type { WebSocket } from "ws";
import type { App } from "../bootstrap";
import { snapshot } from "./rest";

const TICK_BROADCAST_MS = 500;

export function registerWs(server: FastifyInstance, app: App) {
  const clients = new Set<WebSocket>();

  const send = (ws: WebSocket, msg: ServerMessage) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  };
  const broadcast = (msg: ServerMessage) => {
    for (const ws of clients) send(ws, msg);
  };
  const broadcastTick = () =>
    broadcast({
      type: "tick",
      clock: { time: app.clock.now(), speed: app.clock.speed },
      agents: app.sim.agentStates(),
    });

  server.get("/ws", { websocket: true }, (socket) => {
    clients.add(socket);
    send(socket, { type: "snapshot", snapshot: snapshot(app) });
    send(socket, { type: "cost", summary: app.costs.summary() });

    socket.on("message", (raw) => {
      let parsed: ReturnType<typeof ClientMessage.safeParse>;
      try {
        parsed = ClientMessage.safeParse(JSON.parse(String(raw)));
      } catch {
        return;
      }
      if (!parsed.success) return;
      const msg = parsed.data;
      if (msg.type === "setSpeed") {
        app.clock.setSpeed(msg.speed);
        broadcastTick();
      } else {
        send(socket, { type: "snapshot", snapshot: snapshot(app) });
      }
    });
    socket.on("close", () => clients.delete(socket));
  });

  // Eventos del log, "pensando", efectos de memoria, crónicas y cambios del mundo.
  app.sim.onSignal((signal) => broadcast(signal));

  let lastCalls = -1;
  const timer = setInterval(() => {
    if (!clients.size) return;
    broadcastTick();
    const summary = app.costs.summary();
    if (summary.total.calls !== lastCalls) {
      lastCalls = summary.total.calls;
      broadcast({ type: "cost", summary });
    }
  }, TICK_BROADCAST_MS);

  return {
    broadcastTick,
    close: () => clearInterval(timer),
  };
}
