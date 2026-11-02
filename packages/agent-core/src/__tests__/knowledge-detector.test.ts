/** Detector de conocimiento externo: anacronismos y nombres propios de fuera (sin LLM). */
import { readFileSync } from "node:fs";
import { AgentSeed } from "@lethetown/shared";
import { describe, expect, it } from "vitest";
import { WorldBible } from "../world/bible";
import { KnowledgeDetector, normalizeText } from "../world/knowledge";
import { ExternalKnowledgeGuard, type KnowledgeRecord } from "../world/knowledge-guard";
import { MinorGuard } from "../agent/minor-safety";

const root = (p: string) => new URL(`../../../../${p}`, import.meta.url);
const bible = WorldBible.parse(JSON.parse(readFileSync(root("config/world.json"), "utf8")));
const seeds = AgentSeed.array().parse(JSON.parse(readFileSync(root("seeds/agents.json"), "utf8")));
const seed = (id: string) => seeds.find((s) => s.id === id)!;
const detector = new KnowledgeDetector(bible, {
  neighbors: seeds,
  places: ["Café La Ola", "Biblioteca Mnemósine", "Taberna El Faro", "Lago Leteo"],
});

describe("detector de conocimiento externo", () => {
  it("normaliza sin tildes y conserva la ñ", () => {
    expect(normalizeText("¡Qué Año, señor! E-mail")).toBe("que año señor e mail");
  });

  it("anacronismos: WhatsApp, Instagram, el iPhone; no lo de 2002 (euros, móvil, SMS, internet)", () => {
    const terms = (t: string) => detector.anachronisms(t).map((a) => a.term);
    expect(terms("Te mando un WhatsApp y lo subo a Instagram")).toEqual(["whatsapp", "instagram"]);
    expect(terms("Cuesta 5 euros, mándamelo al móvil por SMS")).toEqual([]);
    expect(terms("Lo miré en internet, en un cibercafé de Palma")).toEqual([]);
    expect(terms("Te llamo desde la cabina y te escribo una carta")).toEqual([]);
    expect(terms("Antes me costaba cien pesetas el carrete")).toEqual([]);
    expect(terms("Lo vi en IB3 con el iphone")).toEqual(["ib3", "iphone"]);
    // Prefijo: "youtube*" cubre "youtuber".
    expect(terms("Quiero ser youtuber")).toEqual(["youtube"]);
  });

  it("nombres propios a media frase, con conectores; la mayúscula de inicio de frase no cuenta", () => {
    expect(detector.properNames("Ayer fui con Mateo a ver el Diario de Mallorca.")).toEqual([
      "Mateo",
      "Diario de Mallorca",
    ]);
    expect(detector.properNames("Hola. Bueno, «Pues» nada")).toEqual([]);
  });

  it("de fuera: lo que no es vecino, lugar, glosario ni referencia común", () => {
    expect(detector.externalNames("Fui a Palma con Lucía y vi a Induráin en la tele")).toEqual([]);
    expect(detector.externalNames("En Lagos decimos que el agua no olvida")).toEqual(["Lagos"]);
    expect(detector.externalNames("Me lo dijo Ronaldo en el Café La Ola")).toEqual(["Ronaldo"]);
  });

  it("según el perfil: Lagos encaja con Samuel, no con Leo", () => {
    const text = "En Lagos decimos que el agua no olvida";
    expect(detector.outsideProfile(text, seed("samuel"))).toEqual([]);
    expect(detector.outsideProfile(text, seed("leo"))).toEqual(["Lagos"]);
  });
});

