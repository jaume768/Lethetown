import { eq, gte, sql } from "drizzle-orm";
import type { Services } from "../bootstrap";
import type { Db } from "../db/client";
import { llmCalls, settings } from "../db/schema";
import { periodStarts, type Spent } from "../security/budget";

const KILL_KEY = "kill_switch";

/** Gasto de hoy y de este mes (UTC) por mundo y total, según llm_calls. */
export async function budgetTotals(
  db: Db,
): Promise<{ global: Spent; worlds: Record<string, Spent> }> {
  const { day, month } = periodStarts(new Date());
  const rows = await db
    .select({
      worldId: llmCalls.worldId,
      day: sql<number>`coalesce(sum(${llmCalls.usd}) filter (where ${llmCalls.at} >= ${day}), 0)`,
      month: sql<number>`coalesce(sum(${llmCalls.usd}), 0)`,
    })
    .from(llmCalls)
    .where(gte(llmCalls.at, month))
    .groupBy(llmCalls.worldId);
  const worlds: Record<string, Spent> = {};
  const global: Spent = { day: 0, month: 0 };
  for (const r of rows) {
    worlds[r.worldId] = { day: Number(r.day), month: Number(r.month) };
    global.day += Number(r.day);
    global.month += Number(r.month);
  }
  return { global, worlds };
}

/**
 * Con varios workers, cada uno solo suma en memoria lo suyo: cada poco se recargan los totales
 * de la BD (donde escriben todos) para que el límite global cuente el gasto de todos.
 */
export async function refreshBudget(services: Services): Promise<void> {
  if (!services.db) return;
  await services.flush();
  services.budget.load(await budgetTotals(services.db.db));
}

export async function loadKillSwitch(db: Db): Promise<boolean> {
  const [row] = await db.select().from(settings).where(eq(settings.key, KILL_KEY));
  return (row?.value as { on?: boolean } | undefined)?.on === true;
}

export async function saveKillSwitch(db: Db, on: boolean): Promise<void> {
  await db
    .insert(settings)
    .values({ key: KILL_KEY, value: { on } })
    .onConflictDoUpdate({ target: settings.key, set: { value: { on }, updatedAt: new Date() } });
}
