import type { AgentMemoryResponse, ScoredMemoryView, WorldSnapshot } from "@lethetown/shared";
import { SetSpeedRequest } from "@lethetown/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { App } from "../bootstrap";

export function snapshot(app: App): WorldSnapshot {
  return {
    world: app.world.world,
    clock: { time: app.clock.now(), speed: app.clock.speed },
    agents: app.sim.agentStates(),
    provider: app.provider.name,
  };
}

const MemoryQuery = z.object({
  q: z.string().optional(),
  limit: z.coerce.number().int().positive().max(500).default(50),
});

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

  /** Recuerdos del agente puntuados contra `q` (por defecto, su acción actual). Incluye olvidados. */
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
    const memories: ScoredMemoryView[] = scored.slice(0, limit).map(({ memory, scores }) => {
      const { embedding: _e, stability: _s, accessCount: _a, ...view } = memory;
      return { memory: view, scores };
    });
    const body: AgentMemoryResponse = {
      agentId: agent.id,
      now,
      workingMemory: agent.workingMemory.contents.map((i) => i.text),
      memories,
    };
    return body;
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
