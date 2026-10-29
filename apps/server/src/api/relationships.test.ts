/** Endpoints de relaciones: públicos (como el inspector), paginados y con la recíproca. */
import type {
  RelationshipHistoryResponse,
  RelationshipsResponse,
  SocialGraphResponse,
  SocialHistoryResponse,
} from "@lethetown/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootstrap, type App } from "../bootstrap";
import { loadConfig } from "../config";
import { localContext } from "../worlds/local";
import { buildApi, type Api } from "./server";

let app: App;
let api: Api;

beforeAll(async () => {
  app = await bootstrap(
    loadConfig({ LLM_PROVIDER: "mock", EMBEDDINGS: "hash", DATABASE_URL: "", SIM_SEED: "3" }),
    () => {},
  );
  api = await buildApi(localContext(app), app);
});

afterAll(async () => {
  api.ws.close();
  await api.server.close();
  await app.close();
});

const get = async <T>(url: string): Promise<T> => {
  const res = await api.server.inject({ method: "GET", url });
  expect(res.statusCode).toBe(200);
  return res.json() as T;
};

describe("relaciones (REST)", () => {
  it("lista lo que piensa de cada uno, con la recíproca, y a quién no conoce", async () => {
    const r = await get<RelationshipsResponse>("/api/agents/rafael/relationships");
    expect(r.items[0]!.profile.affinity).toBeGreaterThanOrEqual(r.items.at(-1)!.profile.affinity);
    const mateo = r.items.find((i) => i.profile.aboutId === "mateo")!;
    expect(mateo.profile.affinity).toBe(-0.3);
    expect(mateo.reciprocal?.affinity).toBe(-0.1); // no es simétrica
    const marta = r.items.find((i) => i.profile.aboutId === "marta")!;
    expect(marta.name).toBe("Marta Gil");
    expect(r.unknown.map((u) => u.id)).toContain("aurora");
    expect(r.total).toBe(r.items.length);
  });

  it("filtra por tipo, busca sin tildes y pagina", async () => {
    const family = await get<RelationshipsResponse>("/api/agents/marta/relationships?type=family");
    expect(family.items.map((i) => i.profile.aboutId)).toEqual(["leo"]);
    const search = await get<RelationshipsResponse>("/api/agents/rafael/relationships?q=ERNES");
    expect(search.items.map((i) => i.name)).toEqual(["Ernesto Blasco"]);
    const page = await get<RelationshipsResponse>(
      "/api/agents/rafael/relationships?limit=2&offset=1",
    );
    expect(page.items).toHaveLength(2);
    expect(page.offset).toBe(1);
    expect(page.total).toBeGreaterThan(2);
  });

  it("historial de una relación en los dos sentidos, red y su historial", async () => {
    const h = await get<RelationshipHistoryResponse>(
      "/api/agents/tomas/relationships/pilar/history",
    );
    expect(h.changes[0]).toMatchObject({
      reason: "relación de partida",
      relationshipType: "romantic",
    });
    expect(h.reciprocal).toHaveLength(1);
    const g = await get<SocialGraphResponse>("/api/social/graph");
    expect(g.nodes).toHaveLength(20);
    expect(g.profiles.length).toBeGreaterThanOrEqual(58);
    const first = await get<SocialHistoryResponse>("/api/social/history?limit=10");
    expect(first.changes).toHaveLength(10);
    expect(first.next).not.toBeNull();
  });

  it("404 si el agente no existe", async () => {
    const res = await api.server.inject({ method: "GET", url: "/api/agents/nadie/relationships" });
    expect(res.statusCode).toBe(404);
  });
});
