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
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { App } from "../bootstrap";

export function snapshot(app: App): WorldSnapshot {
  return {
    world: app.world.world,
    clock: { time: app.clock.now(), speed: app.clock.speed },
    agents: app.sim.agentStates(),
    provider: app.provider.name,
    weather: app.world.weather,
  };
}

const MemoryQuery = z.object({
  q: z.string().optional(),
  limit: z.coerce.number().int().positive().max(500).default(50),
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

export function registerRest(server: FastifyInstance, app: App, onSpeedChange: () => void): void {
  server.get("/api/health", async () => ({
    ok: true,
    provider: app.provider.name,
    store: app.storeKind,
    embedder: app.memory.embedder.name,
  }));

  server.get("/api/state", async () => snapshot(app));

  /** Mapa Tiled (.tmj) que pinta el cliente; el mismo del que sale el `World`. */
  server.get("/api/map", async () => app.tmj);

  /** Jardín de recuerdos: puntuados contra `q` (por defecto, su acción actual), auditoría y fichas. */
  server.get<{ Params: { id: string } }>("/api/agents/:id/memory", async (req, reply) => {
    const agent = app.sim.agents.get(req.params.id);
    if (!agent) return reply.code(404).send({ error: "Agente no encontrado" });
    const { q, limit } = MemoryQuery.parse(req.query);
    const now = app.clock.now();
    const scored = await app.memory.inspect({
      agentId: agent.id,
      query: q ?? agent.state.action,
      now,
      moodValence: agent.state.mood.valence,
    });
    const memories: ScoredMemoryView[] = scored
      .slice(0, limit)
      .map(({ memory, scores }) => ({ memory: toView(memory), scores }));
    const body: AgentMemoryResponse = {
      agentId: agent.id,
      now,
      workingMemory: agent.workingMemory.contents.map((i) => i.text),
      memories,
      audit: await app.memory.store.audit(agent.id, 50),
      social: await app.social.list(agent.id),
    };
    return body;
  });

  /** Vista Rashomon: cómo recuerda cada agente un evento (o conversación) y cómo ha cambiado. */
  server.get<{ Params: { id: string } }>("/api/rashomon/:id", async (req) => {
    const id = req.params.id;
    // Las frases de una conversación tienen id "<conversación>:<turno>".
    const eventId = id.includes(":") ? id.slice(0, id.indexOf(":")) : id;
    const now = app.clock.now();
    const records = await app.memory.store.byEvent(eventId);
    const byAgent = new Map<string, MemoryRecord[]>();
    for (const r of records) byAgent.set(r.agentId, [...(byAgent.get(r.agentId) ?? []), r]);
    const accounts: RashomonAccount[] = [];
    for (const [agentId, mems] of byAgent) {
      accounts.push({
        agentId,
        name: app.sim.agents.get(agentId)?.seed.name ?? agentId,
        memories: await Promise.all(
          mems
            .sort((a, b) => a.createdAt - b.createdAt)
            .map(async (m) => {
              const strength = currentStrength(m, now);
              return {
                memory: toView(m),
                strength,
                clarity: clarityFor(strength, app.memory.config.retrieval),
                versions: await app.memory.store.versions(m.id),
              };
            }),
        ),
      });
    }
    const body: RashomonResponse = {
      event: (await app.events.get(id)) ?? null,
      now,
      accounts: accounts.sort((a, b) => a.name.localeCompare(b.name)),
    };
    return body;
  });

  /** Línea de tiempo: eventos por día o por rango [from, to) de minutos de juego. */
  server.get("/api/events", async (req) => {
    const q = EventsQuery.parse(req.query);
    const from = q.day !== undefined ? q.day * 1440 : (q.from ?? 0);
    const to = q.day !== undefined ? (q.day + 1) * 1440 : (q.to ?? app.clock.now() + 1);
    return app.events.range(from, to, q.limit);
  });

  server.get("/api/chronicles", async () => app.chronicles.list());

  /** Genera ya la crónica de un día (normalmente se escribe sola a las 23:00). */
  server.post<{ Params: { day: string } }>("/api/chronicles/:day", async (req, reply) => {
    const day = Number(req.params.day);
    if (!Number.isInteger(day) || day < 0) return reply.code(400).send({ error: "día inválido" });
    return (
      (await app.sim.writeChronicle(day)) ?? reply.code(500).send({ error: "no se pudo generar" })
    );
  });

  // --- Intervención del jugador ---------------------------------------------------------------

  server.post<{ Params: { id: string } }>("/api/agents/:id/thought", async (req, reply) => {
    const parsed = ThoughtRequest.safeParse(req.body);
    if (!parsed.success)
      return reply.code(400).send({ error: "text requerido (1-500 caracteres)" });
    if (!app.sim.agents.has(req.params.id))
      return reply.code(404).send({ error: "Agente no encontrado" });
    app.sim.injectThought(req.params.id, parsed.data.text);
    return { ok: true };
  });

  server.post<{ Params: { id: string } }>("/api/world/spots/:id", async (req, reply) => {
    const parsed = SpotStateRequest.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "state requerido" });
    if (!app.world.spot(req.params.id))
      return reply.code(404).send({ error: "Objeto no encontrado" });
    app.sim.setSpotState(req.params.id, parsed.data.state);
    return { ok: true };
  });

  server.post("/api/world/weather", async (req, reply) => {
    const parsed = WeatherRequest.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "weather: sunny | cloudy | rain" });
    app.sim.setWeather(parsed.data.weather);
    return { ok: true };
  });

  server.get("/api/costs", async () => ({
    ...app.costs.summary(),
    unpricedModels: [...app.costs.unpricedModels],
  }));

  server.post("/api/speed", async (req, reply) => {
    const parsed = SetSpeedRequest.safeParse(req.body);
    if (!parsed.success)
      return reply.code(400).send({ error: "speed debe ser 0, 1, 10, 60 o 360" });
    app.clock.setSpeed(parsed.data.speed);
    onSpeedChange();
    return { time: app.clock.now(), speed: app.clock.speed };
  });
}
