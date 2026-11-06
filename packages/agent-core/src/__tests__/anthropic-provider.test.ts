/** Proveedor de Anthropic: el fallback del lado servidor va en la llamada directa, no en un lote. */
import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { AgentSeed, parseTiledMap } from "@lethetown/shared";
import { identityPrompt } from "../agent/prompts";
import { AnthropicProvider, splitSystem } from "../llm/anthropic";
import type { CompletionRequest } from "../llm/types";

const message = {
  id: "m",
  type: "message",
  role: "assistant",
  model: "claude-sonnet-5-5",
  content: [{ type: "text", text: "{}" }],
  stop_reason: "end_turn",
  usage: {
    input_tokens: 1,
    output_tokens: 1,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
  },
};

function fakeClient() {
  const calls: { create: unknown[]; batch: unknown[] } = { create: [], batch: [] };
  const client = {
    beta: {
      messages: {
        create: async (body: unknown) => {
          calls.create.push(body);
          return message;
        },
        batches: {
          create: async (body: unknown) => {
            calls.batch.push(body);
            return { id: "b1" };
          },
          retrieve: async () => ({ processing_status: "ended" }),
          cancel: async () => ({}),
          results: async () =>
            (async function* () {
              yield { custom_id: "r0", result: { type: "succeeded", message } };
            })(),
        },
      },
    },
  };
  return { client: client as unknown as Anthropic, calls };
}

const req = {
  model: "claude-sonnet-5-5",
  system: "s",
  prompt: "p",
  maxTokens: 100,
  effort: "low",
  meta: { task: "consolidate" },
} as unknown as CompletionRequest;

describe("AnthropicProvider", () => {
  it("la llamada directa a Sonnet lleva el fallback y su beta", async () => {
    const { client, calls } = fakeClient();
    await new AnthropicProvider({ client }).complete(req);
    expect(calls.create[0]).toMatchObject({
      fallbacks: "default",
      betas: ["server-side-fallback-2026-07-01"],
    });
  });

  it("un lote va sin fallback ni su beta (la Batch API los rechaza) y cobra la mitad", async () => {
    const { client, calls } = fakeClient();
    const signal = new AbortController().signal;
    const [r] = await new AnthropicProvider({ client }).submitBatch([req], { pollMs: 1, signal });
    const body = calls.batch[0] as { requests: { params: object }[]; betas?: unknown };
    expect(body.betas).toBeUndefined();
    expect(body.requests[0]!.params).not.toHaveProperty("fallbacks");
    expect(r).toMatchObject({ text: "{}", priceMultiplier: 0.5 });
  });
});

describe("caché del prefijo común (corrección 3.5)", () => {
  const root = (f: string) => new URL(`../../../../${f}`, import.meta.url);
  const seeds = AgentSeed.array().parse(
    JSON.parse(readFileSync(root("seeds/agents.json"), "utf8")),
  );
  const places = parseTiledMap(JSON.parse(readFileSync(root("seeds/town.tmj"), "utf8"))).places;
  const rules = ["Estás en Mallorca, en 2002 (regla fija de la biblia)."];
  const systemOf = (id: string) => {
    const seed = seeds.find((x) => x.id === id)!;
    return identityPrompt(seed, places.slice(0, 3), "es", [], rules);
  };

  it("lo común a todos va primero y es idéntico byte a byte entre vecinos", () => {
    const [sharedA, ownA] = splitSystem(systemOf("mateo"));
    const [sharedB, ownB] = splitSystem(systemOf("ines"));
    expect(sharedA).toBe(sharedB);
    expect(sharedA).toContain("## Acciones");
    expect(sharedA).toContain("## Reglas");
    expect(sharedA).toContain(rules[0]);
    expect(sharedA).not.toContain("Mateo");
    expect(ownA).toMatch(/^## Quién eres\nEres Mateo Ruiz, 34 años/);
    expect(ownA).toContain("## Lugares que conoces");
    expect(ownB).not.toBe(ownA);
    // Juntos son el texto de siempre.
    expect(`${sharedA}${ownA}`).toBe(systemOf("mateo"));
  });

  it("la petición lleva dos bloques de system, cada uno con su cache_control y el mismo TTL", async () => {
    const { client, calls } = fakeClient();
    await new AnthropicProvider({ client }).complete({
      ...req,
      system: systemOf("mateo"),
      cacheTtl: "1h",
    });
    const body = calls.create[0] as { system: { text: string; cache_control: unknown }[] };
    expect(body.system).toHaveLength(2);
    for (const b of body.system) {
      expect(b.cache_control).toEqual({ type: "ephemeral", ttl: "1h" });
    }
    // Sin el encabezado de identidad (la crónica, la moderación), un solo bloque.
    await new AnthropicProvider({ client }).complete(req);
    expect((calls.create[1] as { system: unknown[] }).system).toHaveLength(1);
  });
});
