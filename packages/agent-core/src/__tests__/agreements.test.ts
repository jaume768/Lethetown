/** La tarea social devuelve también los acuerdos de la charla (misma llamada, sin llamadas nuevas). */
import { describe, expect, it } from "vitest";
import { agentMockResponder } from "../agent/mock-responder";
import { LLMClient } from "../llm/client";
import { CostTracker } from "../llm/cost-tracker";
import { MockProvider, type MockResponder } from "../llm/mock";
import { ModelRouter } from "../llm/router";
import { InMemorySocialProfileStore, updateSocialAfterConversation } from "../memory/human";

const owner = { agentId: "lucia", agentName: "Lucía", system: "- cafe_ola (cafe): Café La Ola" };

function client(responder: MockResponder) {
  const provider = new MockProvider(responder);
  const llm = new LLMClient(
    provider,
    new ModelRouter({ fast: "mock-fast", reflection: "mock-reflection" }),
    new CostTracker({}),
  );
  return { llm, provider };
}

describe("acuerdos en la tarea social", () => {
  it("los entrega antes que las intenciones y descarta lo que no se entiende", async () => {
    const { llm, provider } = client(() =>
      JSON.stringify({
        summary: "Mateo es majo.",
        intentions: [{ text: "quedar con Mateo", personId: "mateo" }],
        agreements: [
          { type: "meeting", from: "lucia", to: ["mateo"], placeId: "cafe_ola", at: "17:00" },
          "esto no es un acuerdo",
        ],
      }),
    );
    const order: string[] = [];
    await updateSocialAfterConversation(llm, new InMemorySocialProfileStore(), {
      owner,
      other: { id: "mateo", name: "Mateo" },
      transcript: ['Mateo: "Vale, a las cinco en el café."'],
      now: 0,
      context: ["PERSONAS EN LA CHARLA: lucia=Lucía, mateo=Mateo"],
      onAgreements: async (list) => {
        order.push(`acuerdos ${list.map((a) => `${a.type}@${a.placeId}`).join(",")}`);
      },
      onIntentions: async (list) => {
        order.push(`intenciones ${list.length}`);
      },
    });
    expect(order).toEqual(["acuerdos meeting@cafe_ola", "intenciones 1"]);
    // Una sola llamada; el prompt explica los tipos y trae el contexto.
    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0]!.prompt).toContain("agreements");
    expect(provider.calls[0]!.prompt).toContain("· loan:");
    expect(provider.calls[0]!.prompt).toContain("PERSONAS EN LA CHARLA");
  });

  it("mock: «Deberíamos venir juntos» a veces acaba en una cita en el café", async () => {
    const { llm } = client(agentMockResponder);
    const found: string[] = [];
    // La decisión sale de la charla (determinista): alguna variante la cierra.
    for (let n = 0; n < 12 && !found.length; n++) {
      await updateSocialAfterConversation(llm, new InMemorySocialProfileStore(), {
        owner,
        other: { id: "mateo", name: "Mateo" },
        transcript: [`Mateo: "¡Sí! Me encantó. Deberíamos venir juntos." (${n})`],
        now: 0,
        onAgreements: async (list) => {
          found.push(...list.map((a) => `${a.type}:${a.from}>${a.to.join(",")}@${a.placeId}`));
        },
      });
    }
    expect(found).toEqual(["meeting:lucia>mateo@cafe_ola"]);
  });
});
