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

export async function createEmbedder(
  config: AppConfig,
  log: (msg: string) => void,
): Promise<Embedder> {
  if (config.EMBEDDINGS === "hash") return new HashEmbedder(EMBEDDING_DIM);
  try {
    log(`Cargando embeddings locales (${config.EMBEDDINGS_MODEL})…`);
    return await LocalEmbedder.create(config.EMBEDDINGS_MODEL);
  } catch (error) {
    log(`⚠ No se pudo cargar el modelo de embeddings (${String(error)}). Uso embeddings hash.`);
    return new HashEmbedder(EMBEDDING_DIM);
  }
}
