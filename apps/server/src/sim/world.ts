import {
  findPath,
  isWalkable,
  toWaypoints,
  type Place,
  type Spot,
  type TilePoint,
  type Weather,
  type World,
} from "@lethetown/shared";

const key = (p: TilePoint) => `${p.x},${p.y}`;

/** Mundo en ejecución: geometría inmutable del .tmj + estado mutable (objetos, tiempo). */
export class WorldMap {
  private readonly placesById: Map<string, Place>;
  private readonly spotsById: Map<string, Spot>;
  weather: Weather = "sunny";

  constructor(readonly world: World) {
    this.placesById = new Map(world.places.map((p) => [p.id, p]));
    this.spotsById = new Map(world.places.flatMap((p) => p.objects.map((o) => [o.id, o] as const)));
  }

  get places(): Place[] {
    return this.world.places;
  }

  place(id: string): Place {
    const p = this.placesById.get(id);
    if (!p) throw new Error(`Lugar desconocido: ${id}`);
    return p;
  }

  has(id: string): boolean {
    return this.placesById.has(id);
  }

  spot(id: string): Spot | undefined {
    return this.spotsById.get(id);
  }

  /** Cambia el estado de un objeto (intervención del jugador o de la simulación). */
  setSpotState(id: string, state: string): Spot {
    const spot = this.spotsById.get(id);
    if (!spot) throw new Error(`Objeto desconocido: ${id}`);
    spot.state = state;
    return spot;
  }

  /** Lugar al que pertenece una baldosa (el primero cuyo área la contiene). */
  placeAt(tile: TilePoint): Place | undefined {
    return this.places.find(
      (p) =>
        tile.x >= p.area.x &&
        tile.x < p.area.x + p.area.w &&
        tile.y >= p.area.y &&
        tile.y < p.area.y + p.area.h,
    );
  }

  /**
   * Baldosa libre para quedarse en un lugar: el spot pedido si está libre; si no, la baldosa
   * transitable libre más cercana a él (o al ancla del lugar) dentro del área. BFS determinista.
   */
  restingTile(placeId: string, preferred: TilePoint | null, occupied: Set<string>): TilePoint {
    const place = this.place(placeId);
    const start = preferred ?? place.anchor;
    if (!occupied.has(key(start)) && isWalkable(this.world, start)) return start;
    const seen = new Set([key(start)]);
    const queue: TilePoint[] = [start];
    const inArea = (p: TilePoint) =>
      p.x >= place.area.x &&
      p.x < place.area.x + place.area.w &&
      p.y >= place.area.y &&
      p.y < place.area.y + place.area.h;
    while (queue.length) {
      const cur = queue.shift()!;
      for (const d of [
        { x: 0, y: 1 },
        { x: 1, y: 0 },
        { x: -1, y: 0 },
        { x: 0, y: -1 },
      ]) {
        const n = { x: cur.x + d.x, y: cur.y + d.y };
        if (seen.has(key(n)) || !inArea(n) || !isWalkable(this.world, n)) continue;
        if (!occupied.has(key(n))) return n;
        seen.add(key(n));
        queue.push(n);
      }
    }
    return place.anchor;
  }

  /** Ruta en waypoints entre dos baldosas, o null si no hay camino. */
  route(from: TilePoint, to: TilePoint): TilePoint[] | null {
    const path = findPath(this.world, from, to);
    return path ? toWaypoints(path) : null;
  }
}

export const tileKey = key;
