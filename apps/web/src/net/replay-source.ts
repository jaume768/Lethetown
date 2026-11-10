/**
 * Fuente de la repetición: un paquete (`pnpm replay:pack`) que hace de servidor. Da los mismos
 * mensajes que el WebSocket (`snapshot`, `tick`, `event`, `drama`…) para el mismo reductor de
 * `game-state.ts`, y responde a la API de los paneles en el minuto de la repetición. Puro (sin
 * React ni el store): el reproductor (`ReplayApp`) lo conecta con `startReplay` y `feed`.
 */
import {
  EMPTY_REPLAY_DATA,
  ReplayBundle,
  ReplayViews,
  RUNNING,
  agentsAt,
  expandFrames,
  findMoments,
  gridOf,
  indexTrack,
  lastAtOrBefore,
  momentInputFromBundle,
  topMoments,
  type AgentState,
  type Chronicle,
  type Drama,
  type FullFrame,
  type Moment,
  type MotionContext,
  type ReplayMessage,
  type ServerMessage,
  type SimEvent,
  type Weather,
} from "@lethetown/shared";
import { MAX_DRAMAS, MAX_EVENTS } from "./game-state";

/** Velocidades de la repetición (minutos de juego por minuto real). */
export const REPLAY_SPEEDS = [1, 5, 10, 60, 360] as const;
export type ReplaySpeed = (typeof REPLAY_SPEEDS)[number];
/** Más mensajes que esto de golpe (a x360): solo se emiten los que se verían. */
const BURST = 2000;

/** Lee un paquete (gzip o JSON) y lo valida. Lanza un error legible si no vale. */
export async function decodeBundle(bytes: ArrayBuffer): Promise<ReplayBundle> {
  const head = new Uint8Array(bytes, 0, Math.min(2, bytes.byteLength));
  let text: string;
  if (head[0] === 0x1f && head[1] === 0x8b) {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
    text = await new Response(stream).text();
  } else {
    text = new TextDecoder().decode(bytes);
  }
  const parsed = ReplayBundle.safeParse(JSON.parse(text));
  if (!parsed.success) {
    const v = (JSON.parse(text) as { version?: unknown }).version;
    throw new Error(
      v !== undefined && v !== 1
        ? `Versión de paquete no soportada: ${String(v)}`
        : `Paquete inválido: ${parsed.error.issues[0]?.path.join(".") ?? ""}`,
    );
  }
  return parsed.data;
}

export class ReplaySource {
  readonly frames: FullFrame[];
  readonly views: ReplayViews;
  readonly moments: Moment[];
  readonly names: Map<string, string>;
  readonly events: SimEvent[];
  private readonly motion: MotionContext;
  private readonly eventsById: Map<string, SimEvent>;
  private readonly messages: ReplayMessage[];
  private readonly snapshotWorld: ReplayBundle["world"];
  /** Índice del primer mensaje aún no emitido. */
  private cursor = 0;

  constructor(readonly bundle: ReplayBundle) {
    this.frames = expandFrames(bundle.frames);
    this.messages = [...bundle.messages].sort((a, b) => a.t - b.t);
    this.names = new Map(this.frames[0]!.agents.map((a) => [a.id, a.name]));
    for (const f of this.frames) for (const a of f.agents) this.names.set(a.id, a.name);
    this.events = this.messages.flatMap((m) => (m.msg.type === "event" ? [m.msg.event] : []));
    this.eventsById = new Map(this.events.map((e) => [e.id, e]));
    this.views = new ReplayViews(bundle.data ?? EMPTY_REPLAY_DATA, this.names);
    this.motion = {
      grid: gridOf(bundle.world),
      walkTilesPerMinute: bundle.meta.walkTilesPerMinute,
      track: indexTrack(bundle.track),
      routes: new Map(),
    };
    this.snapshotWorld = bundle.world;
    this.moments = topMoments(findMoments(momentInputFromBundle(bundle)), 300, 40);
  }

  get from(): number {
    return this.bundle.meta.from;
  }
  get to(): number {
    return this.bundle.meta.to;
  }

  agentsAt(t: number): AgentState[] {
    return agentsAt(this.frames, t, this.motion);
  }

  /**
   * Todo lo necesario para ver la partida en `t` desde cero: el estado (snapshot), lo último
   * que pasó (eventos, dramas, crónicas, objetos y tiempo) y deja el cursor en `t`.
   */
  seek(t: number, rate: number): ServerMessage[] {
    const i = lastAtOrBefore(
      this.messages.map((m) => ({ time: m.t })),
      t,
    );
    this.cursor = i + 1;
    const past = this.messages.slice(0, this.cursor).map((m) => m.msg);
    let weather: Weather = "sunny";
    let world: Extract<ServerMessage, { type: "world" }> | null = null;
    const events: ServerMessage[] = [];
    const dramas: ServerMessage[] = [];
    const chronicles = new Map<number, ServerMessage>();
    for (const msg of past) {
      if (msg.type === "world") {
        world = msg;
        weather = msg.weather;
      } else if (msg.type === "event") events.push(msg);
      else if (msg.type === "drama") dramas.push(msg);
      else if (msg.type === "chronicle") chronicles.set(msg.chronicle.day, msg);
    }
    const out: ServerMessage[] = [
      {
        type: "snapshot",
        snapshot: {
          world: this.snapshotWorld,
          clock: this.clock(t, rate),
          agents: this.agentsAt(t),
          provider: "replay",
          weather,
          status: RUNNING,
        },
      },
      ...(world ? [world] : []),
      ...events.slice(-MAX_EVENTS),
      ...dramas.slice(-MAX_DRAMAS),
      ...chronicles.values(),
    ];
    return out;
  }

