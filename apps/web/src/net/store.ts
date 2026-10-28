import {
  RUNNING,
  ServerMessage,
  type AgentState,
  type Chronicle,
  type Drama,
  type WorldRunStatus,
  type ClientMessage,
  type ClockState,
  type CostSummary,
  type SimEvent,
  type Weather,
  type World,
} from "@lethetown/shared";
import { useSyncExternalStore } from "react";

export type MemoryEffectMessage = Extract<ServerMessage, { type: "memory_effect" }>;

export interface GameState {
  connected: boolean;
  /** Ya se recibió el primer snapshot (para la pantalla de carga). */
  loaded: boolean;
  /** Intentos de reconexión seguidos (0 = conectado o primer intento). */
  retries: number;
  status: WorldRunStatus;
  dramas: Drama[];
  /** performance.now() al recibir el último reloj, para extrapolar el tiempo de juego. */
  clockReceivedAt: number;
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

const MAX_EVENTS = 400;
const MAX_DRAMAS = 100;

let state: GameState = {
  connected: false,
  loaded: false,
  retries: 0,
  status: RUNNING,
  dramas: [],
  clockReceivedAt: 0,
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
const listeners = new Set<() => void>();
const effectListeners = new Set<(e: MemoryEffectMessage) => void>();
let socket: WebSocket | null = null;

function set(patch: Partial<GameState>) {
  state = { ...state, ...patch };
  for (const l of listeners) l();
}

function handle(msg: ServerMessage) {
  switch (msg.type) {
    case "snapshot":
      loadRecentEvents(msg.snapshot.clock.time);
      return set({
        world: msg.snapshot.world,
        provider: msg.snapshot.provider,
        clock: msg.snapshot.clock,
        clockReceivedAt: performance.now(),
        agents: msg.snapshot.agents,
        weather: msg.snapshot.weather,
        status: msg.snapshot.status,
        loaded: true,
      });
    case "tick":
      return set({ clock: msg.clock, clockReceivedAt: performance.now(), agents: msg.agents });
    case "delta": {
      // Mezcla los agentes que cambiaron con los que ya teníamos.
      const changed = new Map(msg.agents.map((a) => [a.id, a]));
      const removed = new Set(msg.removed);
      const agents = state.agents
        .filter((a) => !removed.has(a.id))
        .map((a) => changed.get(a.id) ?? a);
      for (const a of msg.agents) if (!state.agents.some((x) => x.id === a.id)) agents.push(a);
      return set({
        clock: msg.clock,
        clockReceivedAt: performance.now(),
        ...(msg.agents.length || removed.size ? { agents } : {}),
      });
    }
    case "event":
      return set({ events: [...state.events, msg.event].slice(-MAX_EVENTS) });
    case "cost":
      return set({ costs: msg.summary });
    case "thinking": {
      const prev = state.thinking[msg.agentId]?.count ?? 0;
      const count = Math.max(0, prev + (msg.phase === "start" ? 1 : -1));
      return set({ thinking: { ...state.thinking, [msg.agentId]: { count, task: msg.task } } });
    }
    case "memory_effect":
      for (const l of effectListeners) l(msg);
      return;
    case "status":
      return set({ status: msg.status });
    case "drama":
      return set({
        dramas: [msg.drama, ...state.dramas.filter((d) => d.id !== msg.drama.id)].slice(
          0,
          MAX_DRAMAS,
        ),
      });
    case "chronicle":
      return set({
        chronicles: [...state.chronicles.filter((c) => c.day !== msg.chronicle.day), msg.chronicle],
      });
    case "world": {
      const states = new Map(msg.spots.map((s) => [s.id, s.state]));
      const world = state.world && {
        ...state.world,
        places: state.world.places.map((p) => ({
          ...p,
          objects: p.objects.map((o) => ({ ...o, state: states.get(o.id) ?? o.state })),
        })),
      };
      return set({ weather: msg.weather, world });
    }
  }
}

/** Mundo que se está viendo (`?world=…`); sin parámetro, el mundo por defecto. */
export const WORLD_ID = new URLSearchParams(location.search).get("world") ?? "default";

/** Rutas de la API que no pertenecen a un mundo. */
const GLOBAL_API = ["/api/health", "/api/worlds", "/api/auth", "/api/admin"];

/** `/api/x` → `/api/worlds/<mundo>/x` (salvo las rutas generales). */
export function apiPath(path: string): string {
  if (!path.startsWith("/api/") || GLOBAL_API.some((g) => path.startsWith(g))) return path;
  return `/api/worlds/${encodeURIComponent(WORLD_ID)}/${path.slice("/api/".length)}`;
}

/** Conecta al WebSocket del servidor y reconecta si se cae. */
export function connect() {
  if (socket) return;
  const url = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws?world=${encodeURIComponent(WORLD_ID)}`;
  const ws = new WebSocket(url);
  socket = ws;
  ws.onopen = () => {
    set({ connected: true, retries: 0, thinking: {} });
    void api<Chronicle[]>("/api/chronicles").then((chronicles) => set({ chronicles }));
    void api<Drama[]>("/api/dramas?limit=50").then((dramas) => set({ dramas }));
  };
  ws.onmessage = (e) => {
    const parsed = ServerMessage.safeParse(JSON.parse(String(e.data)));
    if (parsed.success) handle(parsed.data);
    else console.warn("Mensaje inválido del servidor", parsed.error);
  };
  ws.onclose = () => {
    socket = null;
    set({ connected: false, retries: state.retries + 1 });
    // Backoff suave: 1,5 s, 3 s, 4,5 s… hasta 15 s.
    setTimeout(connect, Math.min(15_000, 1500 * (state.retries || 1)));
  };
}

/** Lo último que pasó (si no, el log arranca vacío hasta el siguiente evento). */
function loadRecentEvents(now: number) {
  void api<SimEvent[]>(`/api/events?from=${Math.max(0, now - 180)}&limit=200`)
    .then((recent) => {
      const known = new Set(state.events.map((e) => e.id));
      const merged = [...recent.filter((e) => !known.has(e.id)), ...state.events];
      set({ events: merged.sort((a, b) => a.time - b.time).slice(-MAX_EVENTS) });
    })
    .catch(() => undefined);
}

/** Vuelve a conectar (p. ej. tras iniciar o cerrar sesión: el WS lleva la cookie de sesión). */
export function reconnect() {
  socket?.close();
}

export function send(msg: ClientMessage) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(msg));
}

/** Pequeño helper de fetch JSON contra la API del servidor. */
export async function api<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(apiPath(path), {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

export function onMemoryEffect(listener: (e: MemoryEffectMessage) => void): () => void {
  effectListeners.add(listener);
  return () => effectListeners.delete(listener);
}

/** Tiempo de juego estimado ahora mismo (entre ticks del servidor). */
export function gameTimeNow(): number {
  const elapsedMin = (performance.now() - state.clockReceivedAt) / 60_000;
  return state.clock.time + elapsedMin * state.clock.speed;
}

export function getState(): GameState {
  return state;
}

export function useGame(): GameState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}
