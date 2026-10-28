import { randomUUID } from "node:crypto";
import { eq, lt } from "drizzle-orm";
import pg from "pg";
import type { Db } from "../db/client";
import { busMessages } from "../db/schema";

/** Canales del bus entre el proceso `api` y los `sim-worker`. */
export const CHANNELS = {
  /** worker → api: estado vivo, señales y costes de un mundo. */
  world: "lt_world",
  /** api → worker: órdenes (con respuesta por `reply`). */
  command: "lt_cmd",
  reply: "lt_reply",
  /** api → workers: espectadores por mundo (para pausar o bajar el detalle sin público). */
  viewers: "lt_viewers",
  /** api → workers: kill switch y otros avisos de admin. */
  admin: "lt_admin",
} as const;
export type Channel = (typeof CHANNELS)[keyof typeof CHANNELS];

/** NOTIFY admite ~8000 bytes; por encima, el mensaje va a `bus_messages` y se notifica su id. */
const MAX_NOTIFY_BYTES = 7000;
const RECONNECT_MS = 1000;
const CLEANUP_EVERY_MS = 60_000;
const KEEP_MESSAGES_MS = 120_000;

type Handler = (msg: unknown) => void;

export interface Bus {
  publish(channel: Channel, msg: unknown): Promise<void>;
  subscribe(channel: Channel, handler: Handler): Promise<() => void>;
  /** Publica `msg` con un id y espera la respuesta en `reply` (o falla tras `timeoutMs`). */
  request<T>(channel: Channel, msg: object, timeoutMs: number): Promise<T>;
  /** Responde a una petición recibida (`msg.requestId`). */
  reply(requestId: string, value: unknown): Promise<void>;
  close(): Promise<void>;
}

/**
 * Bus sobre Postgres LISTEN/NOTIFY: una conexión dedicada escucha y las publicaciones van por
 * el pool. Si la conexión de escucha se cae, se reconecta y vuelve a hacer LISTEN.
 * Entrega "como mucho una vez": vale para estado vivo y señales; las órdenes tienen timeout.
 */
export class PgBus implements Bus {
  private listener: pg.Client | null = null;
  private readonly handlers = new Map<string, Set<Handler>>();
  private readonly waiting = new Map<
    string,
    { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }
  >();
  private closed = false;
  private readonly cleanup: NodeJS.Timeout;

  private constructor(
    private readonly url: string,
    private readonly pool: pg.Pool,
    private readonly db: Db,
    private readonly log: (msg: string) => void,
  ) {
    this.cleanup = setInterval(() => {
      void this.db
        .delete(busMessages)
        .where(lt(busMessages.createdAt, new Date(Date.now() - KEEP_MESSAGES_MS)))
        .catch(() => undefined);
    }, CLEANUP_EVERY_MS);
    this.cleanup.unref();
  }

  static async connect(
    url: string,
    pool: pg.Pool,
    db: Db,
    log: (msg: string) => void,
  ): Promise<PgBus> {
    const bus = new PgBus(url, pool, db, log);
    await bus.listen();
    await bus.subscribe(CHANNELS.reply, (m) => bus.onReply(m));
    return bus;
  }

  private async listen(): Promise<void> {
    const client = new pg.Client({ connectionString: this.url });
    client.on("notification", (n) => void this.dispatch(n.channel, n.payload ?? "null"));
    client.on("error", (e) => this.log(`⚠ Bus: error en la conexión de escucha (${e.message})`));
    client.on("end", () => {
      if (this.closed) return;
      this.listener = null;
      setTimeout(() => void this.reconnect(), RECONNECT_MS);
    });
    await client.connect();
    for (const channel of this.handlers.keys()) await client.query(`LISTEN ${channel}`);
    this.listener = client;
  }

  private async reconnect(): Promise<void> {
    try {
      await this.listen();
      this.log("Bus: reconectado");
    } catch {
      setTimeout(() => void this.reconnect(), RECONNECT_MS * 2);
    }
  }

  private async dispatch(channel: string, payload: string): Promise<void> {
    let msg: unknown;
    try {
      msg = JSON.parse(payload);
      const ref = (msg as { $ref?: unknown } | null)?.$ref;
      if (typeof ref === "number") {
        const [row] = await this.db.select().from(busMessages).where(eq(busMessages.id, ref));
        if (!row) return;
        msg = row.payload;
      }
    } catch {
      return;
    }
    for (const h of this.handlers.get(channel) ?? []) {
      try {
        h(msg);
      } catch (e) {
        this.log(`⚠ Bus: error al procesar ${channel}: ${String(e)}`);
      }
    }
  }

  async publish(channel: Channel, msg: unknown): Promise<void> {
    let text = JSON.stringify(msg);
    if (Buffer.byteLength(text) > MAX_NOTIFY_BYTES) {
      const [row] = await this.db
        .insert(busMessages)
        .values({ payload: msg as object })
        .returning({ id: busMessages.id });
      text = JSON.stringify({ $ref: row!.id });
    }
    await this.pool.query("select pg_notify($1, $2)", [channel, text]);
  }

  async subscribe(channel: Channel, handler: Handler): Promise<() => void> {
    let set = this.handlers.get(channel);
    if (!set) {
      set = new Set();
      this.handlers.set(channel, set);
      await this.listener?.query(`LISTEN ${channel}`);
    }
    set.add(handler);
    return () => set.delete(handler);
  }

  request<T>(channel: Channel, msg: object, timeoutMs: number): Promise<T> {
    const requestId = randomUUID();
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiting.delete(requestId);
        reject(new Error("El simulador no respondió a tiempo"));
      }, timeoutMs);
      this.waiting.set(requestId, { resolve: resolve as (v: unknown) => void, reject, timer });
      this.publish(channel, { ...msg, requestId }).catch((e: unknown) => {
        clearTimeout(timer);
        this.waiting.delete(requestId);
        reject(e instanceof Error ? e : new Error(String(e)));
      });
    });
  }

  async reply(requestId: string, value: unknown): Promise<void> {
    await this.publish(CHANNELS.reply, { requestId, value });
  }

  private onReply(m: unknown) {
    const { requestId, value } = (m ?? {}) as { requestId?: string; value?: unknown };
    const w = requestId ? this.waiting.get(requestId) : undefined;
    if (!w) return;
    clearTimeout(w.timer);
    this.waiting.delete(requestId!);
    w.resolve(value);
  }

  async close(): Promise<void> {
    this.closed = true;
    clearInterval(this.cleanup);
    for (const w of this.waiting.values()) {
      clearTimeout(w.timer);
      w.reject(new Error("Bus cerrado"));
    }
    await this.listener?.end().catch(() => undefined);
  }
}
