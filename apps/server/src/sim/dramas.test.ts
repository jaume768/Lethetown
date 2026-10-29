import { describe, expect, it } from "vitest";
import { SocialProfile, type Drama } from "@lethetown/shared";
import { createServices, openWorld } from "../bootstrap";
import { loadConfig } from "../config";
import { DramaDetector } from "./dramas";

const ctx = {
  now: () => 100,
  name: (id: string) => id.toUpperCase(),
  placeOf: () => "cafe_ola",
};

describe("DramaDetector", () => {
  it("detecta rumores, escuchas y discusiones, y no repite el mismo drama seguido", () => {
    const d = new DramaDetector(ctx);
    const out: Drama[] = [];
    d.onDrama((x) => out.push(x));
    const speech = (text: string, participants: string[]) =>
      d.onEvent({ id: "c1:1", time: 100, agentId: "a", kind: "speech", text, participants });
    speech('a → b: "Hola"', ["a", "b"]); // sin oyentes ni rumor: nada
    speech('a → b: "¿Sabes? Oí a C decir que…"', ["a", "b"]);
    speech('a → b: "¿Sabes? Oí a C decir que…"', ["a", "b"]); // repetido: se ignora
    speech('a → b: "Qué bien"', ["a", "b", "c"]);
    d.onSocial(
      SocialProfile.parse({
        ownerId: "a",
        aboutId: "b",
        summary: "",
        affinity: 0.5,
        trust: 0.5,
        lastUpdated: 0,
      }),
      SocialProfile.parse({
        ownerId: "a",
        aboutId: "b",
        summary: "me mintió",
        affinity: 0.25,
        trust: 0.5,
        lastUpdated: 1,
      }),
    );
    d.onEffect({ kind: "forget", agentId: "a", memoryId: "m", text: "boda", importance: 3 }); // poco importante
    d.onEffect({ kind: "forget", agentId: "a", memoryId: "m", text: "boda", importance: 9 });
    expect(out.map((x) => x.kind)).toEqual(["rumor", "eavesdrop", "argument", "forgetting"]);
    expect(out[0]).toMatchObject({ placeId: "cafe_ola", eventId: "c1:1" });
    expect(out.every((x) => x.score >= 0.5)).toBe(true);
  });

  it("en una simulación de 3 días en mock aparecen dramas", async () => {
    const services = await createServices(
      loadConfig({ LLM_PROVIDER: "mock", EMBEDDINGS: "hash", DATABASE_URL: "", SIM_SEED: "7" }),
      () => {},
    );
    const w = await openWorld(
      services,
      await services.worldRepo.ensureDefault("seeds/town.tmj", 7),
    );
    w.start();
    await w.clock.runUntil(w.clock.now() + 72 * 60);
    const dramas = await w.dramas.recent(200);
    expect(dramas.length).toBeGreaterThan(0);
    expect(new Set(dramas.map((x) => x.kind)).size).toBeGreaterThan(1);
  }, 30_000);
});
