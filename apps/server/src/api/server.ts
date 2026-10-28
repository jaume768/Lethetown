import websocket from "@fastify/websocket";
import Fastify, { type FastifyInstance } from "fastify";
import { isProduction } from "../config";
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
    logger: { level: isProduction(config) ? "info" : "warn" },
    bodyLimit: config.BODY_LIMIT_BYTES,
    trustProxy: config.TRUST_PROXY,
  });
  await registerHttpSecurity(server, config, auth);
  await server.register(websocket, { options: { maxPayload: config.WS_MAX_PAYLOAD_BYTES } });
  const ws = registerWs(server, ctx);
  await registerRest(server, ctx);
  return { server, ws };
}
