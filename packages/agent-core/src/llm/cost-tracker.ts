import type { CostBucket, CostSummary, TokenUsage } from "@lethetown/shared";

/** USD por millón de tokens. */
export interface ModelPrice {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  /** Escritura en caché con TTL de 1 h (Anthropic: 2× la entrada; por defecto, eso). */
  cacheWrite1h?: number;
}

export type PricingTable = Record<string, ModelPrice>;

export interface CostRecord {
  model: string;
  task: string;
  agentId?: string;
  usage: TokenUsage;
  usd: number;
}

export type CostSink = (record: CostRecord) => void;

const emptyBucket = (): CostBucket => ({
  calls: 0,
  usd: 0,
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
});

function addTo(bucket: CostBucket, usage: TokenUsage, usd: number): void {
  bucket.calls += 1;
  bucket.usd += usd;
  bucket.inputTokens += usage.inputTokens;
  bucket.outputTokens += usage.outputTokens;
  bucket.cacheReadTokens += usage.cacheReadTokens;
  bucket.cacheWriteTokens += usage.cacheWriteTokens;
}

/**
 * Registra tokens y coste por llamada, agregando por agente, por tarea y por modelo.
 * `usage.inputTokens` es siempre la entrada NO cacheada (los proveedores normalizan).
 */
export class CostTracker {
  private readonly total = emptyBucket();
  private readonly byAgent = new Map<string, CostBucket>();
  private readonly byTask = new Map<string, CostBucket>();
  private readonly byModel = new Map<string, CostBucket>();
  private readonly sinks: CostSink[] = [];
  /** Modelos usados sin precio configurado (se cuentan a 0 $). */
  readonly unpricedModels = new Set<string>();

  constructor(private readonly pricing: PricingTable) {}

  /** `cacheWrite1hTokens`: de los escritos en caché, los de TTL de 1 h (más caros). */
  priceOf(model: string, usage: TokenUsage, cacheWrite1hTokens = 0): number {
    const price = this.pricing[model];
    if (!price) {
      this.unpricedModels.add(model);
      return 0;
    }
    return (
      (usage.inputTokens * price.input +
        usage.outputTokens * price.output +
        usage.cacheReadTokens * price.cacheRead +
        usage.cacheWriteTokens * price.cacheWrite +
        cacheWrite1hTokens * ((price.cacheWrite1h ?? price.input * 2) - price.cacheWrite)) /
      1_000_000
    );
  }

  /** `priceMultiplier`: descuento del proveedor (Batch API = 0.5). */
  record(entry: Omit<CostRecord, "usd">, priceMultiplier = 1, cacheWrite1hTokens = 0): CostRecord {
    const usd = this.priceOf(entry.model, entry.usage, cacheWrite1hTokens) * priceMultiplier;
    const record: CostRecord = { ...entry, usd };
    addTo(this.total, entry.usage, usd);
    addTo(bucketFor(this.byTask, entry.task), entry.usage, usd);
    addTo(bucketFor(this.byModel, entry.model), entry.usage, usd);
    if (entry.agentId) addTo(bucketFor(this.byAgent, entry.agentId), entry.usage, usd);
    for (const sink of this.sinks) sink(record);
    return record;
  }

  onRecord(sink: CostSink): void {
    this.sinks.push(sink);
  }

  summary(): CostSummary {
    return {
      total: { ...this.total },
      byAgent: Object.fromEntries(this.byAgent),
      byTask: Object.fromEntries(this.byTask),
      byModel: Object.fromEntries(this.byModel),
    };
  }
}

function bucketFor(map: Map<string, CostBucket>, key: string): CostBucket {
  let bucket = map.get(key);
  if (!bucket) {
    bucket = emptyBucket();
    map.set(key, bucket);
  }
  return bucket;
}
