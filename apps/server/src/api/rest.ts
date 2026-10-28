import { clarityFor, currentStrength, type MemoryRecord } from "@lethetown/agent-core";
import type {
  AgentMemoryResponse,
  MemoryView,
  RashomonAccount,
  RashomonResponse,
  ScoredMemoryView,
  WorldSnapshot,
} from "@lethetown/shared";
import {
  SetSpeedRequest,
  SpotStateRequest,
  ThoughtRequest,
  WeatherRequest,
} from "@lethetown/shared";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { AppConfig } from "../config";
import type { Metrics } from "../observability";
import { requireRole } from "../security/http";
import type { CommandResult, WorldCommand, WorldGateway } from "../worlds/gateway";

/** Operaciones de administración (en modo separado las ejecuta el worker vía bus). */
export interface AdminOps {
  /** Health detallado: proceso, BD, proveedor, mundos. */
  health(): Promise<Record<string, unknown>>;
  budget(): unknown;
  setKillSwitch(on: boolean): Promise<void>;
  moderation(worldId: string): Promise<unknown>;
}

/** Lo que la API REST necesita del proceso: los mundos que puede servir y datos generales. */
export interface ApiContext {
  config: AppConfig;
  worlds: Map<string, WorldGateway>;
  defaultWorldId: string;
  provider: string;
  admin: AdminOps;
  metrics: Metrics;
}

export function snapshot(w: WorldGateway, provider: string): WorldSnapshot {
  const live = w.live();
  return {
    world: w.world,
    clock: { time: live.time, speed: live.speed },
    agents: live.agents,
    provider,
    weather: live.weather,
    status: live.status,
  };
}

const MemoryQuery = z.object({
  q: z.string().max(500).optional(),
  limit: z.coerce.number().int().positive().max(200).default(50),
  offset: z.coerce.number().int().nonnegative().default(0),
});

const EventsQuery = z.object({
  day: z.coerce.number().int().nonnegative().optional(),
  from: z.coerce.number().nonnegative().optional(),
  to: z.coerce.number().nonnegative().optional(),
  limit: z.coerce.number().int().positive().max(5000).default(1000),
});

export function toView(m: MemoryRecord): MemoryView {
  const { embedding: _e, stability: _s, accessCount: _a, ...view } = m;
  return view;
}

type WorldParams = { worldId?: string };

/** Mundo de la ruta (`/api/worlds/:worldId/...`) o el mundo por defecto (alias `/api/...`). */
export function worldOf(
  ctx: ApiContext,
  req: FastifyRequest,
  reply: FastifyReply,
): WorldGateway | null {
  const id = (req.params as WorldParams).worldId ?? ctx.defaultWorldId;
  const w = ctx.worlds.get(id);
  if (!w) {
    void reply.code(404).send({ error: "Mundo no encontrado" });
    return null;
  }
  return w;
}

async function sendResult(reply: FastifyReply, r: CommandResult) {
  if (!r.ok) return reply.code(r.status).send({ error: r.error });
  return r.value ?? { ok: true };
}

const director = { preHandler: requireRole("director") };
const admin = { preHandler: requireRole("admin") };

/** Rutas generales (fuera de cualquier mundo). */
export function registerGlobalRest(server: FastifyInstance, ctx: ApiContext): void {
  /** Health público mínimo (para el balanceador); el detallado es de admin. */
  server.get("/api/health", async () => ({ ok: true }));

  server.get("/api/admin/health", admin, async () => ctx.admin.health());
  server.get("/api/admin/budget", admin, async () => ctx.admin.budget());
  server.post("/api/admin/kill", admin, async (req, reply) => {
    const parsed = z.object({ on: z.boolean() }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "on: true | false" });
    await ctx.admin.setKillSwitch(parsed.data.on);
    return { ok: true, killed: parsed.data.on };
  });
  server.get<{ Params: { worldId: string } }>(
    "/api/admin/worlds/:worldId/moderation",
    admin,
    async (req) => ctx.admin.moderation(req.params.worldId),
  );

  server.get("/api/worlds", async () =>
    [...ctx.worlds.values()].map((w) => ({
      id: w.id,
      name: w.name,
      default: w.id === ctx.defaultWorldId,
    })),
  );
}

