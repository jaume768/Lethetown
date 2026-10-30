import type { CallEvent, CostRecord } from "@lethetown/agent-core";
import pino from "pino";
import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from "prom-client";
import type { AppConfig } from "./config";

/**
 * Logs estructurados (pino, JSON por stdout; nivel con LOG_LEVEL), métricas Prometheus y
 * Sentry opcional (solo si SENTRY_DSN está definida).
 */
export function createLogger(config: AppConfig, name = "lethetown") {
  return pino({ name, level: config.LOG_LEVEL, base: { proc: name } });
}
export type Logger = ReturnType<typeof createLogger>;

export class Metrics {
  readonly registry = new Registry();
  readonly llmCalls = new Counter({
    name: "lethetown_llm_calls_total",
    help: "Llamadas al LLM por mundo, tarea y resultado",
    labelNames: ["world", "task", "outcome"] as const,
    registers: [this.registry],
  });
  readonly llmErrors = new Counter({
    name: "lethetown_llm_errors_total",
    help: "Errores del LLM por mundo y tipo",
    labelNames: ["world", "error"] as const,
    registers: [this.registry],
  });
  readonly llmLatency = new Histogram({
    name: "lethetown_llm_latency_seconds",
    help: "Latencia de las llamadas al LLM (incluye reintentos y cola)",
    labelNames: ["world", "task"] as const,
    buckets: [0.1, 0.25, 0.5, 1, 2, 4, 8, 16, 32, 64],
    registers: [this.registry],
  });
  readonly llmQueueWait = new Histogram({
    name: "lethetown_llm_queue_wait_seconds",
    help: "Espera en la cola del LLM antes de llamar, por tarea (prioridad: conversación primero)",
    labelNames: ["task"] as const,
    buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 4, 8, 16, 32, 64],
    registers: [this.registry],
  });
  readonly llmCost = new Counter({
    name: "lethetown_llm_cost_usd_total",
    help: "Gasto en LLM (USD). Coste por hora: rate(...[1h]) * 3600",
    labelNames: ["world", "model"] as const,
    registers: [this.registry],
  });
  readonly llmTokens = new Counter({
    name: "lethetown_llm_tokens_total",
    help: "Tokens por tipo (input = no cacheados). Cache hit = cache_read / (input + cache_read + cache_write)",
    labelNames: ["world", "kind"] as const,
    registers: [this.registry],
  });
  readonly simTicks = new Counter({
    name: "lethetown_sim_agent_ticks_total",
    help: "Ticks de agente ejecutados (ticks/s: rate(...))",
    labelNames: ["world"] as const,
    registers: [this.registry],
  });
  readonly simEvents = new Counter({
    name: "lethetown_sim_events_total",
    help: "Eventos de la línea de tiempo por mundo y tipo",
    labelNames: ["world", "kind"] as const,
    registers: [this.registry],
  });
  readonly gameTime = new Gauge({
    name: "lethetown_world_game_minutes",
    help: "Tiempo de juego de cada mundo (minutos)",
    labelNames: ["world"] as const,
    registers: [this.registry],
  });
  readonly worldPaused = new Gauge({
    name: "lethetown_world_paused",
    help: "1 si el mundo está en pausa",
    labelNames: ["world", "reason"] as const,
    registers: [this.registry],
  });
  readonly wsClients = new Gauge({
    name: "lethetown_ws_clients",
    help: "Clientes WebSocket conectados por mundo",
    labelNames: ["world"] as const,
    registers: [this.registry],
  });

  constructor(processName: string) {
    this.registry.setDefaultLabels({ proc: processName });
    collectDefaultMetrics({ register: this.registry, prefix: "lethetown_" });
  }

  recordCall(world: string, e: CallEvent) {
    if (e.phase !== "end") return;
    this.llmCalls.inc({ world, task: e.task, outcome: e.ok ? "ok" : "error" });
    if (e.durationMs !== undefined)
      this.llmLatency.observe({ world, task: e.task }, e.durationMs / 1000);
    if (!e.ok) this.llmErrors.inc({ world, error: e.error ?? "Error" });
  }

  recordQueueWait(task: string, ms: number) {
    this.llmQueueWait.observe({ task }, ms / 1000);
  }

  recordCost(world: string, r: CostRecord) {
    this.llmCost.inc({ world, model: r.model }, r.usd);
    this.llmTokens.inc({ world, kind: "input" }, r.usage.inputTokens);
    this.llmTokens.inc({ world, kind: "output" }, r.usage.outputTokens);
    this.llmTokens.inc({ world, kind: "cache_read" }, r.usage.cacheReadTokens);
    this.llmTokens.inc({ world, kind: "cache_write" }, r.usage.cacheWriteTokens);
  }
}

/** Inicializa Sentry si hay DSN (import dinámico: sin DSN no se carga). */
export async function initSentry(config: AppConfig, processName: string): Promise<void> {
  if (!config.SENTRY_DSN) return;
  const Sentry = await import("@sentry/node");
  Sentry.init({
    dsn: config.SENTRY_DSN,
    environment: config.NODE_ENV,
    serverName: processName,
    tracesSampleRate: 0,
    // Nunca mandamos datos de usuario, cookies (sesión), cabeceras ni cuerpos de petición.
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
    },
  });
}
