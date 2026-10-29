/**
 * Informe de coste en modo texto: avanza el reloj de forma determinista (mock, RAM, embeddings
 * hash, SIM_SEED=7) y escribe una tabla Markdown de llamadas y tokens por tarea.
 * Uso: pnpm --filter @lethetown/server cost:report [horas]   (por defecto, 48)
 */
import { bootstrap } from "../bootstrap";
import { loadConfig } from "../config";

const hours = Number(process.argv.slice(2).find((a) => a !== "--") ?? 48);
const config = loadConfig({
  ...process.env,
  LLM_PROVIDER: "mock",
  EMBEDDINGS: "hash",
  DATABASE_URL: "",
  SIM_SEED: process.env.SIM_SEED || "7",
  SIM_DEMO: "off",
});
const app = await bootstrap(config, () => {});
const w = app.defaultWorld;
w.start();
await w.clock.runUntil(w.clock.now() + hours * 60);
const { byTask, total } = w.costs.summary();
await app.close();

const row = (name: string, b: typeof total) =>
  `| ${name} | ${b.calls} | ${b.inputTokens} | ${b.outputTokens} | ${b.cacheReadTokens} |`;
console.log(`Coste en mock de ${hours} h de juego (SIM_SEED=${config.SIM_SEED}, 20 agentes)\n`);
console.log("| Tarea | Llamadas | Entrada (no cacheada) | Salida | Lectura de caché |");
console.log("| --- | ---: | ---: | ---: | ---: |");
for (const [task, b] of Object.entries(byTask).sort((a, b) => b[1].calls - a[1].calls)) {
  console.log(row(task, b));
}
console.log(row("**total**", total));
