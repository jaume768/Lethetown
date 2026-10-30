import { ClientMessage, type ServerMessage } from "@lethetown/shared";
import type { FastifyInstance } from "fastify";
import type { WebSocket } from "ws";
import { hasRole, type User } from "../security/auth";
import { clientIp, originAllowed } from "../security/http";
import type { WorldGateway } from "../worlds/gateway";
import { snapshot, type ApiContext } from "./rest";

const TICK_BROADCAST_MS = 500;

interface Client {
  ws: WebSocket;
  user: User | null;
  ip: string;
  alive: boolean;
}

/** Clientes conectados a un mundo y su difusión periódica. */
class WorldChannel {
  readonly clients = new Set<Client>();
  private lastCalls = -1;
  /** Último estado enviado de cada agente (JSON), para mandar solo lo que cambia. */
  private sent = new Map<string, string>();
  private readonly unsubscribe: () => void;

  constructor(
    readonly world: WorldGateway,
    private readonly provider: string,
  ) {
    // Eventos del log, "pensando", efectos de memoria, crónicas y cambios del mundo.
    this.unsubscribe = world.onSignal((signal) => this.broadcast(signal));
  }

  send(c: Client, msg: ServerMessage) {
    if (c.ws.readyState === c.ws.OPEN) c.ws.send(JSON.stringify(msg));
  }

  /** Difunde a todos; los costes solo a los admin. */
  broadcast(msg: ServerMessage) {
    if (!this.clients.size) return;
    const data = JSON.stringify(msg);
    for (const c of this.clients) {
      if (msg.type === "cost" && !hasRole(c.user, "admin")) continue;
      if (c.ws.readyState === c.ws.OPEN) c.ws.send(data);
    }
  }

  /**
   * Estado completo para un cliente nuevo. Antes se manda un delta a los demás para que todos
   * partan de la misma base que el snapshot.
   */
  sendSnapshot(c: Client) {
    this.clients.delete(c);
    this.tick();
    this.clients.add(c);
    const snap = snapshot(this.world, this.provider);
    this.sent = new Map(snap.agents.map((a) => [a.id, JSON.stringify(a)]));
    this.send(c, { type: "snapshot", snapshot: snap });
    if (hasRole(c.user, "admin")) this.send(c, { type: "cost", summary: this.world.costs() });
  }

  /** Delta: reloj + agentes cuyo estado ha cambiado desde el último envío. */
  tick() {
    if (!this.clients.size) return;
    const live = this.world.live();
    const changed = live.agents.filter((a) => {
      const json = JSON.stringify(a);
      if (this.sent.get(a.id) === json) return false;
      this.sent.set(a.id, json);
      return true;
    });
    const ids = new Set(live.agents.map((a) => a.id));
    const removed = [...this.sent.keys()].filter((id) => !ids.has(id));
    for (const id of removed) this.sent.delete(id);
    this.broadcast({
      type: "delta",
      clock: {
        time: live.time,
        speed: live.speed,
        ...(live.rate !== undefined ? { rate: live.rate } : {}),
      },
      agents: changed,
      removed,
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

/**
 * WebSocket por mundo (`/ws?world=<id>`): comprueba el Origin, limita conexiones por IP,
 * hace ping/pong para cerrar conexiones muertas y solo deja cambiar la velocidad a directores.
 * El tamaño máximo de mensaje (`maxPayload`) se fija al registrar @fastify/websocket.
 */
export function registerWs(server: FastifyInstance, ctx: ApiContext) {
  const { config } = ctx;
  const channels = new Map<string, WorldChannel>();
  /** Canal de un mundo (se crea al primer uso: los mundos nuevos aparecen sin reiniciar). */
  const channelOf = (id: string) => {
    let c = channels.get(id);
    const w = ctx.worlds.get(id);
    if (!c && w) {
      c = new WorldChannel(w, ctx.provider);
      channels.set(id, c);
    }
    return c;
  };
  for (const id of ctx.worlds.keys()) channelOf(id);
  const perIp = new Map<string, number>();

  server.get<{ Querystring: { world?: string } }>(
    "/ws",
    {
      websocket: true,
      preValidation: async (req, reply) => {
        if (!originAllowed(config, req.headers.origin)) {
          return reply.code(403).send({ error: "Origen no permitido" });
        }
        if ((perIp.get(clientIp(req)) ?? 0) >= config.WS_MAX_PER_IP) {
          return reply.code(429).send({ error: "Demasiadas conexiones desde esta IP" });
        }
      },
    },
    (socket, req) => {
      const channel = channelOf(req.query.world ?? ctx.defaultWorldId);
      if (!channel) {
        socket.close(4404, "Mundo no encontrado");
        return;
      }
      const client: Client = { ws: socket, user: req.user, ip: clientIp(req), alive: true };
      perIp.set(client.ip, (perIp.get(client.ip) ?? 0) + 1);
      channel.sendSnapshot(client);

      socket.on("pong", () => (client.alive = true));
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
          if (!hasRole(client.user, "director")) return;
          await channel.world.command({ type: "speed", speed: msg.speed });
          channel.tick();
        } else {
          channel.sendSnapshot(client);
        }
      });
      socket.on("close", () => {
        channel.clients.delete(client);
        const n = (perIp.get(client.ip) ?? 1) - 1;
        if (n <= 0) perIp.delete(client.ip);
        else perIp.set(client.ip, n);
      });
    },
  );

  const timer = setInterval(() => {
    for (const c of channels.values()) c.tick();
  }, TICK_BROADCAST_MS);

  // Heartbeat: quien no contesta al ping anterior se desconecta.
  const heartbeat = setInterval(() => {
    for (const ch of channels.values()) {
      for (const c of ch.clients) {
        if (!c.alive) {
          c.ws.terminate();
          continue;
        }
        c.alive = false;
        c.ws.ping();
      }
    }
  }, config.WS_HEARTBEAT_SECONDS * 1000);

  return {
    clients: () => [...channels.values()].reduce((n, c) => n + c.clients.size, 0),
    viewers: (worldId: string) => channels.get(worldId)?.clients.size ?? 0,
    close: () => {
      clearInterval(timer);
      clearInterval(heartbeat);
      for (const c of channels.values()) c.close();
    },
  };
}
