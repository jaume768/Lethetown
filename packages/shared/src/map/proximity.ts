/**
 * Proximidad entre agentes (fase 3.6): en qué baldosa está alguien en un instante (también a
 * mitad de camino) y quién tiene cerca a quién. Pura y determinista: la usan el servidor (los
 * encuentros por el camino, la presencia en una charla en el camino) y los tests.
 */
import type { AgentState } from "../schemas/agent";
import type { TilePoint } from "../schemas/world";
import { positionAt } from "./movement";

/** Punto en baldosas (puede ser fraccionario a mitad de un tramo). */
export interface Point {
  x: number;
  y: number;
}

/**
 * Baldosa en la que está un agente en `now`: la de su ruta si camina (redondeando la posición
 * interpolada, igual que la ve el cliente) o la suya si está quieto.
 */
export function tileAt(
  state: Pick<AgentState, "tile" | "facing" | "movement">,
  now: number,
): TilePoint {
  if (!state.movement) return { x: state.tile.x, y: state.tile.y };
  const p = positionAt(state, now);
  return { x: Math.round(p.x), y: Math.round(p.y) };
}

/** Distancia (euclídea, en baldosas) entre dos puntos. */
export function tileDistance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** ¿Están a `radius` baldosas o menos? */
export function isNear(a: Point, b: Point, radius: number): boolean {
  return tileDistance(a, b) <= radius;
}

/**
 * La distancia mínima entre dos agentes en el intervalo [from, to] (y cuándo), muestreando cada
 * `step` minutos de juego y los extremos. Sirve para no perder a dos que se cruzan en sentidos
 * opuestos entre dos revisiones (a 6 baldosas por minuto cada uno, atraviesan un radio de 4
 * baldosas en menos de un minuto).
 */
export function closestApproach(
  a: Pick<AgentState, "tile" | "facing" | "movement">,
  b: Pick<AgentState, "tile" | "facing" | "movement">,
  from: number,
  to: number,
  step = 0.25,
  /** Solo cuentan los instantes en que se ven (p. ej. no a través de una pared). */
  visible: (t: number) => boolean = () => true,
): { distance: number; at: number } {
  const at = (t: number) => {
    const pa = positionAt(a, t);
    const pb = positionAt(b, t);
    return tileDistance(pa, pb);
  };
  let best = { distance: Infinity, at: to };
  const times: number[] = [];
  for (let t = from; t < to; t += Math.max(1e-3, step)) times.push(t);
  times.push(to);
  for (const t of times) {
    const d = at(t);
    if (d < best.distance && visible(t)) best = { distance: d, at: t };
  }
  return best;
}

/** Un vecino cercano: su id y a qué distancia está. */
export interface Neighbour {
  id: string;
  distance: number;
}

/**
 * Índice espacial por celdas cuadradas: para saber quién está cerca no hace falta comparar a
 * todos con todos, solo con los de las celdas vecinas. Con celdas del tamaño del radio, basta
 * mirar las 3×3 de alrededor.
 */
export class CellIndex {
  private readonly cells = new Map<string, { id: string; p: Point }[]>();
  private readonly points = new Map<string, Point>();

  constructor(readonly cellSize: number) {
    if (!(cellSize > 0)) throw new Error("CellIndex: el tamaño de celda debe ser > 0");
  }

  private cellOf(p: Point): [number, number] {
    return [Math.floor(p.x / this.cellSize), Math.floor(p.y / this.cellSize)];
  }

  add(id: string, p: Point): void {
    const [cx, cy] = this.cellOf(p);
    const key = `${cx},${cy}`;
    const list = this.cells.get(key) ?? [];
    list.push({ id, p });
    this.cells.set(key, list);
    this.points.set(id, p);
  }

  get(id: string): Point | undefined {
    return this.points.get(id);
  }

  get size(): number {
    return this.points.size;
  }

  /**
   * Quién está a `radius` baldosas o menos de `p` (sin `exceptId`), del más cercano al más
   * lejano y, a igual distancia, por id (determinista).
   */
  near(p: Point, radius: number, exceptId?: string): Neighbour[] {
    const span = Math.max(1, Math.ceil(radius / this.cellSize));
    const [cx, cy] = this.cellOf(p);
    const out: Neighbour[] = [];
    for (let dx = -span; dx <= span; dx++) {
      for (let dy = -span; dy <= span; dy++) {
        for (const e of this.cells.get(`${cx + dx},${cy + dy}`) ?? []) {
          if (e.id === exceptId) continue;
          const distance = tileDistance(p, e.p);
          if (distance <= radius) out.push({ id: e.id, distance });
        }
      }
    }
    return out.sort((a, b) => a.distance - b.distance || a.id.localeCompare(b.id));
  }
}
