/**
 * PersonGuard: ni vecinos ni personas inventados («la Pepa» de la partida 2). Lógica pura sobre
 * las semillas y la biblia reales, y la decisión que se repite una vez con el aviso.
 */
import { readFileSync } from "node:fs";
import { AgentSeed, parseTiledMap } from "@lethetown/shared";
import { describe, expect, it } from "vitest";
import { Agent } from "../agent/agent";
import { MinorGuard, minorsOf } from "../agent/minor-safety";
import { agentMockResponder } from "../agent/mock-responder";
import { identityPrompt, offstageLine } from "../agent/prompts";
import { LLMClient } from "../llm/client";
import { CostTracker } from "../llm/cost-tracker";
import { MockProvider } from "../llm/mock";
import { ModelRouter } from "../llm/router";
import { HashEmbedder } from "../memory/hash-embedder";
import { InMemoryStore } from "../memory/in-memory-store";
import { MemorySystem } from "../memory/memory-system";
import { WorldBible } from "../world/bible";
import { KnowledgeDetector } from "../world/knowledge";
import { PersonGuard, type PersonRecord } from "../world/person-guard";

const root = (p: string) => new URL(`../../../../${p}`, import.meta.url);
const seeds = AgentSeed.array().parse(JSON.parse(readFileSync(root("seeds/agents.json"), "utf8")));
const world = parseTiledMap(JSON.parse(readFileSync(root("seeds/town.tmj"), "utf8")));
const bible = WorldBible.parse(JSON.parse(readFileSync(root("config/world.json"), "utf8")));

function makeGuard(mode: "log" | "enforce" = "enforce") {
  const detector = new KnowledgeDetector(bible, {
    neighbors: seeds,
    places: ["Café La Ola", "Taberna El Faro", "Plaza mayor", "Biblioteca Mnemósine"],
    vocabulary: [
      ...seeds.flatMap((s) => [s.description, ...s.initialMemories]),
      ...bible.everyday,
      ...bible.outside,
      ...bible.culture,
    ],
  });
  const records: PersonRecord[] = [];
  const guard = new PersonGuard({
    neighbors: seeds,
    publicFigures: bible.personGuard.publicFigures,
    known: [
      bible.town,
      bible.city.name,
      ...bible.glossary.map((g) => g.term),
      ...bible.commonReferences,
      "Café La Ola",
      "Taberna El Faro",
    ],
    isCommonWord: (w) => detector.isCommonWord(w),
    mode,
    now: () => 0,
    onRecord: (r) => records.push(r),
  });
  return { guard, records };
}

const speech = (agentId: string, actors: string[] = []) => ({
  kind: "speech" as const,
  agentId,
  actors: [agentId, ...actors],
});

