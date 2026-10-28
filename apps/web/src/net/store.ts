import {
  ServerMessage,
  type AgentState,
  type Chronicle,
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

let state: GameState = {
  connected: false,
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
      return set({
        world: msg.snapshot.world,
        provider: msg.snapshot.provider,
        clock: msg.snapshot.clock,
        clockReceivedAt: performance.now(),
        agents: msg.snapshot.agents,
        weather: msg.snapshot.weather,
      });
    case "tick":
      return set({ clock: msg.clock, clockReceivedAt: performance.now(), agents: msg.agents });
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
    set({ connected: true, thinking: {} });
    void api<Chronicle[]>("/api/chronicles").then((chronicles) => set({ chronicles }));
  };
  ws.onmessage = (e) => {
    const parsed = ServerMessage.safeParse(JSON.parse(String(e.data)));
    if (parsed.success) handle(parsed.data);
    else console.warn("Mensaje inválido del servidor", parsed.error);
  };
  ws.onclose = () => {
    socket = null;
    set({ connected: false });
    setTimeout(connect, 1500);
  };
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
