import type { AgentState, Facing } from "../schemas/agent";
import { pathLength, pointAlong } from "./pathfinding";

export interface AgentPosition {
  /** Baldosas (fraccionarias). */
  x: number;
  y: number;
  facing: Facing;
  moving: boolean;
  /** Baldosas recorridas desde el inicio del tramo (para elegir el frame de la animación). */
  distance: number;
}

/**
 * Posición de un agente en un instante de juego. Pura: el cliente la llama cada frame con su
 * estimación del reloj, así el movimiento es suave a cualquier velocidad de simulación.
 */
export function positionAt(
  state: Pick<AgentState, "tile" | "facing" | "movement">,
  gameTime: number,
): AgentPosition {
  const m = state.movement;
  if (!m || m.waypoints.length < 2) {
    return { x: state.tile.x, y: state.tile.y, facing: state.facing, moving: false, distance: 0 };
  }
  const total = pathLength(m.waypoints);
  const span = Math.max(1e-6, m.endTime - m.startTime);
  const t = Math.min(1, Math.max(0, (gameTime - m.startTime) / span));
  const distance = total * t;
  const p = pointAlong(m.waypoints, distance);
  return { x: p.x, y: p.y, facing: p.facing, moving: t < 1, distance };
}
