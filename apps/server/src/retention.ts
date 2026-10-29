/**
 * Retención de datos: lo más antiguo de cada tabla se borra o se resume según una política
 * configurable (días de juego o reales). Corre en un intervalo de tiempo real (no en el reloj
 * de juego, para no alterar la simulación) y también sobre los almacenes en RAM.
 *
 * Lo que se conserva basta para el inspector y Rashomon: los recuerdos activos no se tocan
 * nunca (solo los olvidados o archivados), y la última instantánea de cada mundo tampoco.
 */
import { existsSync } from "node:fs";
import { InMemorySocialProfileStore, InMemoryStore } from "@lethetown/agent-core";
import { and, eq, lt, notInArray, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "./db/client";
import {
  busMessages,
  llmCalls,
  memories,
  memoryAudit,
  memoryVersions,
  moderationLog,
  simEvents,
  socialProfileHistory,
  worldSnapshots,
} from "./db/schema";
import { InMemoryEventStore } from "./db/stores";
import { readJson } from "./factories/files";
import { fromRoot } from "./paths";

const MINUTES_PER_DAY = 1440;
const MS_PER_DAY = 86_400_000;

/** Política de una tabla: antigüedad (días de juego o reales) y qué hacer con lo más viejo. */
const policy = <M extends [string, ...string[]]>(
  days: number,
  clock: "game" | "real",
  modes: M,
  mode: M[number],
) =>
  z
    .object({
      /** Días (de juego o reales) que se conservan íntegros. */
      days: z.number().positive().default(days),
      clock: z.enum(["game", "real"]).default(clock),
      /** delete = borrar; summarize = resumir (solo donde tiene sentido). */
      mode: z.enum(modes).default(mode as M[0]),
    })
    .prefault({});

export const RetentionConfig = z.object({
  enabled: z.boolean().default(true),
  /** Cada cuántos minutos reales se ejecuta. */
  everyMinutes: z.number().positive().default(60),
  /** Recuerdos olvidados o archivados (los activos no se tocan). */
  memories: policy(14, "game", ["delete"], "delete"),
  memoryAudit: policy(30, "game", ["delete"], "delete"),
  /** Versiones antiguas (y las de recuerdos que ya no existen). */
  memoryVersions: policy(30, "game", ["delete"], "delete"),
  /** summarize: queda el último cambio de cada pareja y día de juego (la red sigue viéndose). */
  socialHistory: policy(30, "game", ["delete", "summarize"], "summarize"),
  simEvents: policy(14, "game", ["delete"], "delete"),
  /** Tipos de evento que no se borran nunca (las crónicas, p. ej.). */
  keepEventKinds: z.array(z.string()).default(["chronicle"]),
  /**
   * summarize: una fila por día, mundo, modelo y tarea (agent_id = "*"). Al menos dos meses:
   * el presupuesto mensual suma lo del mes en curso.
   */
  llmCalls: policy(62, "real", ["delete", "summarize"], "summarize"),
  moderationLog: policy(90, "real", ["delete"], "delete"),
  busMessages: policy(1, "real", ["delete"], "delete"),
  /** La última instantánea de cada mundo se conserva siempre. */
  worldSnapshots: policy(7, "real", ["delete"], "delete"),
});
export type RetentionConfig = z.infer<typeof RetentionConfig>;

/** Config de retención: valores por defecto + config/retention.json si existe. */
export async function loadRetentionConfig(log: (msg: string) => void): Promise<RetentionConfig> {
  const file = "config/retention.json";
  if (!existsSync(fromRoot(file))) return RetentionConfig.parse({});
  log(`Config de retención: ${file}`);
  return readJson(RetentionConfig, file);
}

export type RetentionReport = Record<string, number>;

/** Límite (minutos de juego o Date) a partir del cual se conserva. */
function cutoff(p: { days: number; clock: "game" | "real" }, gameNow: number, realNow: number) {
  return p.clock === "game"
    ? { game: gameNow - p.days * MINUTES_PER_DAY, real: null }
    : { game: null, real: new Date(realNow - p.days * MS_PER_DAY) };
}

/** Límite en minutos de juego (las tablas de un mundo); con reloj real no se aplica. */
function gameCut(p: { days: number; clock: "game" | "real" }, gameNow: number): number | null {
  return cutoff(p, gameNow, 0).game;
}

/** Poda de un mundo en Postgres. */
export async function pruneWorldPg(
  db: Db,
  worldId: string,
  gameNow: number,
  cfg: RetentionConfig,
  realNow = Date.now(),
): Promise<RetentionReport> {
  const report: RetentionReport = {};
  const inWorld = <T extends { worldId: unknown }>(t: T) => eq(t.worldId as never, worldId);

  const mem = gameCut(cfg.memories, gameNow);
  if (mem !== null) {
    const rows = await db
      .delete(memories)
      .where(
        and(
          inWorld(memories),
          sql`(${memories.status} = 'archived' or ${memories.forgottenAt} is not null)`,
          sql`coalesce(${memories.forgottenAt}, ${memories.createdAt}) < ${mem}`,
        ),
      )
      .returning({ id: memories.id });
    report.memories = rows.length;
  }
  const ver = gameCut(cfg.memoryVersions, gameNow);
  {
    const rows = await db
      .delete(memoryVersions)
      .where(
        and(
          inWorld(memoryVersions),
          sql`(${ver === null ? sql`false` : sql`${memoryVersions.at} < ${ver}`} or not exists (select 1 from ${memories} m where m.id = ${memoryVersions.memoryId}))`,
        ),
      )
      .returning({ id: memoryVersions.id });
    report.memoryVersions = rows.length;
  }
  const aud = gameCut(cfg.memoryAudit, gameNow);
  if (aud !== null) {
    const rows = await db
      .delete(memoryAudit)
      .where(and(inWorld(memoryAudit), lt(memoryAudit.at, aud)))
      .returning({ id: memoryAudit.id });
    report.memoryAudit = rows.length;
  }
  const soc = gameCut(cfg.socialHistory, gameNow);
  if (soc !== null) {
    const h = socialProfileHistory;
    const older = and(inWorld(h), lt(h.at, soc));
    // Resumir: se borra todo lo viejo salvo el último cambio de cada pareja y día de juego.
    const where =
      cfg.socialHistory.mode === "delete"
        ? older
        : and(
            older,
            sql`exists (select 1 from ${h} h2 where h2.world_id = ${h.worldId} and h2.owner_id = ${h.ownerId} and h2.about_id = ${h.aboutId} and floor(h2.at / ${MINUTES_PER_DAY}) = floor(${h.at} / ${MINUTES_PER_DAY}) and (h2.at > ${h.at} or (h2.at = ${h.at} and h2.id > ${h.id})))`,
          );
    const rows = await db.delete(h).where(where).returning({ id: h.id });
    report.socialHistory = rows.length;
  }
  const ev = gameCut(cfg.simEvents, gameNow);
  if (ev !== null) {
    const rows = await db
      .delete(simEvents)
      .where(
        and(
          inWorld(simEvents),
          lt(simEvents.time, ev),
          cfg.keepEventKinds.length ? notInArray(simEvents.kind, cfg.keepEventKinds) : undefined,
        ),
      )
      .returning({ id: simEvents.id });
    report.simEvents = rows.length;
  }
  const snap = cutoff(cfg.worldSnapshots, gameNow, realNow).real;
  if (snap) {
    const latest = db
      .select({ id: sql`max(${worldSnapshots.id})` })
      .from(worldSnapshots)
      .where(inWorld(worldSnapshots));
    const rows = await db
      .delete(worldSnapshots)
      .where(
        and(
          inWorld(worldSnapshots),
          lt(worldSnapshots.createdAt, snap),
          sql`${worldSnapshots.id} <> (${latest})`,
        ),
      )
      .returning({ id: worldSnapshots.id });
    report.worldSnapshots = rows.length;
  }
  return report;
}

/** Poda de las tablas globales (costes, moderación, bus) en Postgres. */
export async function pruneGlobalPg(
  db: Db,
  cfg: RetentionConfig,
  realNow = Date.now(),
): Promise<RetentionReport> {
  const report: RetentionReport = {};
  const calls = cutoff(cfg.llmCalls, 0, realNow).real;
  if (calls) {
    report.llmCalls = await db.transaction(async (tx) => {
      const old = and(lt(llmCalls.at, calls), sql`${llmCalls.agentId} is distinct from '*'`);
      if (cfg.llmCalls.mode === "summarize") {
        // Una fila por día, mundo, modelo y tarea con las sumas (agent_id = "*").
        await tx.execute(sql`
          insert into ${llmCalls} (world_id, at, model, task, agent_id, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, usd)
          select world_id, date_trunc('day', at), model, task, '*', sum(input_tokens), sum(output_tokens), sum(cache_read_tokens), sum(cache_write_tokens), sum(usd)
          from ${llmCalls}
          where at < ${calls} and agent_id is distinct from '*'
          group by world_id, date_trunc('day', at), model, task`);
      }
      const rows = await tx.delete(llmCalls).where(old).returning({ id: llmCalls.id });
      return rows.length;
    });
  }
  const mod = cutoff(cfg.moderationLog, 0, realNow).real;
  if (mod) {
    const rows = await db
      .delete(moderationLog)
      .where(lt(moderationLog.at, mod))
      .returning({ id: moderationLog.id });
    report.moderationLog = rows.length;
  }
  const bus = cutoff(cfg.busMessages, 0, realNow).real;
  if (bus) {
    const rows = await db
      .delete(busMessages)
      .where(lt(busMessages.createdAt, bus))
      .returning({ id: busMessages.id });
    report.busMessages = rows.length;
  }
  return report;
}

/** Almacenes en RAM de un mundo que se pueden podar. */
export interface RamStores {
  memory: unknown;
  social: unknown;
  events: unknown;
}

/** Poda de un mundo en RAM (los mismos criterios, sobre los almacenes en memoria). */
export function pruneWorldRam(
  stores: RamStores,
  gameNow: number,
  cfg: RetentionConfig,
): RetentionReport {
  const report: RetentionReport = {};
  const never = -Infinity;
  if (stores.memory instanceof InMemoryStore) {
    const r = stores.memory.prune({
      memoriesBefore: gameCut(cfg.memories, gameNow) ?? never,
      auditBefore: gameCut(cfg.memoryAudit, gameNow) ?? never,
      versionsBefore: gameCut(cfg.memoryVersions, gameNow) ?? never,
    });
    Object.assign(report, {
      memories: r.memories,
      memoryAudit: r.audit,
      memoryVersions: r.versions,
    });
  }
  const soc = gameCut(cfg.socialHistory, gameNow);
  if (stores.social instanceof InMemorySocialProfileStore && soc !== null) {
    report.socialHistory = stores.social.pruneHistory(
      soc,
      cfg.socialHistory.mode === "delete" ? "delete" : "summarize",
    );
  }
  const ev = gameCut(cfg.simEvents, gameNow);
  if (stores.events instanceof InMemoryEventStore && ev !== null) {
    report.simEvents = stores.events.prune(ev, cfg.keepEventKinds);
  }
  return report;
}

/** Suma informes (para el log). */
export function describeReport(r: RetentionReport): string {
  const parts = Object.entries(r).filter(([, n]) => n > 0);
  return parts.length ? parts.map(([k, n]) => `${k} ${n}`).join(", ") : "nada";
}
