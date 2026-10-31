/** Sistema `world`: la biblia en el prompt fijo y la fecha del calendario en el plan. */
import type { RunRequest } from "@lethetown/agent-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootstrap, type App } from "../../bootstrap";
import { loadConfig } from "../../config";
import type { SimContext } from "../context";
import { systemPlanSections } from ".";

let app: App;
let ctx: SimContext;

beforeAll(async () => {
  app = await bootstrap(
    loadConfig({ LLM_PROVIDER: "mock", EMBEDDINGS: "hash", DATABASE_URL: "", SIM_SEED: "7" }),
    () => {},
  );
  ctx = (app.defaultWorld.sim as unknown as { ctx: SimContext }).ctx;
});
afterAll(() => app.close());

describe("sistema world", () => {
  it("el prompt fijo de cada agente lleva la biblia (1996, Mallorca, pesetas) y la regla", () => {
    const system = ctx.agents.get("ines")!.system;
    expect(system).toMatch(/interior de Mallorca; es el año 1996/);
    expect(system).toMatch(/pesetas/);
    expect(system).toMatch(/Sabes lo que sabría alguien con tu vida en 1996/);
    // Igual para todos (cacheable): la parte del mundo no depende del agente.
    const world = (s: string) => s.slice(s.indexOf("- El mundo:"), s.indexOf("- Sabes lo que"));
    expect(world(system)).toBe(world(ctx.agents.get("aurora")!.system));
  });

  it("el plan del día lleva la fecha del calendario", async () => {
    const agent = ctx.agents.get("mateo")!;
    expect(systemPlanSections(ctx, agent, 0)[0]!.lines[0]).toBe(
      "Hoy es lunes, 15 de abril de 1996 (primavera).",
    );
    const prompts: string[] = [];
    const llm = agent.deps.llm;
    const run = llm.run.bind(llm);
    llm.run = (req: RunRequest) => {
      if (req.task === "plan") prompts.push(req.prompt);
      return run(req);
    };
    await agent.planDay(1440 + 7 * 60, "sunny", [], systemPlanSections(ctx, agent, 1440 + 7 * 60));
    llm.run = run;
    expect(prompts[0]).toMatch(/Tiempo esta mañana: soleado\.\nHoy es martes, 16 de abril/);
  });
});
