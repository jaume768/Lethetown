import { timingSafeEqual } from "node:crypto";
import websocket from "@fastify/websocket";
import Fastify, { type FastifyInstance } from "fastify";
import { isProduction } from "../config";
import { hasRole } from "../security/auth";
import { registerHttpSecurity, type AuthDeps } from "../security/http";
import { registerRest, type ApiContext } from "./rest";
import { registerWs } from "./ws";

export interface Api {
  server: FastifyInstance;
  ws: ReturnType<typeof registerWs>;
}

/** Servidor HTTP + WebSocket de la API con todas las capas de seguridad. */
export async function buildApi(ctx: ApiContext, auth: AuthDeps): Promise<Api> {
  const { config } = ctx;
  const server = Fastify({
    logger: { level: isProduction(config) ? config.LOG_LEVEL : "warn" },
    bodyLimit: config.BODY_LIMIT_BYTES,
    trustProxy: config.TRUST_PROXY,
  });
  await registerHttpSecurity(server, config, auth);
  await server.register(websocket, { options: { maxPayload: config.WS_MAX_PAYLOAD_BYTES } });
  const ws = registerWs(server, ctx);
  await registerRest(server, ctx);

  /** Métricas Prometheus: con `Authorization: Bearer METRICS_TOKEN` o sesión de admin. */
  server.get("/metrics", async (req, reply) => {
    if (!bearerOk(req.headers.authorization, config.METRICS_TOKEN) && !hasRole(req.user, "admin")) {
      return reply.code(req.user ? 403 : 401).send({ error: "No autorizado" });
    }
    const m = ctx.metrics;
    m.worldPaused.reset();
    for (const w of ctx.worlds.values()) {
      const live = w.live();
      m.gameTime.set({ world: w.id }, live.time);
      m.worldPaused.set(
        { world: w.id, reason: live.status.reason ?? "none" },
        live.status.state === "paused" ? 1 : 0,
      );
      m.wsClients.set({ world: w.id }, ws.viewers(w.id));
    }
    void reply.type(m.registry.contentType);
    return m.registry.metrics();
  });
  return { server, ws };
}

function bearerOk(header: string | undefined, token: string | undefined): boolean {
  if (!token || !header?.startsWith("Bearer ")) return false;
  const a = Buffer.from(header.slice("Bearer ".length));
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}
