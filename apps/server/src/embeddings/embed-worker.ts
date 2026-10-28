/**
 * Hilo de embeddings: carga el modelo de transformers.js y calcula vectores fuera del hilo
 * principal (ONNX en CPU bloquearía el bucle de eventos de la API y de la simulación).
 * Protocolo: { id, texts } → { id, vectors } | { id, error }.
 */
import { parentPort, workerData } from "node:worker_threads";

type Extractor = (
  texts: string[],
  options: { pooling: "mean"; normalize: boolean },
) => Promise<{ tolist(): number[][] }>;

const { model, cacheDir } = workerData as { model: string; cacheDir: string };
const port = parentPort!;

const ready = (async () => {
  const { pipeline, env } = await import("@huggingface/transformers");
  env.cacheDir = cacheDir;
  return (await pipeline("feature-extraction", model)) as unknown as Extractor;
})();

port.on("message", async (msg: { id: number; texts: string[] }) => {
  try {
    const extractor = await ready;
    const out = await extractor(msg.texts, { pooling: "mean", normalize: true });
    port.postMessage({ id: msg.id, vectors: out.tolist() });
  } catch (error) {
    port.postMessage({ id: msg.id, error: error instanceof Error ? error.message : String(error) });
  }
});
