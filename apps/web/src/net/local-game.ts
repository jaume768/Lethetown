import type { ServerMessage } from "@lethetown/shared";
import { useSyncExternalStore } from "react";
import { applyMessage, INITIAL_STATE, type GameState } from "./game-state";

type MemoryEffect = Extract<ServerMessage, { type: "memory_effect" }>;

/**
 * Estado de juego propio (fuera del store global), con el MISMO reductor: la segunda
 * repetición de la pantalla partida, que se pinta a la vez que la primera.
 */
export class LocalGame {
  private state: GameState = { ...INITIAL_STATE, connected: true };
  private readonly listeners = new Set<() => void>();
  private readonly effects = new Set<(e: MemoryEffect) => void>();

  get = (): GameState => this.state;

  subscribe = (l: () => void): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  onMemoryEffect = (l: (e: MemoryEffect) => void): (() => void) => {
    this.effects.add(l);
    return () => this.effects.delete(l);
  };

  /** Como `feed` del store: todos de una vez, y `reset` parte de cero. */
  feed = (msgs: readonly ServerMessage[], reset = false) => {
    let next = reset ? { ...INITIAL_STATE, connected: true } : this.state;
    for (const msg of msgs) {
      if (msg.type === "memory_effect") for (const l of this.effects) l(msg);
      next = applyMessage(next, msg);
    }
    if (next === this.state && !reset) return;
    this.state = next;
    for (const l of this.listeners) l();
  };
}

const EMPTY = { ...INITIAL_STATE };
const noop = () => () => {};

/** El estado de un `LocalGame` (o el inicial si no hay). */
export function useLocalGame(game: LocalGame | null): GameState {
  return useSyncExternalStore(game ? game.subscribe : noop, game ? game.get : () => EMPTY);
}
