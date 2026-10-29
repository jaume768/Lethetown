import {
  ClockEstimator,
  ServerMessage,
  type Chronicle,
  type ClientMessage,
  type Drama,
  type SimEvent,
} from "@lethetown/shared";
import { useSyncExternalStore } from "react";
import {
  applyMessage,
  INITIAL_STATE,
  MAX_EVENTS,
  worldApiPath,
  type GameState,
} from "./game-state";

export type { GameState } from "./game-state";

export type MemoryEffectMessage = Extract<ServerMessage, { type: "memory_effect" }>;

let state: GameState = INITIAL_STATE;
const listeners = new Set<() => void>();
const effectListeners = new Set<(e: MemoryEffectMessage) => void>();
let socket: WebSocket | null = null;

function set(patch: Partial<GameState>) {
  state = { ...state, ...patch };
  for (const l of listeners) l();
}

/** Tiempo de juego entre mensajes: sin saltos atrás aunque los mensajes lleguen con retraso. */
const clockEstimate = new ClockEstimator();

function handle(msg: ServerMessage) {
  if (msg.type === "snapshot") {
    clockEstimate.sync(msg.snapshot.clock.time, msg.snapshot.clock.speed, performance.now());
    loadRecentEvents(msg.snapshot.clock.time);
  } else if (msg.type === "tick" || msg.type === "delta") {
    clockEstimate.sync(msg.clock.time, msg.clock.speed, performance.now());
  }
  if (msg.type === "memory_effect") for (const l of effectListeners) l(msg);
  const next = applyMessage(state, msg);
  if (next !== state) set(next);
}

/** Mundo que se está viendo (`?world=…`); sin parámetro, el mundo por defecto. */
export const WORLD_ID = new URLSearchParams(location.search).get("world") ?? "default";

/** `/api/x` → `/api/worlds/<mundo>/x` (salvo las rutas generales). */
export function apiPath(path: string): string {
  return worldApiPath(path, WORLD_ID);
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

/** Tiempo de juego estimado ahora mismo (entre ticks del servidor; nunca retrocede). */
export function gameTimeNow(): number {
  return clockEstimate.now(performance.now());
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
