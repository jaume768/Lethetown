import { ClientMessage, type ServerMessage } from "@lethetown/shared";
import type { FastifyInstance } from "fastify";
import type { WebSocket } from "ws";
import type { WorldGateway } from "../worlds/gateway";
import { snapshot, type ApiContext } from "./rest";

const TICK_BROADCAST_MS = 500;

/** Clientes conectados a un mundo y su difusión periódica. */
class WorldChannel {
  readonly clients = new Set<WebSocket>();
  private lastCalls = -1;
  private readonly unsubscribe: () => void;

  constructor(
    readonly world: WorldGateway,
    private readonly provider: string,
  ) {
    // Eventos del log, "pensando", efectos de memoria, crónicas y cambios del mundo.
    this.unsubscribe = world.onSignal((signal) => this.broadcast(signal));
  }

  send(ws: WebSocket, msg: ServerMessage) {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  }

  broadcast(msg: ServerMessage) {
    if (!this.clients.size) return;
    const data = JSON.stringify(msg);
    for (const ws of this.clients) if (ws.readyState === ws.OPEN) ws.send(data);
  }

  sendSnapshot(ws: WebSocket) {
    this.send(ws, { type: "snapshot", snapshot: snapshot(this.world, this.provider) });
    this.send(ws, { type: "cost", summary: this.world.costs() });
  }

  tick() {
    if (!this.clients.size) return;
    const live = this.world.live();
    this.broadcast({
      type: "tick",
      clock: { time: live.time, speed: live.speed },
      agents: live.agents,
    });
    const summary = this.world.costs();
    if (summary.total.calls !== this.lastCalls) {
      this.lastCalls = summary.total.calls;
      this.broadcast({ type: "cost", summary });
    }
  }

  close() {
    this.unsubscribe();
  }
}

export function registerWs(server: FastifyInstance, ctx: ApiContext) {
  const channels = new Map<string, WorldChannel>();
  for (const w of ctx.worlds.values()) channels.set(w.id, new WorldChannel(w, ctx.provider));

  server.get<{ Querystring: { world?: string } }>("/ws", { websocket: true }, (socket, req) => {
    const channel = channels.get(req.query.world ?? ctx.defaultWorldId);
    if (!channel) {
      socket.close(4404, "Mundo no encontrado");
      return;
    }
    channel.clients.add(socket);
    channel.sendSnapshot(socket);

    socket.on("message", async (raw) => {
      let parsed: ReturnType<typeof ClientMessage.safeParse>;
      try {
        parsed = ClientMessage.safeParse(JSON.parse(String(raw)));
      } catch {
        return;
      }
      if (!parsed.success) return;
      const msg = parsed.data;
      if (msg.type === "setSpeed") {
        await channel.world.command({ type: "speed", speed: msg.speed });
        channel.tick();
      } else {
        channel.sendSnapshot(socket);
      }
    });
    socket.on("close", () => channel.clients.delete(socket));
  });

  const timer = setInterval(() => {
    for (const c of channels.values()) c.tick();
  }, TICK_BROADCAST_MS);

  return {
    clients: () => [...channels.values()].reduce((n, c) => n + c.clients.size, 0),
    viewers: (worldId: string) => channels.get(worldId)?.clients.size ?? 0,
    close: () => {
      clearInterval(timer);
      for (const c of channels.values()) c.close();
    },
  };
}
