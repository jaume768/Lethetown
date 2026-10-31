/** Pestaña «Evolución»: solo admin; métricas por día y cifras vivas de los sistemas. */
import { EvolutionReport } from "@lethetown/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootstrap, type App } from "../bootstrap";
import { loadConfig } from "../config";
import { localContext } from "../worlds/local";
import { buildApi, type Api } from "./server";

const ORIGIN = "http://localhost:5173";
let app: App;
let api: Api;
let cookie = "";

beforeAll(async () => {
  app = await bootstrap(
    loadConfig({
      LLM_PROVIDER: "mock",
      EMBEDDINGS: "hash",
      DATABASE_URL: "",
      SIM_SEED: "3",
      DEV_ADMIN_PASSWORD: "admin-password-123",
    }),
    () => {},
  );
  api = await buildApi(localContext(app), app);
  const w = app.defaultWorld;
  w.start();
  await w.clock.runUntil(w.clock.now() + 4 * 60);
  const res = await api.server.inject({
    method: "POST",
    url: "/api/auth/login",
    headers: { origin: ORIGIN },
    payload: { username: "admin", password: "admin-password-123" },
  });
  cookie = `lt_session=${res.cookies.find((c) => c.name === "lt_session")!.value}`;
}, 60_000);

afterAll(async () => {
  api.ws.close();
  await api.server.close();
  await app.close();
});

describe("GET /api/evolution", () => {
  it("sin sesión de admin, no", async () => {
    const res = await api.server.inject({ method: "GET", url: "/api/evolution" });
    expect(res.statusCode).toBe(401);
  });

  it("con admin: el informe (validado con el esquema de shared), con los sistemas", async () => {
    const res = await api.server.inject({
      method: "GET",
      url: "/api/worlds/default/evolution",
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const report = EvolutionReport.parse(res.json());
    expect(report.days[0]?.day).toBe(0);
    expect(report.total.utterances).toBeGreaterThan(0);
    expect(report.cost.byTask.decide?.calls).toBeGreaterThan(0);
    expect(Object.keys(report.systems ?? {})).toEqual(
      expect.arrayContaining(["meetings", "items", "agreements", "minorGuard"]),
    );
  });
});
