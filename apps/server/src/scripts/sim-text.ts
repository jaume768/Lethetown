/**
 * Simulación en modo texto, sin servidor ni temporizadores: avanza el reloj de forma
 * determinista e imprime los eventos. Uso: pnpm --filter @lethetown/server sim:text [horas]
 */
import { formatGameTime } from "@lethetown/agent-core";
import { bootstrap } from "../bootstrap";
import { loadConfig } from "../config";
import { formatEvent } from "../log";

const hours = Number(process.argv[2] ?? 16);
const config = loadConfig();
const app = await bootstrap(config, (m) => console.log(`[lethetown] ${m}`));
const w = app.defaultWorld;
w.sim.onEvent((e) => console.log(formatEvent(e)));
w.start();

const start = w.clock.now();
await w.clock.runUntil(start + hours * 60);

const costs = w.costs.summary();
console.log(`\n— Fin: ${formatGameTime(w.clock.now())} —`);
console.log(
  `Llamadas LLM: ${costs.total.calls} · tokens in/out/caché: ${costs.total.inputTokens}/${costs.total.outputTokens}/${costs.total.cacheReadTokens} · coste $${costs.total.usd.toFixed(4)}`,
);
for (const [task, b] of Object.entries(costs.byTask)) {
  console.log(`  ${task}: ${b.calls} llamadas, $${b.usd.toFixed(4)}`);
}
await app.close();
