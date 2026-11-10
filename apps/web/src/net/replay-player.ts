import type { ServerMessage, SimEvent } from "@lethetown/shared";
import type { ReplaySource, ReplaySpeed } from "./replay-source";

/** Cada cuánto (ms reales) se avanza la repetición mientras suena. */
const STEP_MS = 200;

export interface PlayerState {
  /** Minuto de juego (redondeado a lo que se pinta en la barra). */
  t: number;
  playing: boolean;
  speed: ReplaySpeed;
  /** Cuántos saltos van (cambia en cada `seek`: el contador de días se enseña al saltar). */
  seeks: number;
}

/** Una repetición que avanza con el reloj: la principal y, en pantalla partida, la segunda. */
interface Track {
  src: ReplaySource;
  onFeed: (msgs: ServerMessage[], reset: boolean) => void;
  onSpeech: (lines: SimEvent[]) => void;
}

/**
 * Reloj y avance de la repetición: play/pausa, velocidad y saltos. Emite al store los mensajes
 * de `ReplaySource` (`onFeed`) y avisa de las frases nuevas (`onSpeech`, para los subtítulos).
 */
export class ReplayPlayer {
  private t: number;
  private playing = false;
  private speed: ReplaySpeed = 60;
  private realAt = 0;
  private seeks = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private last: number;
  private snapshot: PlayerState;
  private readonly listeners = new Set<() => void>();
  private readonly tracks: Track[];

  constructor(
    private readonly src: ReplaySource,
    onFeed: (msgs: ServerMessage[], reset: boolean) => void,
    onSpeech: (lines: SimEvent[]) => void = () => {},
  ) {
    this.t = src.from;
    this.last = src.from;
    this.snapshot = this.make();
    this.tracks = [{ src, onFeed, onSpeech }];
  }

  /**
   * Otra repetición con el mismo reloj (pantalla partida): se sincroniza por minuto de juego y
   * se pone en el minuto actual.
   */
  follow(src: ReplaySource, onFeed: Track["onFeed"], onSpeech: Track["onSpeech"] = () => {}): void {
    this.tracks.push({ src, onFeed, onSpeech });
    onFeed(src.seek(this.t, this.rate()), true);
  }

  private advanceAll(t: number) {
    for (const k of this.tracks) k.onFeed(k.src.advance(t, this.rate()), false);
  }

  /** Minuto de juego ahora mismo (entre pasos, extrapolado: el mapa anda suave). */
  now(): number {
    if (!this.playing) return this.t;
    const v = this.t + ((performance.now() - this.realAt) / 60_000) * this.speed;
    return Math.min(v, this.src.to);
  }

  get state(): PlayerState {
    return this.snapshot;
  }

  subscribe(l: () => void): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  private make(): PlayerState {
    return { t: this.t, playing: this.playing, speed: this.speed, seeks: this.seeks };
  }

  private emit() {
    this.snapshot = this.make();
    for (const l of this.listeners) l();
  }

  private rate() {
    return this.playing ? this.speed : 0;
  }

  /** Salta a `t` (y lo pinta desde cero). */
  seek(t: number) {
    this.t = Math.min(this.src.to, Math.max(this.src.from, t));
    this.realAt = performance.now();
    this.last = this.t;
    this.seeks++;
    for (const k of this.tracks) k.onFeed(k.src.seek(this.t, this.rate()), true);
    this.emit();
  }

  play() {
    if (this.playing) return;
    if (this.t >= this.src.to) this.seek(this.src.from);
    this.playing = true;
    this.realAt = performance.now();
    this.timer = setInterval(() => this.step(), STEP_MS);
    this.step();
  }

  pause() {
    if (!this.playing) return;
    this.t = this.now();
    this.playing = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.advanceAll(this.t);
    this.emit();
  }

  toggle() {
    if (this.playing) this.pause();
    else this.play();
  }

  setSpeed(speed: ReplaySpeed) {
    this.t = this.now();
    this.realAt = performance.now();
    this.speed = speed;
    this.advanceAll(this.t);
    this.emit();
  }

  /** Un paso: lo que pasó desde el anterior. */
  step() {
    const now = this.now();
    this.advanceAll(now);
    for (const k of this.tracks) {
      const lines = k.src.speechBetween(this.last, now);
      if (lines.length) k.onSpeech(lines);
    }
    this.last = now;
    if (now >= this.src.to) {
      this.t = this.src.to;
      this.pause();
      return;
    }
    this.t = now;
    this.realAt = performance.now();
    this.emit();
  }

  dispose() {
    if (this.timer) clearInterval(this.timer);
    this.listeners.clear();
  }
}
