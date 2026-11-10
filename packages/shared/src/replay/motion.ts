import { AWAY_LOCATION } from "../schemas/goals";
import type { AgentState, Movement } from "../schemas/agent";
import type { TilePoint, World } from "../schemas/world";
import { findPath, pathLength, toWaypoints, type Grid } from "../map/pathfinding";
import type { ReplayFrame, ReplayTrack } from "./bundle";

/** Fotos completas (todas con todos los agentes), compartiendo los objetos que no cambian. */
export interface FullFrame {
  time: number;
  agents: AgentState[];
  byId: Map<string, AgentState>;
}

/** Deshace la codificación por diferencias del paquete: cada foto, con todos los agentes. */
export function expandFrames(frames: readonly ReplayFrame[]): FullFrame[] {
  const out: FullFrame[] = [];
  let current = new Map<string, AgentState>();
  for (const f of frames) {
    const next = new Map(current);
    for (const id of f.removed ?? []) next.delete(id);
    for (const a of f.agents) next.set(a.id, a);
    current = next;
    out.push({ time: f.time, agents: [...next.values()], byId: next });
  }
  return out;
}

/** Índice de la última entrada con `time ≤ t` (−1 si todas son posteriores). Búsqueda binaria. */
export function lastAtOrBefore(items: readonly { time: number }[], t: number): number {
  let lo = 0;
  let hi = items.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (items[mid]!.time <= t) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
}

export function gridOf(world: World): Grid {
  return {
    width: world.width,
    height: world.height,
    collision: world.collision,
    paths: world.paths,
  };
}

/** Posiciones de la pista por agente, en orden: [minuto, x, y]. */
export type TrackIndex = Map<string, [number, number, number][]>;

export function indexTrack(track: readonly ReplayTrack[] | undefined): TrackIndex {
  const out: TrackIndex = new Map();
  for (const step of track ?? []) {
    for (const [id, x, y] of step.p) {
      let list = out.get(id);
      if (!list) out.set(id, (list = []));
      list.push([step.time, x, y]);
    }
  }
  return out;
}

const round = (p: { x: number; y: number }): TilePoint => ({
  x: Math.round(p.x),
  y: Math.round(p.y),
});
const same = (a: TilePoint, b: TilePoint) => a.x === b.x && a.y === b.y;

/** Ruta andando de `from` a `to` (por el pathfinding del juego; si no hay, en línea recta). */
export function walkRoute(grid: Grid, from: TilePoint, to: TilePoint): TilePoint[] {
  const path = findPath(grid, from, to);
  return toWaypoints(path ?? [from, to]);
}

export interface MotionContext {
  grid: Grid;
  walkTilesPerMinute: number;
  track?: TrackIndex;
  /** Caché de rutas («x,y>x,y» → waypoints): el reproductor pide las mismas en cada frame. */
  routes?: Map<string, TilePoint[]>;
}

function route(ctx: MotionContext, from: TilePoint, to: TilePoint): TilePoint[] {
  const key = `${from.x},${from.y}>${to.x},${to.y}`;
  const hit = ctx.routes?.get(key);
  if (hit) return hit;
  const r = walkRoute(ctx.grid, from, to);
  ctx.routes?.set(key, r);
  return r;
}

/**
 * Estado de un agente en `t`, entre la foto `a` (en `ta ≤ t`) y la siguiente `b` (en `tb`), para
 * que ande en vez de teletransportarse. Por orden:
 * 1. Con la pista de posiciones (`record --track`), la ruta real minuto a minuto.
 * 2. Si en la foto ya iba andando, su ruta real (`movement`, la que mandó el servidor).
 * 3. Si en la siguiente foto va andando, su ruta real desde que salió.
 * 4. Si no, de donde estaba a donde está después por el camino del juego, llegando a la hora
 *    de la siguiente foto (o antes de su siguiente ruta real) a su paso de siempre.
 * Solo cambia la posición (`tile` y `movement`); lo demás es lo de la foto `a`.
 */
export function agentAt(
  a: AgentState,
  ta: number,
  b: AgentState | undefined,
  tb: number,
  t: number,
  ctx: MotionContext,
): AgentState {
  const fromTrack = trackMotion(a, ta, t, ctx);
  if (fromTrack) return fromTrack;
  if (a.locationId === AWAY_LOCATION || !b || b.locationId === AWAY_LOCATION) return a;
  // 2. La ruta de la foto, mientras dure.
  if (a.movement && a.movement.endTime > t) return a;
  const start = a.movement ? a.movement.waypoints[a.movement.waypoints.length - 1]! : a.tile;
  const startTime = a.movement ? Math.max(ta, a.movement.endTime) : ta;
  // 3. La ruta real de la foto siguiente, si ya había salido.
  const nextRoute = b.movement && b.movement.startTime >= startTime ? b.movement : null;
  if (nextRoute && t >= nextRoute.startTime) return { ...a, tile: b.tile, movement: nextRoute };
  const goal = nextRoute ? nextRoute.waypoints[0]! : b.tile;
  const arriveBy = nextRoute ? nextRoute.startTime : tb;
  if (same(start, goal)) return start === a.tile ? a : { ...a, tile: start, movement: null };
  // 4. Andando por el camino, para llegar justo a tiempo.
  const waypoints = route(ctx, start, goal);
  const duration = pathLength(waypoints) / ctx.walkTilesPerMinute;
  const leave = Math.max(startTime, arriveBy - duration);
  const movement: Movement = { waypoints, startTime: leave, endTime: Math.max(leave, arriveBy) };
  return { ...a, tile: start, movement };
}

/** Con la pista: el tramo del minuto en curso (o quieto donde se le vio por última vez). */
function trackMotion(a: AgentState, ta: number, t: number, ctx: MotionContext): AgentState | null {
  const list = ctx.track?.get(a.id);
  if (!list?.length) return null;
  let lo = 0;
  let hi = list.length - 1;
  let i = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid]![0] <= t) {
      i = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  const next = list[i + 1];
  const cur = list[i];
  // Antes de la primera muestra: manda la foto.
  if (!cur) return null;
  if (next && next[0] - cur[0] <= 1.0001) {
    const from = round({ x: cur[1], y: cur[2] });
    const to = round({ x: next[1], y: next[2] });
    const waypoints = same(from, to) ? [from] : route(ctx, from, to);
    return { ...a, tile: from, movement: { waypoints, startTime: cur[0], endTime: next[0] } };
  }
  // Una muestra anterior a la foto: manda la foto.
  if (cur[0] < ta) return null;
  return { ...a, tile: round({ x: cur[1], y: cur[2] }), movement: null };
}

/** Todos los agentes en `t` (con su movimiento interpolado). */
export function agentsAt(
  frames: readonly FullFrame[],
  t: number,
  ctx: MotionContext,
): AgentState[] {
  const i = Math.max(0, lastAtOrBefore(frames, t));
  const a = frames[i]!;
  const b = frames[i + 1];
  if (!b || t < a.time) return a.agents;
  return a.agents.map((agent) => agentAt(agent, a.time, b.byId.get(agent.id), b.time, t, ctx));
}
