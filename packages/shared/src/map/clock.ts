/**
 * Estimación del tiempo de juego en el cliente entre mensajes del servidor.
 *
 * Cada mensaje trae `time` y `speed`, pero llega con retraso (red, bus entre procesos), así que
 * si se tomara tal cual el reloj saltaría hacia atrás en cada mensaje y los agentes que caminan
 * retrocederían. El estimador:
 * - nunca devuelve un tiempo menor que el anterior (salvo un salto grande de verdad);
 * - absorbe la diferencia con el servidor poco a poco, sin bajar de la mitad de la velocidad;
 * - conserva la continuidad al cambiar de velocidad.
 */
export class ClockEstimator {
  private base = 0;
  private at = 0;
  private speed = 0;
  /** Diferencia con el servidor que queda por absorber (minutos de juego). */
  private correction = 0;
  private slewMs = 1;
  private last = Number.NEGATIVE_INFINITY;

  /**
   * @param snapMinutes diferencia (minutos de juego) a partir de la cual se salta directamente al
   *   tiempo del servidor: restaurar una instantánea, cambiar de mundo...
   * @param minSlewMs tiempo real mínimo para absorber una diferencia.
   */
  constructor(
    private readonly snapMinutes = 30,
    private readonly minSlewMs = 1000,
  ) {}

  /** Nuevo dato del servidor (`nowMs`: performance.now() o similar al recibirlo). */
  sync(serverTime: number, speed: number, nowMs: number): void {
    const shown = this.last === Number.NEGATIVE_INFINITY ? serverTime : this.now(nowMs);
    const error = serverTime - shown;
    if (Math.abs(error) > this.snapMinutes || this.last === Number.NEGATIVE_INFINITY) {
      this.base = serverTime;
      this.correction = 0;
      this.last = serverTime;
    } else {
      this.base = shown;
      this.correction = error;
    }
    this.at = nowMs;
    this.speed = speed;
    // Si hay que retrasar el reloj, se hace sin bajar de la mitad de la velocidad (no se para).
    const perMs = speed / 60_000;
    this.slewMs =
      error < 0 && perMs > 0 ? Math.max(this.minSlewMs, (2 * -error) / perMs) : this.minSlewMs;
  }

  /** Tiempo de juego estimado ahora (minutos). */
  now(nowMs: number): number {
    const elapsed = Math.max(0, nowMs - this.at);
    const k = Math.min(1, elapsed / this.slewMs);
    const value = this.base + (elapsed / 60_000) * this.speed + this.correction * k;
    if (value < this.last) return this.last;
    this.last = value;
    return value;
  }
}