  /** Lo que pasó desde el último paso hasta `t`, y la posición de todos en `t`. */
  advance(t: number, rate: number): ServerMessage[] {
    const out: ServerMessage[] = [];
    while (this.cursor < this.messages.length && this.messages[this.cursor]!.t <= t) {
      out.push(this.messages[this.cursor++]!.msg);
    }
    // A mucha velocidad pueden pasar miles: el log solo enseña los últimos.
    const trimmed = out.length > BURST ? keepRecent(out) : out;
    trimmed.push({ type: "tick", clock: this.clock(t, rate), agents: this.agentsAt(t) });
    return trimmed;
  }

  /** Frases dichas en (t0, t1]. */
  speechBetween(t0: number, t1: number): SimEvent[] {
    return this.events.filter((e) => e.kind === "speech" && e.time > t0 && e.time <= t1);
  }

  event(id: string): SimEvent | null {
    return this.eventsById.get(id) ?? null;
  }

  private clock(t: number, rate: number) {
    // `speed` es la del juego (x1); `rate`, la de la repetición (0 en pausa).
    return { time: t, speed: 1 as const, rate };
  }

  /** La API de los paneles en `t` (undefined = no existe en la repetición). */
  api(path: string, t: number): unknown {
    const url = new URL(path, "http://replay");
    const q = (k: string) => url.searchParams.get(k);
    const n = (k: string, def: number) => (q(k) !== null ? Number(q(k)) : def);
    const parts = url.pathname
      .replace(/^\/api\//, "")
      .split("/")
      .map(decodeURIComponent);
    const v = this.views;
    const empty = (agentId: string) => ({ agentId, now: t, items: [] });
    if (parts[0] === "agents" && parts[1]) {
      const id = parts[1];
      switch (parts[2]) {
        case "memory":
          return v.agentMemory(id, t, n("limit", 50), n("offset", 0));
        case "relationships":
          return parts[3] && parts[4] === "history"
            ? v.relationshipHistory(id, parts[3], t)
            : v.relationships(id, t, n("limit", 50), n("offset", 0));
        case "goals":
          return v.goals(id, t);
        case "skills":
          return v.skills(id, t);
        // Agenda, inventario y lugares conocidos no se graban: vacíos.
        case "commitments":
        case "inventory":
          return empty(id);
        case "places":
          return { agentId: id, items: [] };
      }
      return undefined;
    }
    switch (parts[0]) {
      case "lore":
        return v.lore(t);
      case "notes":
      case "departures":
        return { now: t, items: [] };
      case "social":
        return parts[1] === "graph"
          ? v.graph(t)
          : parts[1] === "history"
            ? v.socialHistory(t, n("since", 0))
            : undefined;
      case "rashomon":
        return parts[1] ? v.rashomon(parts[1], this.event(parts[1]), t) : undefined;
      case "events": {
        const day = q("day");
        const from = day !== null ? Number(day) * 1440 : n("from", 0);
        const to = Math.min(t, day !== null ? (Number(day) + 1) * 1440 : n("to", t + 1));
        return this.events.filter((e) => e.time >= from && e.time <= to).slice(-n("limit", 500));
      }
      case "chronicles":
        return this.chronicles(t);
      case "dramas":
        return this.dramas(t).slice(0, n("limit", 50));
    }
    return undefined;
  }

  chronicles(t: number): Chronicle[] {
    return this.messages.flatMap((m) =>
      m.t <= t && m.msg.type === "chronicle" ? [m.msg.chronicle] : [],
    );
  }

  dramas(t: number): Drama[] {
    return this.messages
      .flatMap((m) => (m.t <= t && m.msg.type === "drama" ? [m.msg.drama] : []))
      .reverse();
  }
}

/** De muchos mensajes de golpe, los últimos de cada tipo (lo demás no se vería). */
function keepRecent(msgs: ServerMessage[]): ServerMessage[] {
  const events = msgs.filter((m) => m.type === "event").slice(-MAX_EVENTS);
  const dramas = msgs.filter((m) => m.type === "drama").slice(-MAX_DRAMAS);
  // Los efectos de memoria de golpe serían un castillo de fuegos: solo los últimos.
  const effects = msgs.filter((m) => m.type === "memory_effect").slice(-50);
  const keep = new Set<ServerMessage>([...events, ...dramas, ...effects]);
  return msgs.filter(
    (m) =>
      keep.has(m) ||
      m.type === "chronicle" ||
      m.type === "world" ||
      // Todos los «pensando» (cada inicio con su fin).
      m.type === "thinking",
  );
}
