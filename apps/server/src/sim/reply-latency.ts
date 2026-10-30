import type { SimEvent } from "@lethetown/shared";

/**
 * Latencia de respuesta en las conversaciones: para cada frase dirigida a alguien, cuánto tarda
 * esa persona en decir algo en la misma conversación (minutos de juego y, si se pasa la hora
 * real de cada evento, milisegundos reales). Lo usan `cost:report` y la grabación de partidas.
 */
export interface ReplyLatency {
  minutes: number;
  ms: number | null;
}

/** Id de la conversación de un evento de habla (`<conv>:<turno>`), o null. */
function conversationOf(e: SimEvent): string | null {
  if (e.kind !== "speech") return null;
  const cut = e.id.lastIndexOf(":");
  return cut > 0 ? e.id.slice(0, cut) : null;
}

export class ReplyLatencyMeter {
  /** Por conversación y oyente: cuándo le hablaron (la primera frase sin contestar). */
  private readonly waiting = new Map<string, { time: number; realMs: number | null }>();
  readonly samples: ReplyLatency[] = [];

  add(e: SimEvent, realMs: number | null = null): void {
    const conv = conversationOf(e);
    if (!conv || !e.agentId) return;
    const asked = this.waiting.get(`${conv}>${e.agentId}`);
    if (asked) {
      this.waiting.delete(`${conv}>${e.agentId}`);
      this.samples.push({
        minutes: e.time - asked.time,
        ms: realMs !== null && asked.realMs !== null ? realMs - asked.realMs : null,
      });
    }
    // participants: [hablante, destinatario, …]
    const to = e.participants[1];
    const key = `${conv}>${to}`;
    if (to && !this.waiting.has(key)) this.waiting.set(key, { time: e.time, realMs });
  }

  summary(): { replies: number; meanMinutes: number; p90Minutes: number; meanMs: number | null } {
    const mins = this.samples.map((s) => s.minutes).sort((a, b) => a - b);
    const ms = this.samples.flatMap((s) => (s.ms === null ? [] : [s.ms]));
    const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
    return {
      replies: mins.length,
      meanMinutes: mean(mins),
      p90Minutes: mins.length ? mins[Math.min(mins.length - 1, Math.floor(mins.length * 0.9))]! : 0,
      meanMs: ms.length ? mean(ms) : null,
    };
  }
}
