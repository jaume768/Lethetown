import { DAY_START, SLEEP_START } from "@lethetown/agent-core";
import type { GameClock } from "./clock";
import { CHRONICLE_MINUTE } from "./memory-routines";

/**
 * Noche rápida (SIM_NIGHT_SPEED): cuando todo el pueblo duerme y ya no queda nada de la noche
 * por pedir al LLM (consolidación con sus metas, crónica, resúmenes; también en lote), el reloj
 * pasa al ritmo de la noche. Vuelve a la velocidad elegida `wakeMarginMinutes` antes de la hora
 * de despertar, en cuanto alguien está despierto o hay una conversación, o si empieza una
 * llamada al LLM. Para no oscilar, solo acelera tras `quietMinutes` de juego seguidos sin nada
 * de eso (a x10, 15 min de juego son 90 s reales).
 *
 * Para entrar no puede quedar ninguna llamada en curso. Ya dentro, el mantenimiento horario de
 * la memoria de los que duermen (`BACKGROUND_TASKS`: esencias, resúmenes, confabulación) no la
 * frena: no cambia lo que nadie hará al despertar y, si frenara, la noche se cortaría cada hora
 * (en el mock, unas 115 esencias por noche). Cualquier otra tarea (consolidación, crónica…) sí.
 *
 * La velocidad elegida no cambia (`clock.speed`), solo el ritmo (`clock.rate`): la instantánea,
 * la Batch API (`LLM_BATCH_MAX_SPEED` mira `speed`) y la pausa siguen igual. Mientras se
 * consolida el mundo va a SIM_SPEED, así que los lotes de la consolidación se pueden usar; lo
 * que tarde un lote es noche a x10 (ver docs/decisiones/ritmo.md).
 */
export interface NightSpeedOptions {
  clock: GameClock;
  /** Ritmo de la noche (minutos de juego por minuto real); 0 = desactivada. */
  nightSpeed: number;
  wakeMarginMinutes: number;
  /** Minutos de juego sin nada pendiente antes de acelerar. */
  quietMinutes?: number;
  /** ¿Duerme todo el pueblo (y ha empezado su consolidación)? */
  everyoneAsleep: () => boolean;
  conversations: () => number;
  /** Aviso en la línea de tiempo. */
  notify: (text: string) => void;
}

const NIGHT_QUIET_MINUTES = 15;

/** Mantenimiento de la memoria que no frena una noche rápida ya en marcha. */
const BACKGROUND_TASKS: ReadonlySet<string> = new Set([
  "gist",
  "summarize",
  "confabulate",
  "reconsolidate",
]);

export class NightSpeed {
  private quietSince: number | null = null;
  private wakeCheckAt: number | null = null;
  private readonly quiet: number;
  /** Llamadas al LLM de este mundo en curso (también las que esperan en un lote)… */
  private inFlight = 0;
  /** …y las que no son mantenimiento de fondo. */
  private critical = 0;

  constructor(private readonly o: NightSpeedOptions) {
    this.quiet = o.quietMinutes ?? NIGHT_QUIET_MINUTES;
  }

  get enabled(): boolean {
    return this.o.nightSpeed > 0;
  }

  /** Minuto del día en que se deja de acelerar (el margen antes de despertar). */
  private get wakeFrom(): number {
    return Math.max(0, DAY_START - this.o.wakeMarginMinutes);
  }

  get active(): boolean {
    return this.o.clock.boost !== null;
  }

  /** Por qué no se puede ir a noche rápida ahora (o null si se puede). */
  blockReason(now: number): string | null {
    const { clock } = this.o;
    if (clock.speed === 0) return "el mundo está en pausa";
    if (clock.speed >= this.o.nightSpeed) return "ya va igual de rápido";
    const minute = ((now % 1440) + 1440) % 1440;
    const wakeFrom = this.wakeFrom;
    if (minute >= wakeFrom && minute < SLEEP_START) {
      return minute < DAY_START ? "se acerca la hora de despertar" : "es de día";
    }
    // Entre la hora de dormir y la crónica, la crónica del día aún está pendiente.
    if (minute >= SLEEP_START && minute < CHRONICLE_MINUTE) return "falta la crónica del día";
    if (this.o.conversations() > 0) return "hay una conversación";
    if (!this.o.everyoneAsleep()) return "alguien está despierto";
    if ((this.active ? this.critical : this.inFlight) > 0)
      return "quedan tareas del LLM pendientes";
    return null;
  }

  /** Empieza una llamada al LLM de este mundo: cuenta y, si hace falta, frena. */
  callStarted(task: string): void {
    this.inFlight++;
    if (!BACKGROUND_TASKS.has(task)) this.critical++;
    this.update();
  }

  /** Acaba una llamada: se evalúa antes de descontarla, así la calma empieza ahora. */
  callEnded(task: string): void {
    this.update();
    this.inFlight = Math.max(0, this.inFlight - 1);
    if (!BACKGROUND_TASKS.has(task)) this.critical = Math.max(0, this.critical - 1);
  }

  /** Reevalúa (en cada tick, evento o llamada al LLM). */
  update(): void {
    if (!this.enabled) return;
    const { clock } = this.o;
    const now = clock.now();
    const blocked = this.blockReason(now);
    if (blocked) {
      this.quietSince = now;
      if (this.active) this.slowDown(blocked);
      return;
    }
    if (this.quietSince === null) this.quietSince = now;
    if (!this.active && now - this.quietSince >= this.quiet) this.speedUp(now);
  }

  private speedUp(now: number): void {
    const { clock, nightSpeed, notify } = this.o;
    clock.setBoost(nightSpeed);
    notify(
      `⏩ Noche rápida: todos duermen y no queda nada por pensar; el reloj pasa a x${nightSpeed}`,
    );
    // Revisar justo al llegar el margen antes de despertar (a x360 no hay que pasarse).
    const wakeFrom = this.wakeFrom;
    const day = Math.floor(now / 1440);
    let at = day * 1440 + wakeFrom;
    if (at <= now) at += 1440;
    if (this.wakeCheckAt !== at) {
      this.wakeCheckAt = at;
      clock.schedule(at, () => {
        if (this.wakeCheckAt === at) this.wakeCheckAt = null;
        this.update();
      });
    }
  }

  private slowDown(reason: string): void {
    const { clock, notify } = this.o;
    clock.setBoost(null);
    const after = clock.speed === 0 ? "el reloj se para" : `el reloj vuelve a x${clock.speed}`;
    notify(`▶ Fin de la noche rápida (${reason}): ${after}`);
  }
}