/**
 * Rutas de un mundo. Se registran dos veces: bajo `/api/worlds/:worldId` y, como alias
 * temporal del mundo por defecto, bajo `/api` (las rutas que ya usaba el cliente).
 */
export function registerWorldRest(server: FastifyInstance, ctx: ApiContext): void {
  const { config } = ctx;
  /** Intervención (voz interior, objetos): gasta LLM en moderación y en la reacción. */
  const intervention = {
    ...director,
    config: {
      rateLimit: { max: config.RATE_LIMIT_INTERVENTION_PER_MINUTE, timeWindow: "1 minute" },
    },
  };
  const command = async (req: FastifyRequest, reply: FastifyReply, cmd: WorldCommand) => {
    const w = worldOf(ctx, req, reply);
    if (!w) return reply;
    return sendResult(reply, await w.command(cmd));
  };

  server.get("/state", async (req, reply) => {
    const w = worldOf(ctx, req, reply);
    return w ? snapshot(w, ctx.provider) : reply;
  });

  /** Mapa Tiled (.tmj) que pinta el cliente; el mismo del que sale el `World`. */
  server.get("/map", async (req, reply) => {
    const w = worldOf(ctx, req, reply);
    return w ? w.tmj : reply;
  });

  /** Jardín de recuerdos: puntuados contra `q` (por defecto, su acción actual), auditoría y fichas. */
  server.get<{ Params: { id: string } }>("/agents/:id/memory", async (req, reply) => {
    const w = worldOf(ctx, req, reply);
    if (!w) return reply;
    const live = w.live();
    const agent = live.agents.find((a) => a.id === req.params.id);
    if (!agent) return reply.code(404).send({ error: "Agente no encontrado" });
    const { q, limit, offset } = MemoryQuery.parse(req.query);
    const scored = await w.memory.inspect({
      agentId: agent.id,
      query: q ?? agent.action,
      now: live.time,
      moodValence: agent.mood.valence,
    });
    const memories: ScoredMemoryView[] = scored
      .slice(offset, offset + limit)
      .map(({ memory, scores }) => ({ memory: toView(memory), scores }));
    const body: AgentMemoryResponse = {
      agentId: agent.id,
      now: live.time,
      workingMemory: live.workingMemory[agent.id] ?? [],
      memories,
      total: scored.length,
      offset,
      audit: await w.memory.store.audit(agent.id, 50),
      social: await w.social.list(agent.id),
    };
    return body;
  });

  /** Vista Rashomon: cómo recuerda cada agente un evento (o conversación) y cómo ha cambiado. */
  server.get<{ Params: { id: string } }>("/rashomon/:id", async (req, reply) => {
    const w = worldOf(ctx, req, reply);
    if (!w) return reply;
    const id = req.params.id;
    // Las frases de una conversación tienen id "<conversación>:<turno>".
    const eventId = id.includes(":") ? id.slice(0, id.indexOf(":")) : id;
    const live = w.live();
    const names = new Map(live.agents.map((a) => [a.id, a.name]));
    const records = await w.memory.store.byEvent(eventId);
    const byAgent = new Map<string, MemoryRecord[]>();
    for (const r of records) byAgent.set(r.agentId, [...(byAgent.get(r.agentId) ?? []), r]);
    const accounts: RashomonAccount[] = [];
    for (const [agentId, mems] of byAgent) {
      accounts.push({
        agentId,
        name: names.get(agentId) ?? agentId,
        memories: await Promise.all(
          mems
            .sort((a, b) => a.createdAt - b.createdAt)
            .map(async (m) => {
              const strength = currentStrength(m, live.time);
              return {
                memory: toView(m),
                strength,
                clarity: clarityFor(strength, w.memory.config.retrieval),
                versions: await w.memory.store.versions(m.id),
              };
            }),
        ),
      });
    }
    const body: RashomonResponse = {
      event: (await w.events.get(id)) ?? null,
      now: live.time,
      accounts: accounts.sort((a, b) => a.name.localeCompare(b.name)),
    };
    return body;
  });

  /** Línea de tiempo: eventos por día o por rango [from, to) de minutos de juego. */
  server.get("/events", async (req, reply) => {
    const w = worldOf(ctx, req, reply);
    if (!w) return reply;
    const q = EventsQuery.parse(req.query);
    const from = q.day !== undefined ? q.day * 1440 : (q.from ?? 0);
    const to = q.day !== undefined ? (q.day + 1) * 1440 : (q.to ?? w.live().time + 1);
    return w.events.range(from, to, q.limit);
  });

  server.get("/chronicles", async (req, reply) => {
    const w = worldOf(ctx, req, reply);
    return w ? w.chronicles.list() : reply;
  });

  /** Genera ya la crónica de un día (normalmente se escribe sola a las 23:00). */
  const chronicleLimit = {
    ...director,
    config: { rateLimit: { max: config.RATE_LIMIT_CHRONICLE_PER_MINUTE, timeWindow: "1 minute" } },
  };
  server.post<{ Params: { day: string } }>(
    "/chronicles/:day",
    chronicleLimit,
    async (req, reply) => {
      const day = Number(req.params.day);
      if (!Number.isInteger(day) || day < 0) return reply.code(400).send({ error: "día inválido" });
      return command(req, reply, { type: "chronicle", day });
    },
  );

  // --- Intervención del jugador ---------------------------------------------------------------

  server.post<{ Params: { id: string } }>(
    "/agents/:id/thought",
    intervention,
    async (req, reply) => {
      const parsed = ThoughtRequest.safeParse(req.body);
      if (!parsed.success)
        return reply.code(400).send({ error: "text requerido (1-500 caracteres)" });
      return command(req, reply, {
        type: "thought",
        agentId: req.params.id,
        text: parsed.data.text,
        userId: req.user?.id ?? null,
      });
    },
  );

  server.post<{ Params: { id: string } }>("/world/spots/:id", intervention, async (req, reply) => {
    const parsed = SpotStateRequest.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "state requerido" });
    return command(req, reply, {
      type: "spot",
      spotId: req.params.id,
      state: parsed.data.state,
      userId: req.user?.id ?? null,
    });
  });

  server.post("/world/weather", director, async (req, reply) => {
    const parsed = WeatherRequest.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "weather: sunny | cloudy | rain" });
    return command(req, reply, { type: "weather", weather: parsed.data.weather });
  });

  server.get("/costs", admin, async (req, reply) => {
    const w = worldOf(ctx, req, reply);
    return w ? w.costs() : reply;
  });

  server.post("/pause", director, async (req, reply) => command(req, reply, { type: "pause" }));
  server.post("/resume", director, async (req, reply) => command(req, reply, { type: "resume" }));

  server.post("/speed", director, async (req, reply) => {
    const parsed = SetSpeedRequest.safeParse(req.body);
    if (!parsed.success)
      return reply.code(400).send({ error: "speed debe ser 0, 1, 10, 60 o 360" });
    return command(req, reply, { type: "speed", speed: parsed.data.speed });
  });
}

/** Registra todas las rutas REST: generales, por mundo y alias del mundo por defecto. */
export async function registerRest(server: FastifyInstance, ctx: ApiContext): Promise<void> {
  registerGlobalRest(server, ctx);
  await server.register(async (s) => registerWorldRest(s, ctx), { prefix: "/api/worlds/:worldId" });
  await server.register(async (s) => registerWorldRest(s, ctx), { prefix: "/api" });
}
