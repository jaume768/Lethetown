import { Worker } from "node:worker_threads";
import { HashEmbedder, type Embedder } from "@lethetown/agent-core";
import type { AppConfig } from "../config";
import { fromRoot } from "../paths";

/** Dimensión de los vectores en la base de datos (all-MiniLM-L6-v2 y bge-small: 384). */
export const EMBEDDING_DIM = 384;

type Extractor = (
  texts: string[],
  options: { pooling: "mean"; normalize: boolean },
) => Promise<{ tolist(): number[][] }>;

/** Embeddings locales con transformers.js (ONNX en CPU). Se descarga el modelo la primera vez. */
export class LocalEmbedder implements Embedder {
  readonly dim = EMBEDDING_DIM;
  readonly name: string;

  private constructor(
    private readonly extractor: Extractor,
    model: string,
  ) {
    this.name = `local:${model}`;
  }

  static async create(model: string): Promise<LocalEmbedder> {
    const { pipeline, env } = await import("@huggingface/transformers");
    env.cacheDir = fromRoot(".cache/transformers");
    const extractor = (await pipeline("feature-extraction", model)) as unknown as Extractor;
    const embedder = new LocalEmbedder(extractor, model);
    const [probe] = await embedder.embed(["prueba"]);
    if (probe?.length !== EMBEDDING_DIM) {
      throw new Error(
        `El modelo ${model} da ${probe?.length} dimensiones; se esperaban ${EMBEDDING_DIM}`,
      );
    }
    return embedder;
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (!texts.length) return [];
    const output = await this.extractor(texts, { pooling: "mean", normalize: true });
    return output.tolist();
  }
}

/**
 * Embeddings locales en un worker_thread: misma salida que `LocalEmbedder`, pero el cálculo no
 * bloquea el hilo principal. Las peticiones se encolan en el hilo y se responden por id.
 */
export class ThreadedEmbedder implements Embedder {
  readonly dim = EMBEDDING_DIM;
  readonly name: string;
  private nextId = 0;
  private readonly pending = new Map<
    number,
    { resolve: (v: number[][]) => void; reject: (e: Error) => void }
  >();

  private constructor(
    private readonly worker: Worker,
    model: string,
  ) {
    this.name = `local:${model} (hilo)`;
    worker.on("message", (msg: { id: number; vectors?: number[][]; error?: string }) => {
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if (!this.pending.size) worker.unref();
      if (msg.error !== undefined) p.reject(new Error(msg.error));
      else p.resolve(msg.vectors ?? []);
    });
    worker.on("error", (error) => {
      for (const p of this.pending.values()) p.reject(error);
      this.pending.clear();
    });
    // Sin peticiones pendientes, el hilo no mantiene vivo el proceso.
    worker.unref();
  }

  static async create(model: string): Promise<ThreadedEmbedder> {
    const url = new URL(
      import.meta.url.endsWith(".ts") ? "./embed-worker.ts" : "./embed-worker.js",
      import.meta.url,
    );
    const worker = new Worker(url, {
      workerData: { model, cacheDir: fromRoot(".cache/transformers") },
      // En desarrollo (tsx) el hilo también necesita poder cargar TypeScript.
      execArgv: url.pathname.endsWith(".ts") ? ["--import", "tsx"] : [],
    });
    const embedder = new ThreadedEmbedder(worker, model);
    const [probe] = await embedder.embed(["prueba"]).catch(async (error: unknown) => {
      await worker.terminate();
      throw error;
    });
    if (probe?.length !== EMBEDDING_DIM) {
      await worker.terminate();
      throw new Error(
        `El modelo ${model} da ${probe?.length} dimensiones; se esperaban ${EMBEDDING_DIM}`,
      );
    }
    return embedder;
  }

  embed(texts: string[]): Promise<number[][]> {
    if (!texts.length) return Promise.resolve([]);
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.ref();
      this.worker.postMessage({ id, texts });
    });
  }

  close(): Promise<number> {
    return this.worker.terminate();
  }
}

export async function createEmbedder(
  config: AppConfig,
  log: (msg: string) => void,
): Promise<Embedder> {
  if (config.EMBEDDINGS === "hash") return new HashEmbedder(EMBEDDING_DIM);
  try {
    log(`Cargando embeddings locales (${config.EMBEDDINGS_MODEL})…`);
    return config.EMBEDDINGS_THREAD === "on"
      ? await ThreadedEmbedder.create(config.EMBEDDINGS_MODEL)
      : await LocalEmbedder.create(config.EMBEDDINGS_MODEL);
  } catch (error) {
    log(`⚠ No se pudo cargar el modelo de embeddings (${String(error)}). Uso embeddings hash.`);
    return new HashEmbedder(EMBEDDING_DIM);
  }
}
