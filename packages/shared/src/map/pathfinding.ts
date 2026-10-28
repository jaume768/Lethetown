import type { Facing } from "../schemas/agent";
import type { TilePoint } from "../schemas/world";

export interface Grid {
  width: number;
  height: number;
  /** 1 = bloqueado. Índice = y * width + x. */
  collision: readonly number[];
}

export function isWalkable(grid: Grid, p: TilePoint): boolean {
  return (
    p.x >= 0 &&
    p.y >= 0 &&
    p.x < grid.width &&
    p.y < grid.height &&
    !grid.collision[p.y * grid.width + p.x]
  );
}

/** Orden fijo de vecinos (arriba, derecha, abajo, izquierda) para que el resultado sea determinista. */
const NEIGHBORS: readonly TilePoint[] = [
  { x: 0, y: -1 },
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
];

interface Node {
  index: number;
  f: number;
  h: number;
  seq: number;
}

/** Montículo binario mínimo por (f, h, orden de inserción): desempates estables. */
class MinHeap {
  private items: Node[] = [];

  get size() {
    return this.items.length;
  }

  push(node: Node) {
    const a = this.items;
    a.push(node);
    let i = a.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!less(a[i]!, a[parent]!)) break;
      [a[i], a[parent]] = [a[parent]!, a[i]!];
      i = parent;
    }
  }

  pop(): Node | undefined {
    const a = this.items;
    const top = a[0];
    const last = a.pop();
    if (a.length && last) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && less(a[l]!, a[m]!)) m = l;
        if (r < a.length && less(a[r]!, a[m]!)) m = r;
        if (m === i) break;
        [a[i], a[m]] = [a[m]!, a[i]!];
        i = m;
      }
    }
    return top;
  }
}

function less(a: Node, b: Node): boolean {
  return a.f !== b.f ? a.f < b.f : a.h !== b.h ? a.h < b.h : a.seq < b.seq;
}

/**
 * A* en 4 direcciones con heurística Manhattan. Devuelve el camino incluyendo inicio y meta,
 * o null si no hay camino. Determinista: misma entrada → mismo camino.
 */
export function findPath(grid: Grid, start: TilePoint, goal: TilePoint): TilePoint[] | null {
  if (!isWalkable(grid, start) || !isWalkable(grid, goal)) return null;
  const { width } = grid;
  const startIdx = start.y * width + start.x;
  const goalIdx = goal.y * width + goal.x;
  if (startIdx === goalIdx) return [{ ...start }];

  const g = new Map<number, number>([[startIdx, 0]]);
  const cameFrom = new Map<number, number>();
  const closed = new Set<number>();
  const heap = new MinHeap();
  let seq = 0;
  const h = (idx: number) =>
    Math.abs((idx % width) - goal.x) + Math.abs(Math.floor(idx / width) - goal.y);
  heap.push({ index: startIdx, f: h(startIdx), h: h(startIdx), seq: seq++ });

  while (heap.size) {
    const current = heap.pop()!;
    if (closed.has(current.index)) continue;
    if (current.index === goalIdx) return reconstruct(cameFrom, goalIdx, width);
    closed.add(current.index);
    const cx = current.index % width;
    const cy = Math.floor(current.index / width);
    const gc = g.get(current.index)!;
    for (const d of NEIGHBORS) {
      const n = { x: cx + d.x, y: cy + d.y };
      if (!isWalkable(grid, n)) continue;
      const ni = n.y * width + n.x;
      if (closed.has(ni)) continue;
      const tentative = gc + 1;
      if (tentative < (g.get(ni) ?? Infinity)) {
        g.set(ni, tentative);
        cameFrom.set(ni, current.index);
        const hn = h(ni);
        heap.push({ index: ni, f: tentative + hn, h: hn, seq: seq++ });
      }
    }
  }
  return null;
}

function reconstruct(cameFrom: Map<number, number>, goalIdx: number, width: number): TilePoint[] {
  const path: TilePoint[] = [];
  let idx: number | undefined = goalIdx;
  while (idx !== undefined) {
    path.push({ x: idx % width, y: Math.floor(idx / width) });
    idx = cameFrom.get(idx);
  }
  return path.reverse();
}

/** Reduce un camino a sus puntos de giro (inicio, esquinas y meta). */
export function toWaypoints(path: readonly TilePoint[]): TilePoint[] {
  if (path.length <= 2) return path.map((p) => ({ ...p }));
  const out: TilePoint[] = [{ ...path[0]! }];
  for (let i = 1; i < path.length - 1; i++) {
    const prev = path[i - 1]!;
    const cur = path[i]!;
    const next = path[i + 1]!;
    const sameDir = cur.x - prev.x === next.x - cur.x && cur.y - prev.y === next.y - cur.y;
    if (!sameDir) out.push({ ...cur });
  }
  out.push({ ...path[path.length - 1]! });
  return out;
}

/** Longitud (en baldosas) de una polilínea de waypoints ortogonales. */
export function pathLength(waypoints: readonly TilePoint[]): number {
  let len = 0;
  for (let i = 1; i < waypoints.length; i++) {
    len +=
      Math.abs(waypoints[i]!.x - waypoints[i - 1]!.x) +
      Math.abs(waypoints[i]!.y - waypoints[i - 1]!.y);
  }
  return len;
}

/** Posición (en baldosas, fraccionaria) a una distancia dada a lo largo de los waypoints. */
export function pointAlong(
  waypoints: readonly TilePoint[],
  distance: number,
): { x: number; y: number; facing: Facing } {
  let remaining = Math.max(0, distance);
  let facing: Facing = "down";
  for (let i = 1; i < waypoints.length; i++) {
    const a = waypoints[i - 1]!;
    const b = waypoints[i]!;
    const seg = Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
    facing = facingOf(a, b);
    if (remaining <= seg) {
      const t = seg ? remaining / seg : 1;
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, facing };
    }
    remaining -= seg;
  }
  const last = waypoints[waypoints.length - 1] ?? { x: 0, y: 0 };
  return { x: last.x, y: last.y, facing };
}

export function facingOf(a: TilePoint, b: TilePoint): Facing {
  if (Math.abs(b.x - a.x) >= Math.abs(b.y - a.y))
    return b.x > a.x ? "right" : b.x < a.x ? "left" : "down";
  return b.y > a.y ? "down" : "up";
}
