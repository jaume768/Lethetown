import type { SimSpeed } from "@lethetown/shared";

type Handler = () => void | Promise<void>;

interface ScheduledEvent {
  at: number;
  seq: number;
  run: Handler;
}

/**
 * Reloj de juego dirigido por eventos: no hay bucle por frames. Se mantiene una cola de
 * prioridad de eventos en tiempo de juego y un único temporizador real que despierta justo
 * cuando toca el siguiente evento, según el multiplicador de velocidad.
 * x1 = un minuto de juego por minuto real.
 */
export class GameClock {
  private queue: ScheduledEvent[] = [];
  private seq = 0;
  private timer: NodeJS.Timeout | null = null;
  private anchorGame: number;
  private anchorReal = Date.now();
  private running = false;
  private _speed: SimSpeed;
  /** Tope de ritmo (minutos de juego por minuto real), p. ej. x10 durante una conversación. */
  private _cap: number | null = null;

  constructor(
    startTime: number,
    speed: SimSpeed,
    private readonly onError: (error: unknown) => void = () => {},
    private readonly realNow: () => number = Date.now,
  ) {
    this.anchorGame = startTime;
    this._speed = speed;
  }

  /** Velocidad elegida (la que se muestra). */
  get speed(): SimSpeed {
    return this._speed;
  }

  /** Ritmo real: la velocidad elegida, limitada por el tope si lo hay. */
  get rate(): number {
    return this._cap === null ? this._speed : Math.min(this._speed, this._cap);
  }

  /** Tiempo de juego actual (minutos), interpolado entre eventos. */
  now(): number {
    if (!this.running) return this.anchorGame;
    return this.anchorGame + ((this.realNow() - this.anchorReal) / 60_000) * this.rate;
  }

  setSpeed(speed: SimSpeed): void {
    this.reanchor();
    this._speed = speed;
    this.arm();
  }

  /** Pone (o quita, con null) un tope al ritmo sin cambiar la velocidad elegida. */
  setCap(cap: number | null): void {
    if (cap === this._cap) return;
    this.reanchor();
    this._cap = cap;
    this.arm();
  }

  schedule(at: number, run: Handler): void {
    this.queue.push({ at, seq: this.seq++, run });
    this.queue.sort((a, b) => a.at - b.at || a.seq - b.seq);
    if (this.running) this.arm();
  }

  start(): void {
    if (this.running) return;
    this.anchorReal = this.realNow();
    this.running = true;
    this.arm();
  }

  stop(): void {
    this.reanchor();
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /**
   * Avance determinista (tests y modo texto): ejecuta en orden, esperando a cada handler,
   * todos los eventos hasta `until`. No usa temporizadores reales.
   */
  async runUntil(until: number): Promise<void> {
    for (;;) {
      const next = this.queue[0];
      if (!next || next.at > until) break;
      this.queue.shift();
      this.anchorGame = Math.max(this.anchorGame, next.at);
      await next.run();
    }
    this.anchorGame = Math.max(this.anchorGame, until);
  }

  get pending(): number {
    return this.queue.length;
  }

  private reanchor(): void {
    this.anchorGame = this.now();
    this.anchorReal = this.realNow();
  }

  private arm(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const next = this.queue[0];
    if (!this.running || !next || this.rate === 0) return;
    const delayMs = Math.max(0, ((next.at - this.now()) / this.rate) * 60_000);
    this.timer = setTimeout(() => this.fire(), Math.min(delayMs, 2 ** 31 - 1));
  }

  private fire(): void {
    const now = this.now();
    while (this.queue[0] && this.queue[0].at <= now) {
      const ev = this.queue.shift()!;
      Promise.resolve().then(ev.run).catch(this.onError);
    }
    this.arm();
  }
}
