/**
 * Prueba corta en tiempo real: arranca el mundo en RAM (embeddings hash, SIM_SEED=7) con el
 * proveedor de .env, lo deja correr unos minutos reales a la velocidad indicada y mide cuánto
 * tarda cada respuesta en una conversación (ms reales y minutos de juego), y la espera en cola
 * del LLM por tarea. Con LLM_PROVIDER=anthropic gasta de verdad.
 * Uso: pnpm --filter @lethetown/server latency:probe [minutos reales] [velocidad]
 *      (por defecto, 8 minutos a x10)
 */
import { bootstrap } from "../bootstrap";
import { loadConfig } from "../config";
import { ReplyLatencyMeter } from "../sim/reply-latency";

const [minutes = 8, speed = 10] = process.argv
  .slice(2)
  .filter((a) => a !== "--")
  .map(Number);
const config = loadConfig({
  ...process.env,
  DATABASE_URL: "",
  EMBEDDINGS: "hash",
  SIM_SEED: process.env.SIM_SEED || "7",
  SIM_SPEED: String(speed),
  SIM_DEMO: "off",
  NO_VIEWERS_MODE: "off",
});
const app = await bootstrap(config, () => {});
const w = app.defaultWorld;
const replies = new ReplyLatencyMeter();
let speech = 0;
w.sim.onEvent((e) => {
  if (e.kind === "speech") speech++;
  replies.add(e, Date.now());
});
const t0 = w.clock.now();
w.start();
w.clock.start();
await new Promise((r) => setTimeout(r, minutes * 60_000));
w.clock.stop();
const r = replies.summary();
const costs = w.costs.summary().total;
const waits = app.llmQueue.waitStats();
console.log(
  `Proveedor ${app.provider.name}, x${speed}, ${minutes} min reales (${Math.round(w.clock.now() - t0)} min de juego)`,
);
console.log(`Frases: ${speech}; respuestas: ${r.replies}`);
console.log(
  `Espera entre mensajes: media ${r.meanMs === null ? "-" : (r.meanMs / 1000).toFixed(1)} s reales, ${r.meanMinutes.toFixed(1)} min de juego (p90 ${r.p90Minutes.toFixed(1)})`,
);
console.log(`Llamadas al LLM: ${costs.calls}; coste $${costs.usd.toFixed(3)}`);
for (const [task, x] of Object.entries(waits).sort((a, b) => b[1].calls - a[1].calls)) {
  console.log(
    `  cola ${task}: ${x.calls} llamadas, espera media ${(x.totalMs / x.calls / 1000).toFixed(2)} s, máx ${(x.maxMs / 1000).toFixed(1)} s`,
  );
}
// Caché de prompts por tarea (corrección 3.5: el prefijo común a todos los vecinos se lee de la
// caché entre agentes; con el mock no se mide).
for (const [task, b] of Object.entries(w.costs.summary().byTask).sort(
  (x, y) => y[1].calls - x[1].calls,
)) {
  const total = b.inputTokens + b.cacheReadTokens;
  const pct = total ? Math.round((100 * b.cacheReadTokens) / total) : 0;
  console.log(
    `  caché ${task}: ${b.calls} llamadas, ${b.cacheReadTokens} tokens leídos de la caché (${pct} % de la entrada), ${Math.round(b.cacheReadTokens / Math.max(1, b.calls))} por llamada`,
  );
}
await app.close();
process.exit(0);
