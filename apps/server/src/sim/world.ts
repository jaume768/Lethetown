import type { Place, World } from "@lethetown/shared";

/** Metros de mapa (píxeles) que se recorren por minuto de juego andando. */
const WALK_SPEED = 40;

export class WorldMap {
  private readonly byId: Map<string, Place>;

  constructor(readonly world: World) {
    this.byId = new Map(world.places.map((p) => [p.id, p]));
  }

  get places(): Place[] {
    return this.world.places;
  }

  place(id: string): Place {
    const p = this.byId.get(id);
    if (!p) throw new Error(`Lugar desconocido: ${id}`);
    return p;
  }

  has(id: string): boolean {
    return this.byId.has(id);
  }

  /** Minutos de juego para ir andando de un lugar a otro (rutina trivial, sin LLM). */
  travelMinutes(fromId: string, toId: string): number {
    if (fromId === toId) return 0;
    const a = this.place(fromId).rect;
    const b = this.place(toId).rect;
    const d = Math.hypot(a.x + a.w / 2 - (b.x + b.w / 2), a.y + a.h / 2 - (b.y + b.h / 2));
    return Math.max(3, Math.round(d / WALK_SPEED));
  }
}