describe("qué es una persona inventada", () => {
  const { guard } = makeGuard();
  const find = (text: string, who = "ernesto", actors: string[] = ["rafael"]) =>
    guard.find(text, speech(who, actors));

  it("la conversación de la Pepa (Ernesto y Rafael en la taberna)", () => {
    expect(
      find(
        "Pues me lo ha dicho la Pepa, que la vio hablar con alguien de Palma en la puerta. Pero no te fíes, ya sabes cómo es.",
      ),
    ).toEqual(["la Pepa"]);
    expect(
      find("Ya, la Pepa y sus historias. Pero algo habrá, ¿no?", "rafael", ["ernesto"]),
    ).toEqual(["la Pepa"]);
    expect(find("Y ni una palabra a la Pepa.", "rafael", ["ernesto"])).toEqual(["la Pepa"]);
  });

  it("nombres de pila, parentescos y tratamientos", () => {
    expect(find("Me lo contó Tolo en el mercado.")).toEqual(["Tolo"]);
    expect(find("Mi primo Biel tiene una barca en Portocolom.")).toEqual(["Mi primo Biel"]);
    expect(find("Fui con don Ramón a misa.")).toEqual(["don Ramón"]);
    expect(find("Se lo di a na Margalida.")).toEqual(["na Margalida"]);
    expect(find("Pepa Bauzà dice que va a llover.")).toEqual(["Pepa Bauzà"]);
    // «Ferrer» es un apellido del pueblo (Lucía Ferrer): solo cuenta el nombre.
    expect(find("Pepa Ferrer dice que va a llover.")).toEqual(["Pepa"]);
  });

  it("no es inventado: vecinos, gente de fuera de quien habla, públicos de la época y lugares", () => {
    expect(find("Ernesto y Rafael hablan de Mateo y de Lucía.")).toEqual([]);
    // Alma existe para Aurora (y para Valentina, su abuela), no para Ernesto.
    expect(guard.find("Mi amiga Alma se fue y nunca volvió.", speech("aurora"))).toEqual([]);
    expect(guard.find("Mi abuela Alma vivió aquí.", speech("valentina"))).toEqual([]);
    expect(find("Dicen que Alma se fue del pueblo.")).toEqual(["Alma"]);
    // Al empezar la frase, «Alma» puede ser la palabra corriente.
    expect(find("Alma de cántaro, eso es lo que es.")).toEqual([]);
    // Lo que se dice a alguien que la conoce: quien lo menciona cuenta.
    expect(guard.find("¿Te acuerdas de Alma?", speech("clara", ["aurora"]))).toEqual([]);
    expect(find("Felipe González ha perdido; ahora manda Aznar.")).toEqual([]);
    expect(find("¿Viste a Induráin en la tele? Y Lola Flores, qué pena.")).toEqual([]);
    expect(find("Fui a Palma y luego a la Plaza mayor; en Son Dureta me atendieron.")).toEqual([]);
    expect(find("¡Jesús! Por San Juan se hace fiesta, y en Sant Antoni también.")).toEqual([]);
    expect(find("Rosa de los vientos, dicen. Gloria bendita.")).toEqual([]);
  });

  it("aprender de otros: quien oye a Aurora hablar de Alma ya la conoce; a la Pepa, nunca", () => {
    const { guard: g } = makeGuard();
    expect(g.find("Dicen que Alma era muy guapa.", speech("samuel"))).toEqual(["Alma"]);
    expect(g.learn("samuel", "aurora", "Alma era mi mejor amiga.")).toEqual(["Alma"]);
    expect(g.find("Dicen que Alma era muy guapa.", speech("samuel"))).toEqual([]);
    expect(g.learn("rafael", "ernesto", "Me lo dijo la Pepa.")).toEqual([]);
    expect(g.acquaintances().samuel).toContain("alma");
  });
});

describe("qué se hace con ella", () => {
  it("enforce: se cambia por «alguien» (con mayúscula si abre la frase) y queda registrada", () => {
    const { guard, records } = makeGuard();
    const ctx = speech("ernesto", ["rafael"]);
    expect(guard.rewriter.rewrite("Pues me lo ha dicho la Pepa, que la vio.", ctx)).toBe(
      "Pues me lo ha dicho alguien, que la vio.",
    );
    expect(guard.rewriter.rewrite("Tolo dice que llueve.", ctx)).toBe("Alguien dice que llueve.");
    expect(records.map((r) => r.outcome)).toEqual(["replaced", "replaced"]);
    expect(guard.stats()).toMatchObject({ detected: 2, replaced: 2 });
  });

  it("una intención que apunta a una persona inexistente se descarta", () => {
    const { guard, records } = makeGuard();
    expect(
      guard.rewriter.rewrite(
        "Quiero preguntar a la Pepa si la han llamado de Promociones Llevant",
        {
          kind: "intention",
          agentId: "ernesto",
        },
      ),
    ).toBeNull();
    expect(records[0]).toMatchObject({ name: "la Pepa", outcome: "dropped" });
  });

  it("log: solo registra", () => {
    const { guard, records } = makeGuard("log");
    const text = "Me lo ha dicho la Pepa.";
    expect(guard.rewriter.rewrite(text, speech("ernesto"))).toBe(text);
    expect(records[0]!.outcome).toBe("logged");
  });

  it("en un recuerdo (MinorGuard.vet) no se guarda el nombre inventado", async () => {
    const { guard } = makeGuard();
    const minors = new MinorGuard({ minors: minorsOf(seeds) });
    minors.addRewriter(guard.rewriter);
    const memory = new MemorySystem({
      store: new InMemoryStore(),
      embedder: new HashEmbedder(),
      rng: () => 0.5,
      guard: minors,
    });
    const rec = await memory.tryRemember(
      {
        agentId: "rafael",
        text: "Ernesto me contó algo de la Pepa en la taberna.",
        type: "observation",
        importance: 5,
      },
      0,
    );
    expect(rec!.text).toBe("Ernesto me contó algo de alguien en la taberna.");
  });
});

