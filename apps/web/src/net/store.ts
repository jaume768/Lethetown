import {
  ServerMessage,
  type AgentState,
  type ClientMessage,
  type ClockState,
  type CostSummary,
  type SimEvent,
  type World,
} from "@lethetown/shared";
import { useSyncExternalStore } from "react";

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
}

const MAX_EVENTS = 300;

let state: GameState = {
  connected: false,
  clockReceivedAt: 0,
  world: null,
  provider: "",
  clock: { time: 0, speed: 0 },
  agents: [],
  events: [],
  costs: null,
};
const listeners = new Set<() => void>();
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
      });
    case "tick":
      return set({ clock: msg.clock, clockReceivedAt: performance.now(), agents: msg.agents });
    case "event":
      return set({ events: [...state.events, msg.event].slice(-MAX_EVENTS) });
    case "cost":
      return set({ costs: msg.summary });
  }
}

/** Conecta al WebSocket del servidor y reconecta si se cae. */
export function connect() {
  if (socket) return;
  const url = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`;
  const ws = new WebSocket(url);
  socket = ws;
  ws.onopen = () => set({ connected: true });
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
