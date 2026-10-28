/**
 * Entrevistas automáticas (como en Park et al.): hace a cada agente una batería fija de preguntas
 * y guarda las respuestas en interviews/<fecha>-<proveedor>.json. Útil como test de regresión de
 * la memoria: compara dos ficheros tras cambiar parámetros o prompts.
 * Uso: pnpm interview [--advance horas]   (avanza la simulación antes de entrevistar)
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { formatGameTime, interviewAgent } from "@lethetown/agent-core";
import { bootstrap } from "../bootstrap";
import { loadConfig } from "../config";
import { fromRoot } from "../paths";

const advanceArg = process.argv.indexOf("--advance");
const hours = advanceArg > -1 ? Number(process.argv[advanceArg + 1]) : 0;
const config = loadConfig();
const app = await bootstrap(config, (m) => console.log(`[interview] ${m}`));
const w = app.defaultWorld;

if (hours > 0) {
  w.start();
  await w.clock.runUntil(w.clock.now() + hours * 60);
}
const now = w.clock.now();
const result = {
  provider: app.provider.name,
  gameTime: formatGameTime(now),
  createdAt: new Date().toISOString(),
  agents: [] as { id: string; name: string; answers: Awaited<ReturnType<typeof interviewAgent>> }[],
};
for (const agent of w.sim.agents.values()) {
  console.log(`\n=== ${agent.seed.name} ===`);
  const answers = await interviewAgent(agent, w.memory, w.llm, now);
  for (const a of answers) console.log(`[${a.category}] ${a.question}\n  → ${a.answer}`);
  result.agents.push({ id: agent.id, name: agent.seed.name, answers });
}
mkdirSync(fromRoot("interviews"), { recursive: true });
const file = `interviews/${result.createdAt.replace(/[:.]/g, "-")}-${app.provider.name}.json`;
writeFileSync(fromRoot(file), JSON.stringify(result, null, 2) + "\n");
console.log(`\nGuardado en ${file}`);
await app.close();
