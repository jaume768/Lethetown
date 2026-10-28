import type { AppConfig } from "../config";
import type { WorldRuntime } from "../bootstrap";

/**
 * Qué hacer con un mundo sin espectadores durante NO_VIEWERS_AFTER_SECONDS:
 * - pause: se pausa (y se reanuda solo cuando vuelve alguien);
 * - lod: sigue vivo, pero los agentes piensan con menos frecuencia (LOD_TICK_FACTOR);
 * - off: nada.
 */
export class ViewerPolicy {
  private readonly emptySince = new Map<string, number>();
  private readonly applied = new Map<string, "pause" | "lod">();

  constructor(
    private readonly config: Pick<
      AppConfig,
      "NO_VIEWERS_MODE" | "NO_VIEWERS_AFTER_SECONDS" | "LOD_TICK_FACTOR"
    >,
    private readonly now: () => number = Date.now,
  ) {}

  /** Aplica la política a un mundo según sus espectadores actuales. */
  update(w: WorldRuntime, viewers: number): void {
    const mode = this.config.NO_VIEWERS_MODE;
    if (mode === "off") return;
    if (viewers > 0) {
      this.emptySince.delete(w.id);
      const applied = this.applied.get(w.id);
      if (!applied) return;
      this.applied.delete(w.id);
      if (applied === "lod") w.sim.setTickMultiplier(1);
      // Solo reanuda si sigue pausado por falta de público (no por presupuesto).
      else if (w.status().reason === "no_viewers") w.resume();
      return;
    }
    const since = this.emptySince.get(w.id) ?? this.now();
    this.emptySince.set(w.id, since);
    if (this.applied.has(w.id)) return;
    if (this.now() - since < this.config.NO_VIEWERS_AFTER_SECONDS * 1000) return;
    if (mode === "lod") {
      w.sim.setTickMultiplier(this.config.LOD_TICK_FACTOR);
      this.applied.set(w.id, "lod");
    } else if (w.status().state === "running") {
      w.pause("no_viewers", "Sin espectadores");
      this.applied.set(w.id, "pause");
    }
  }
}