describe("las semillas solo nombran a gente que existe", () => {
  it("con su offstagePeople, ningún texto de partida tiene personas inventadas", () => {
    const { guard } = makeGuard();
    for (const s of seeds) {
      const texts = [
        s.description,
        ...s.initialMemories,
        ...s.initialIntentions.map((i) => i.text),
        ...(s.speechStyle?.catchphrases ?? []),
      ];
      for (const t of texts)
        expect(guard.find(t, { kind: "memory", agentId: s.id }), `${s.id}: ${t}`).toEqual([]);
    }
  });

  it("la gente de fuera va al prompt fijo, con la regla de no inventar a nadie", () => {
    const aurora = seeds.find((s) => s.id === "aurora")!;
    const prompt = identityPrompt(aurora, []);
    expect(prompt).toContain(offstageLine(aurora.offstagePeople));
    expect(prompt).toMatch(/Gente de fuera del pueblo que conoces: Alma \(mi amiga de juventud/);
    expect(prompt).toMatch(/Nunca inventes vecinos, familiares ni conocidos/);
  });
});

describe("la decisión se repite una vez con el aviso", () => {
  function setup(replies: string[]) {
    let n = 0;
    const prompts: string[] = [];
    const provider = new MockProvider((req) => {
      if (req.meta.task === "decide") {
        prompts.push(req.prompt);
        return replies[Math.min(n++, replies.length - 1)]!;
      }
      return agentMockResponder(req);
    });
    const llm = new LLMClient(
      provider,
      new ModelRouter({ fast: "mock-fast", reflection: "mock-reflection" }),
      new CostTracker({}),
    );
    const { guard } = makeGuard();
    const minors = new MinorGuard({ minors: minorsOf(seeds) });
    minors.addRewriter(guard.rewriter);
    const memory = new MemorySystem({
      store: new InMemoryStore(),
      embedder: new HashEmbedder(),
      rng: () => 0.5,
      guard: minors,
    });
    const seed = seeds.find((s) => s.id === "ernesto")!;
    const agent = new Agent(seed, {
      llm,
      memory,
      places: world.places,
      names: Object.fromEntries(seeds.map((s) => [s.id, s.name])),
    });
    return { agent, prompts, guard };
  }
  const say = (text: string) =>
    JSON.stringify({
      choice: "act",
      action: { type: "say", to: "rafael", text },
      reason: "contarlo",
    });
  const input = {
    salient: true,
    present: [{ id: "rafael", name: "Rafael Castro", action: "en la barra" }],
    heard: [{ fromId: "rafael", fromName: "Rafael Castro", text: "¿Quién te lo ha dicho?" }],
    conversationWith: "rafael",
    objectStates: [],
    weather: "sunny" as const,
    socialNotes: [],
  };

  it("a la segunda no la inventa: vale lo que dice entonces", async () => {
    const { agent, prompts, guard } = setup([
      say("Me lo ha dicho la Pepa."),
      say("Dicen por ahí que la vieron con uno de Palma."),
    ]);
    const d = await agent.decide(0, input as never);
    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toMatch(/OJO: la Pepa no existe/);
    expect(d).toMatchObject({
      kind: "act",
      action: { text: "Dicen por ahí que la vieron con uno de Palma." },
    });
    expect(guard.stats().retried).toBe(1);
  });

  it("si vuelve a inventarla, se cambia el nombre por «alguien»", async () => {
    const { agent, prompts, guard } = setup([
      say("Me lo ha dicho la Pepa."),
      say("Que sí, que fue la Pepa."),
    ]);
    const d = await agent.decide(0, input as never);
    expect(prompts).toHaveLength(2);
    expect(d).toMatchObject({ kind: "act", action: { text: "Que sí, que fue alguien." } });
    expect(guard.stats()).toMatchObject({ retried: 1, replaced: 1 });
  });

  it("sin personas inventadas, una sola llamada", async () => {
    const { agent, prompts } = setup([say("¿Has visto a Mateo?")]);
    await agent.decide(0, input as never);
    expect(prompts).toHaveLength(1);
  });
});