describe("ExternalKnowledgeGuard", () => {
  const make = (mode: "log" | "enforce") => {
    const records: KnowledgeRecord[] = [];
    const guard = new ExternalKnowledgeGuard({
      detector: new KnowledgeDetector(bible, { neighbors: seeds, places: [] }),
      mode,
      seedOf: (id) => seed(id),
      now: () => 100,
      onRecord: (r) => records.push(r),
    });
    const minor = new MinorGuard({ minors: [] });
    minor.addInspector(guard.inspect);
    return { guard, minor, records };
  };

  it("en modo log registra y deja pasar; lo oído al recordarlo no se registra dos veces", async () => {
    const { minor, records, guard } = make("log");
    expect(
      await minor.allows("Te mando un WhatsApp luego", { kind: "speech", agentId: "leo" }),
    ).toBe(true);
    await minor.allows('Leo me dijo: "Te mando un WhatsApp luego"', {
      kind: "memory",
      agentId: "marta",
      actors: ["marta", "leo"],
    });
    expect(records.map((r) => [r.kind, r.term, r.agentId, r.source])).toEqual([
      ["anachronism", "whatsapp", "leo", "speech"],
    ]);
    expect(guard.stats()).toMatchObject({ anachronism: 1, blocked: 0 });
  });

  it("referencias externas según quien habla; en un recuerdo, lo que va entre comillas no", async () => {
    const { minor, records } = make("log");
    await minor.allows("Mi abuelo vivía en Lagos", { kind: "speech", agentId: "leo" });
    await minor.allows("Mi familia vive en Lagos", { kind: "speech", agentId: "samuel" });
    await minor.allows('Oí a alguien decir: "algo de Kinshasa"', {
      kind: "memory",
      agentId: "elena",
      actors: ["elena"],
    });
    expect(records.map((r) => [r.term, r.agentId])).toEqual([["Lagos", "leo"]]);
  });

  it("en modo enforce descarta los anacronismos (las referencias, no)", async () => {
    const { minor } = make("enforce");
    expect(
      await minor.allows("Te lo mando por WhatsApp", { kind: "speech", agentId: "ines" }),
    ).toBe(false);
    expect(await minor.allows("Mi abuelo vivía en Lagos", { kind: "speech", agentId: "leo" })).toBe(
      true,
    );
  });
});

describe("ruido del registro (corrección 2.5, ejemplos de la partida 2)", () => {
  const make = () => {
    const records: KnowledgeRecord[] = [];
    const guard = new ExternalKnowledgeGuard({
      detector: new KnowledgeDetector(bible, {
        neighbors: seeds,
        places: ["Café La Ola", "Taberna El Faro"],
        vocabulary: seeds.flatMap((s) => [s.description, ...s.initialMemories]),
      }),
      mode: "log",
      seedOf: (id) => seed(id),
      now: () => 0,
      onRecord: (r) => records.push(r),
    });
    return { guard, records };
  };

  it("listas del diario y del plan: tras una coma empieza un elemento", () => {
    const { guard } = make();
    const diary =
      "El día 2: Desayunar en casa, Pintar en el parque, Jugar con Leo, Pasear por el lago, Cenar pronto.";
    expect(guard.detect(diary, { kind: "summary", agentId: "lucia" })).toEqual([]);
    expect(guard.detect(diary, { kind: "plan", agentId: "lucia" })).toEqual([]);
    expect(
      guard.detect("Tomar un café, Volver a casa, Pasear", { kind: "reflection", agentId: "hugo" }),
    ).toEqual([]);
  });

  it("la primera palabra tras el id del destinatario (o los ids de la acción) abre la frase", () => {
    const { guard } = make();
    expect(
      guard.detect("hugo Marchando, que se enfría", { kind: "speech", agentId: "rafael" }),
    ).toEqual([]);
    expect(guard.detect("ernesto Acábate el café", { kind: "speech", agentId: "mateo" })).toEqual(
      [],
    );
    expect(
      guard.detect("ines cafe_ola Tomar algo y charlar", { kind: "action", agentId: "aurora" }),
    ).toEqual([]);
  });

  it("referencias de la época (Oasis, Blur, Nirvana, OT, series y deportes) no son de fuera", () => {
    const { guard } = make();
    for (const t of [
      "Es de Oasis, en plan, flipante.",
      "¿Tú eres más de Blur o de Nirvana?",
      "Anoche vi Expediente X y luego Caiga quien caiga.",
      "Este verano son los Juegos de Atlanta y la Eurocopa.",
    ]) {
      expect(guard.detect(t, { kind: "speech", agentId: "clara" }), t).toEqual([]);
    }
    expect(bible.culturalReferences.every((r) => r.year <= bible.year && r.source)).toBe(true);
  });

  it("la gente de fuera de las semillas existe; los ids de saberes y objetos se saltan", () => {
    const detector = new KnowledgeDetector(bible, {
      neighbors: seeds,
      places: [],
      people: seeds.flatMap((x) => x.offstagePeople.map((p) => p.name)),
    });
    expect(detector.externalNames("Samuel me contó el suero casero de Ngozi")).toEqual([]);
    expect(detector.externalNames("elena l24 Le cuento lo del suero")).toEqual([]);
  });

  it("lo de verdad de fuera se sigue registrando (Lagos en boca de Leo)", () => {
    const { guard } = make();
    expect(
      guard
        .detect("Dicen que en Lagos hace calor", { kind: "speech", agentId: "leo" })
        .map((r) => r.term),
    ).toEqual(["Lagos"]);
  });
});
