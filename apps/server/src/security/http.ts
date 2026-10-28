import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { cookieSecure, isProduction, type AppConfig } from "../config";
import {
  Password,
  Username,
  hasRole,
  type Role,
  type SessionStore,
  type User,
  type UserStore,
} from "./auth";

export const SESSION_COOKIE = "lt_session";

declare module "fastify" {
  interface FastifyRequest {
    /** Usuario de la sesión (null = espectador anónimo). */
    user: User | null;
  }
}

export interface AuthDeps {
  users: UserStore;
  sessions: SessionStore;
}

/** preHandler que exige un rol mínimo (401 sin sesión, 403 con rol insuficiente). */
export function requireRole(role: Role) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    if (hasRole(req.user, role)) return;
    return reply
      .code(req.user ? 403 : 401)
      .send({ error: req.user ? `Necesitas el rol ${role}` : "Inicia sesión" });
  };
}

/** IP del cliente (con TRUST_PROXY, la de X-Forwarded-For). */
export function clientIp(req: FastifyRequest): string {
  return req.ip || "unknown";
}

/** ¿El Origin de la petición (si lo trae) está permitido? Sin Origin (curl, mismo origen GET) = sí. */
export function originAllowed(config: AppConfig, origin: string | undefined): boolean {
  return !origin || config.ALLOWED_ORIGINS.includes(origin);
}

const LoginBody = z.object({ username: Username, password: z.string().min(1).max(200) });

/**
 * Cabeceras de seguridad, CORS, límites, sesión por cookie y rutas de autenticación.
 * Se registra antes que las demás rutas.
 */
export async function registerHttpSecurity(
  server: FastifyInstance,
  config: AppConfig,
  auth: AuthDeps,
): Promise<void> {
  await server.register(helmet, {
    // La API solo sirve JSON; la CSP de la web la pone quien sirva los estáticos (Caddy/Vite).
    contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
    crossOriginResourcePolicy: { policy: "same-site" },
  });
  await server.register(cors, {
    origin: config.ALLOWED_ORIGINS,
    credentials: true,
    methods: ["GET", "POST"],
  });
  await server.register(rateLimit, {
    global: true,
    max: config.RATE_LIMIT_PER_MINUTE,
    timeWindow: "1 minute",
    // Sin IP (p. ej. inyección en tests) no se rompe: cuenta como un único cliente.
    keyGenerator: (req) => clientIp(req),
  });
  await server.register(cookie);

  server.decorateRequest("user", null);
  server.addHook("onRequest", async (req) => {
    const token = req.cookies[SESSION_COOKIE];
    if (!token) return;
    const userId = await auth.sessions.resolve(token).catch(() => null);
    req.user = userId ? await auth.users.get(userId).catch(() => null) : null;
  });

  // CSRF: además de SameSite=Lax, toda petición que muta debe venir de un origen permitido.
  server.addHook("onRequest", async (req, reply) => {
    if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return;
    if (!originAllowed(config, req.headers.origin)) {
      return reply.code(403).send({ error: "Origen no permitido" });
    }
  });

  // Errores: en producción, sin detalles internos.
  server.setErrorHandler((error, req, reply) => {
    const status =
      (error as { statusCode?: number }).statusCode ?? (error instanceof z.ZodError ? 400 : 500);
    if (status >= 500) req.log.error(error);
    const message =
      status >= 500 && isProduction(config)
        ? "Error interno"
        : error instanceof z.ZodError
          ? z.prettifyError(error)
          : error instanceof Error
            ? error.message
            : String(error);
    void reply.code(status).send({ error: message });
  });

  const loginLimit = { rateLimit: { max: 10, timeWindow: "1 minute" } };

  server.post("/api/auth/login", { config: loginLimit }, async (req, reply) => {
    const parsed = LoginBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "usuario y contraseña requeridos" });
    const user = await auth.users.authenticate(parsed.data.username, parsed.data.password);
    if (!user) return reply.code(401).send({ error: "Usuario o contraseña incorrectos" });
    const ttlMs = config.SESSION_TTL_HOURS * 3_600_000;
    const token = await auth.sessions.create(user.id, ttlMs);
    void reply.setCookie(SESSION_COOKIE, token, {
      path: "/",
      httpOnly: true,
      secure: cookieSecure(config),
      sameSite: "lax",
      maxAge: Math.floor(ttlMs / 1000),
    });
    return { user };
  });

  server.post("/api/auth/logout", async (req, reply) => {
    const token = req.cookies[SESSION_COOKIE];
    if (token) await auth.sessions.destroy(token);
    void reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return { ok: true };
  });

  server.get("/api/auth/me", async (req) => ({ user: req.user }));
}

/** Validación de alta de usuarios (CLI y, en el futuro, panel de admin). */
export const NewUser = z.object({ username: Username, password: Password });
