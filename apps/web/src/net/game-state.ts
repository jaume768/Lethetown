/**
 * Estado de la partida en el cliente y cómo lo cambia cada mensaje del servidor. Puro (sin red,
 * React ni `location`), para poder probarlo; `store.ts` lo conecta al WebSocket.
 */
import {
  RUNNING,
  type AgentState,
  type Chronicle,
  type ClockState,
  type CostSummary,
  type Drama,
  type ServerMessage,
  type SimEvent,
  type Weather,
  type World,
  type WorldRunStatus,
} from "@lethetown/shared";

export interface GameState {
  connected: boolean;
  /** Ya se recibió el primer snapshot (para la pantalla de carga). */
  loaded: boolean;
  /** Intentos de reconexión seguidos (0 = conectado o primer intento). */
  retries: number;
  status: WorldRunStatus;
  dramas: Drama[];
  world: World | null;
  provider: string;
  clock: ClockState;
  agents: AgentState[];
  events: SimEvent[];
  costs: CostSummary | null;
  weather: Weather;
  /** Llamadas al LLM en curso por agente (y tarea de la última). */
  thinking: Record<string, { count: number; task: string }>;
  chronicles: Chronicle[];
}

export const MAX_EVENTS = 400;
export const MAX_DRAMAS = 100;

export const INITIAL_STATE: GameState = {
  connected: false,
  loaded: false,
  retries: 0,
  status: RUNNING,
  dramas: [],
  world: null,
  provider: "",
  clock: { time: 0, speed: 0 },
  agents: [],
  events: [],
  costs: null,
  weather: "sunny",
  thinking: {},
  chronicles: [],
};

/** El estado tras un mensaje (el mismo objeto si el mensaje no cambia nada). */
export function applyMessage(state: GameState, msg: ServerMessage): GameState {
  switch (msg.type) {
    case "snapshot":
      return {
        ...state,
        world: msg.snapshot.world,
        provider: msg.snapshot.provider,
        clock: msg.snapshot.clock,
        agents: msg.snapshot.agents,
        weather: msg.snapshot.weather,
        status: msg.snapshot.status,
        loaded: true,
      };
    case "tick":
      return { ...state, clock: msg.clock, agents: msg.agents };
    case "delta": {
      // Mezcla los agentes que cambiaron con los que ya teníamos.
      const changed = new Map(msg.agents.map((a) => [a.id, a]));
      const removed = new Set(msg.removed);
      const agents = state.agents
        .filter((a) => !removed.has(a.id))
        .map((a) => changed.get(a.id) ?? a);
      for (const a of msg.agents) if (!state.agents.some((x) => x.id === a.id)) agents.push(a);
      return {
        ...state,
        clock: msg.clock,
        ...(msg.agents.length || removed.size ? { agents } : {}),
      };
    }
    case "event":
      return { ...state, events: [...state.events, msg.event].slice(-MAX_EVENTS) };
    case "cost":
      return { ...state, costs: msg.summary };
    case "thinking": {
      const prev = state.thinking[msg.agentId]?.count ?? 0;
      const count = Math.max(0, prev + (msg.phase === "start" ? 1 : -1));
      return {
        ...state,
        thinking: { ...state.thinking, [msg.agentId]: { count, task: msg.task } },
      };
    }
    case "memory_effect":
      return state;
    case "status":
      return { ...state, status: msg.status };
    case "drama":
      return {
        ...state,
        dramas: [msg.drama, ...state.dramas.filter((d) => d.id !== msg.drama.id)].slice(
          0,
          MAX_DRAMAS,
        ),
      };
    case "chronicle":
      return {
        ...state,
        chronicles: [...state.chronicles.filter((c) => c.day !== msg.chronicle.day), msg.chronicle],
      };
    case "world": {
      const states = new Map(msg.spots.map((s) => [s.id, s.state]));
      const world = state.world && {
        ...state.world,
        places: state.world.places.map((p) => ({
          ...p,
          objects: p.objects.map((o) => ({ ...o, state: states.get(o.id) ?? o.state })),
        })),
      };
      return { ...state, weather: msg.weather, world };
    }
  }
}

/** Rutas de la API que no pertenecen a un mundo. */
const GLOBAL_API = ["/api/health", "/api/worlds", "/api/auth", "/api/admin"];

/** `/api/x` → `/api/worlds/<mundo>/x` (salvo las rutas generales). */
export function worldApiPath(path: string, worldId: string): string {
  if (!path.startsWith("/api/") || GLOBAL_API.some((g) => path.startsWith(g))) return path;
  return `/api/worlds/${encodeURIComponent(worldId)}/${path.slice("/api/".length)}`;
}
