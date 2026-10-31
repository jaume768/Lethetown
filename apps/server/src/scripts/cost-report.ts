/**
 * Informe de coste en modo texto: avanza el reloj de forma determinista (mock, RAM, embeddings
 * hash, SIM_SEED=7) y escribe una tabla Markdown de llamadas y tokens por tarea, con el coste
 * que tendrían esos tokens a los precios de Haiku 5.5 (fast) y Sonnet 5.5 (reflection) según el
 * enrutado de config/llm-routing.json. Los tokens del mock son aproximados: sirve para comparar
 * etapas, no para presupuestar. Al final, las cifras de cada sistema y de la memoria.
 * Uso: pnpm --filter @lethetown/server cost:report [horas]   (por defecto, 48)
 */
import { CostTracker } from "@lethetown/agent-core";
import { bootstrap } from "../bootstrap";
import { loadConfig } from "../config";
import { ReplyLatencyMeter } from "../sim/reply-latency";

/** A qué modelo real corresponde cada modelo del mock (para estimar el coste). */
const REAL_MODEL: Record<string, string> = {
  "mock-fast": "claude-haiku-5-5",
  "mock-reflection": "claude-sonnet-5-5",
};

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
const replies = new ReplyLatencyMeter();
w.sim.onEvent((e) => replies.add(e));
// Coste estimado: los mismos tokens a precio real, según el modelo que usó cada tarea.
const real = new CostTracker(app.pricing);
w.costs.onRecord((r) => real.record({ ...r, model: REAL_MODEL[r.model] ?? r.model }));
w.start();
await w.clock.runUntil(w.clock.now() + hours * 60);
const { byTask, total } = w.costs.summary();
const usd = real.summary();
const systems = w.sim.systemMetrics();
// Auditoría de la memoria: archivados, olvidos… y acuerdos hablados descartados, por motivo.
const audits = new Map<string, number>();
const discarded = new Map<string, number>();
for (const id of w.sim.agents.keys()) {
  for (const e of await w.memory.store.audit(id, 100_000)) {
    audits.set(e.action, (audits.get(e.action) ?? 0) + 1);
    if (e.action !== "agreement_discarded") continue;
    const reason = e.reason.replace(/\(cita c\d+\)|"[^"]*"/g, "…");
    discarded.set(reason, (discarded.get(reason) ?? 0) + 1);
  }
}
await app.close();

const dollars = (n: number | undefined) => (n ?? 0).toFixed(3);
const row = (name: string, b: typeof total, est: number | undefined) =>
  `| ${name} | ${b.calls} | ${b.inputTokens} | ${b.outputTokens} | ${b.cacheReadTokens} | ${dollars(est)} |`;
console.log(`Coste en mock de ${hours} h de juego (SIM_SEED=${config.SIM_SEED}, 20 agentes)\n`);
console.log(
  "| Tarea | Llamadas | Entrada (no cacheada) | Salida | Lectura de caché | ≈ $ (Haiku/Sonnet) |",
);
console.log("| --- | ---: | ---: | ---: | ---: | ---: |");
for (const [task, b] of Object.entries(byTask).sort((a, b) => b[1].calls - a[1].calls)) {
  console.log(row(task, b, usd.byTask[task]?.usd));
}
console.log(row("**total**", total, usd.total.usd));
const r = replies.summary();
console.log(
  `\nRespuestas en conversación: ${r.replies}; espera media ${r.meanMinutes.toFixed(1)} min de juego (p90 ${r.p90Minutes.toFixed(1)}).`,
);
console.log("\nSistemas al final:");
for (const [id, m] of Object.entries(systems)) {
  const figures = Object.entries(m).map(([k, v]) => `${k} ${v}`);
  console.log(`- ${id}: ${figures.join(", ")}`);
}
console.log(
  `\nMemoria (auditoría): ${[...audits]
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k} ${v}`)
    .join(", ")}`,
);
if (discarded.size) {
  console.log("\nAcuerdos descartados:");
  for (const [reason, n] of [...discarded].sort((a, b) => b[1] - a[1])) {
    console.log(`- ${n} × ${reason}`);
  }
}
