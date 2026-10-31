/** Factorías del LLM: proveedor, pila compartida y cliente de cada mundo. */
import {
  AnthropicProvider,
  CostTracker,
  LLMClient,
  BatchingProvider,
  MockProvider,
  ModelRouter,
  ResilientProvider,
  isBatchCapable,
  OpenAIProvider,
  agentMockResponder,
  type LLMProvider,
  type PricingTable,
  type TaskRouting,
} from "@lethetown/agent-core";
import { existsSync } from "node:fs";
import { z } from "zod";
import { fromRoot } from "../paths";
import { type AppConfig } from "../config";
import { llmCalls } from "../db/schema";
import { type WorldRow } from "../db/worlds";
import { LimitedProvider } from "../sim/llm-queue";
import { BudgetedProvider } from "../security/budget";
import { readJson } from "./files";
import type { Services } from "./types";

export async function loadPricing(): Promise<PricingTable> {
  const Pricing = z.object({
    models: z.record(
      z.string(),
      z.object({
        input: z.number(),
        output: z.number(),
        cacheRead: z.number(),
        cacheWrite: z.number(),
        cacheWrite1h: z.number().optional(),
      }),
    ),
  });
  return (await readJson(Pricing, "config/pricing.json")).models;
}

/** `config/llm-routing.json`: tipo de modelo y caché por tarea. */
export const LlmRouting = z.object({
  tasks: z
    .record(
      z.string(),
      z
        .object({
          kind: z.enum(["fast", "reflection"]).optional(),
          cacheTtl: z.enum(["5m", "1h"]).optional(),
        })
        .strict(),
    )
    .default({}),
});

/** Lo de `config/llm-routing.json` si existe; si no, lo de siempre (cada tarea pide su modelo). */
export async function loadRouting(): Promise<TaskRouting> {
  const file = "config/llm-routing.json";
  if (!existsSync(fromRoot(file))) return {};
  return (await readJson(LlmRouting, file)).tasks;
}

export function createProvider(config: AppConfig): LLMProvider {
  switch (config.LLM_PROVIDER) {
    case "mock":
      return new MockProvider(agentMockResponder);
    case "anthropic":
      return new AnthropicProvider({ apiKey: config.ANTHROPIC_API_KEY });
    case "openai":
      if (!config.OPENAI_API_KEY)
        throw new Error("LLM_PROVIDER=openai requiere OPENAI_API_KEY en .env");
      return new OpenAIProvider({ apiKey: config.OPENAI_API_KEY });
  }
}

/**
 * Pila del LLM compartida por los mundos del proceso: proveedor → reintentos/breaker → cola de
 * concurrencia con prioridad (conversación y decisiones primero) → (opcional) Batch API, que solo se usa si `setBatchGate` lo permite.
 */
export function createLlmStack(
  config: AppConfig,
  log: (msg: string) => void,
  onQueueWait?: (task: string, ms: number) => void,
) {
  const base = createProvider(config);
  const llmResilience = new ResilientProvider(
    base,
    {
      timeoutMs: config.LLM_TIMEOUT_SECONDS * 1000,
      retries: config.LLM_RETRIES,
      baseDelayMs: 500,
      maxDelayMs: 20_000,
      breakerThreshold: config.LLM_BREAKER_THRESHOLD,
      breakerCooldownMs: config.LLM_BREAKER_COOLDOWN_SECONDS * 1000,
    },
    {
      onRetry: ({ attempt, delayMs, error }) =>
        log(`↻ Reintento ${attempt} del LLM en ${delayMs} ms (${String(error)})`),
      onBreaker: (state) => log(`⚡ Circuit breaker del LLM: ${state}`),
    },
  );
  const llmQueue = new LimitedProvider(llmResilience, config.LLM_CONCURRENCY, onQueueWait);
  let batchGate: () => boolean = () => false;
  let provider: LLMProvider = llmQueue;
  if (config.LLM_BATCH === "on") {
    if (isBatchCapable(base)) {
      provider = new BatchingProvider(
        llmQueue,
        base,
        {
          tasks: config.LLM_BATCH_TASKS,
          windowMs: 5_000,
          pollMs: config.LLM_BATCH_POLL_SECONDS * 1000,
          maxWaitMs: config.LLM_BATCH_MAX_WAIT_MINUTES * 60_000,
          enabled: () => batchGate(),
        },
        (reason) => log(`⚠ Lote del LLM fallido (${reason}); se repite por la vía normal.`),
      );
      log(`Batch API activa para: ${config.LLM_BATCH_TASKS.join(", ")}`);
    } else if (config.LLM_PROVIDER !== "mock") {
      log(`LLM_BATCH=on, pero ${base.name} no admite lotes: se ignora.`);
    }
  }
  return {
    provider,
    llmQueue,
    llmResilience,
    setBatchGate: (gate: () => boolean) => {
      batchGate = gate;
    },
  };
}

/** Cliente LLM de un mundo: presupuesto, costes (en memoria, métricas y llm_calls). */
export function createWorldLlm(services: Services, row: WorldRow, worldLog: (msg: string) => void) {
  const { db } = services;
  const costs = new CostTracker(services.pricing);
  const provider = new BudgetedProvider(services.provider, services.budget, row.id);
  const llm = new LLMClient(provider, new ModelRouter(services.models), costs, services.routing);
  costs.onRecord((r) => {
    services.budget.record(row.id, r.usd);
    services.metrics.recordCost(row.id, r);
  });
  llm.onCall((e) => services.metrics.recordCall(row.id, e));
  if (db) {
    costs.onRecord((r) =>
      services.track(
        db.db
          .insert(llmCalls)
          .values({
            worldId: row.id,
            model: r.model,
            task: r.task,
            agentId: r.agentId ?? null,
            usd: r.usd,
            ...r.usage,
          })
          .catch((e: unknown) => worldLog(`⚠ No se pudo guardar el coste: ${String(e)}`)),
      ),
    );
  }
  return { llm, costs };
}
