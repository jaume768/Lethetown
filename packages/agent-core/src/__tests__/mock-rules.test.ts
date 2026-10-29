import { describe, expect, it } from "vitest";
import {
  agentMockResponder,
  decideContext,
  decideRules,
  registerDecideRule,
  type DecideCtx,
} from "../agent/mock-responder";
import type { CompletionRequest } from "../llm/types";

const SYSTEM = `Eres Lucía Ferrer, 28 años, habitante de un pequeño pueblo.
Personalidad: necesitas ratos a solas.
Cómo hablas: cálido; frases normales; muletillas: «no sé, igual…».
Tu casa: casa_azul

## Lugares del pueblo (id (tipo): nombre · objetos: id[pose])
- casa_azul (home): Casa azul · objetos: cama_azul[sleep]
- cafe_ola (cafe): Café La Ola · objetos: barra[sit], cafetera[use]
- plaza (plaza, exterior): Plaza Mayor · objetos: banco[sit]`;

function req(prompt: string): CompletionRequest {
  return {
    system: SYSTEM,
    prompt,
    model: "mock-fast",
    maxTokens: 500,
    effort: "low",
    meta: { task: "decide" },
  };
}

const base = (extra: string) => `TAREA: decide
Es día 1, 09:00. Estás en cafe_ola haciendo: tomar un café. Tiempo: soleado; estás bajo techo.
Ánimo: contento (activación media). Energía 0.80, hambre 0.30, social 0.50.
Tu plan ahora: tomar un café en cafe_ola (desde 08:00, 60 min)
${extra}`;

/** Contexto con el "azar" fijado. */
const ctx = (prompt: string, h: number): DecideCtx => ({ ...decideContext(req(base(prompt))), h });
const rule = (name: string) => decideRules().find((r) => r.name === name)!;

describe("mock declarativo: reglas de decisión", () => {
  it("están registradas en orden", () => {
    expect(decideRules().map((r) => r.name)).toEqual([
      "remembered",
      "repair-object",
      "broken-object",
      "inner-voice",
      "shelter",
      "plan-clash",
      "no-mood",
      "answer-invitation",
      "return-item",
      "answer-invite",
      "reply",
      "chime-in",
      "spread-rumor",
      "confide",
      "follow-idea",
      "propose-meeting",
      "lend-item",
      "invite",
      "follow",
      "greet",
      "cancel-meeting",
      "explore",
      "take-own-item",
      "use-appliance",
      "post-note",
      "ponder",
    ]);
  });

  it("recordar una intención con la persona delante: se lo dice", () => {
    const c = ctx(
      "PRESENTES: carmen=Carmen Vidal (leyendo)\nMemoria de trabajo:\n- Te acuerdas de que querías devolver el libro (ahí está Carmen Vidal).",
      1,
    );
    expect(rule("remembered").respond(c)?.response).toEqual({
      choice: "talk",
      to: "carmen",
      say: "¡Ay, por cierto! Tenía que devolver el libro.",
    });
  });

  it("un objeto roto: va a mirarlo (solo con h par)", () => {
    const c = ctx("OBJETOS: cafetera: rota\nPRESENTES: nadie", 2);
    expect(rule("broken-object").respond(c)?.response).toMatchObject({
      action: "mirar qué le pasa a cafetera",
    });
    expect(rule("broken-object").respond({ ...c, h: 1 })).toBeNull();
  });

  it("voz interior: va al sitio que nombra, o la ignora con h múltiplo de 3", () => {
    const c = ctx(
      "PRESENTES: nadie\nVOZ INTERIOR (lo acabas de pensar tú):\n- ⟦Me apetece ir a Plaza Mayor⟧",
      1,
    );
    expect(rule("inner-voice").respond(c)?.response).toMatchObject({ placeId: "plaza" });
    expect(rule("inner-voice").respond({ ...c, h: 3 })?.response).toEqual({ choice: "continue" });
  });

  it("contestar, no tener ganas o llevar la contraria según la personalidad", () => {
    const heard = 'PRESENTES: mateo=Mateo Ruiz (charlando)\nHABLAN:\nmateo=Mateo Ruiz: "Hola"';
    expect(rule("reply").respond(ctx(heard, 1))?.response).toMatchObject({ to: "mateo" });
    expect(rule("reply").respond(ctx(heard, 3))).toBeNull();
    // Introvertida con la social cubierta (0.80 > 0.7): no le apetece.
    const full = ctx(heard.replace("", ""), 1);
    expect(rule("no-mood").respond({ ...full, social: 0.8 })?.response).toEqual({
      choice: "continue",
    });
  });

  it("su muletilla sale a veces (según el hash del prompt)", () => {
    const real = (n: number) =>
      decideContext(req(base(`PRESENTES: mateo=Mateo Ruiz (charlando ${n})`)));
    const c = [...Array(30).keys()].map(real).find((x) => x.h % 3 === 0)!;
    expect(c.styled("Hola")).toBe("No sé, igual… Hola");
    const other = [...Array(30).keys()].map(real).find((x) => x.h % 3 !== 0)!;
    expect(other.styled("Hola")).toBe("Hola");
  });

  it("si ninguna regla responde, sigue con su plan; la intención de la voz va siempre", () => {
    const out = JSON.parse(
      agentMockResponder(
        req(
          base(
            "PRESENTES: nadie\nVOZ INTERIOR (lo acabas de pensar tú):\n- ⟦Debería llamar a mi madre⟧",
          ),
        ),
      ),
    );
    expect(out.intention).toEqual({ text: "llamar a mi madre" });
    expect(out.reason).toBeTruthy();
  });

  it("explorar: solo si se le ofrece, está solo y hace buen tiempo (curiosos, más a menudo)", () => {
    const offer = "\n- explore {}: sales a explorar.\nPRESENTES: nadie";
    expect(rule("explore").respond(ctx(offer, 47))?.response).toMatchObject({
      choice: "act",
      action: { type: "explore" },
    });
    expect(rule("explore").respond(ctx(offer, 11))).toBeNull();
    expect(rule("explore").respond(ctx("PRESENTES: nadie", 47))).toBeNull();
    // Los lugares descubiertos (prompt de usuario) también cuentan como conocidos.
    const found = decideContext(
      req(base("LUGARES QUE HAS DESCUBIERTO:\n- biblioteca (other): Biblioteca Mnemósine")),
    );
    expect(found.places.map((p) => p.id)).toContain("biblioteca");
  });

  it("en un grupo, lo que se dice a otro no pide respuesta, pero a veces mete baza", () => {
    const group =
      '\n- say {}: dices algo.\nPRESENTES: mateo=Mateo (charlando); carmen=Carmen (charlando)\nHABLAN:\nmateo=Mateo (a Carmen): "¿Viste la lluvia?"';
    const c = ctx(group, 15);
    expect(c.speaker).toBeUndefined();
    expect(c.heard).toEqual([{ from: "mateo", text: "¿Viste la lluvia?", to: "Carmen" }]);
    expect(rule("chime-in").respond(c)?.response).toMatchObject({
      action: { type: "say", to: "mateo" },
    });
    expect(rule("chime-in").respond(ctx(group, 16))).toBeNull();
  });

  it("objetos: devolver lo prestado, arreglar lo roto y recoger lo suyo", () => {
    const lines = [
      "- return_item {}: devuelves algo.",
      "- use_object {}: usas algo.",
      "- take_item {}: coges algo.",
      "LLEVAS:",
      "- i1 libro de poemas (de Carmen; te lo prestó: devuélveselo antes del día 1)",
      "PUEDES USAR:",
      "- cafetera: arreglar (intentar arreglarlo)",
      "AQUÍ HAY:",
      "- i4 paraguas negro (tuyo)",
      "PRESENTES: carmen=Carmen (leyendo)",
    ].join("\n");
    expect(rule("return-item").respond(ctx(`\n${lines}`, 4))?.response).toMatchObject({
      action: { type: "return_item", itemId: "i1" },
    });
    expect(rule("repair-object").respond(ctx(`\n${lines}`, 4))?.response).toMatchObject({
      action: { type: "use_object", objectId: "cafetera", verb: "arreglar" },
    });
    expect(rule("take-own-item").respond(ctx(`\n${lines}`, 4))?.response).toMatchObject({
      action: { type: "take_item", itemId: "i4" },
    });
  });

  it("invitaciones: casi siempre acepta (lee la sección INVITACIONES)", () => {
    const p = [
      "",
      "- accept_invite {}: aceptas.",
      "- decline_invite {}: rechazas.",
      "INVITACIONES:",
      "- Invitación v2: Mateo Ruiz te invita a ir ahora a Plaza Mayor (plaza) a pasear. Responde con accept_invite o decline_invite.",
    ].join("\n");
    expect(rule("answer-invite").respond(ctx(p, 1))?.response).toMatchObject({
      action: { type: "accept_invite", inviteId: "v2" },
    });
    expect(rule("answer-invite").respond(ctx(p, 5))?.response).toMatchObject({
      action: { type: "decline_invite", inviteId: "v2" },
    });
  });

  it("una acción nueva añade su regla donde quiere (y se puede sustituir)", () => {
    registerDecideRule({ name: "test-first", respond: () => null }, { before: "remembered" });
    expect(decideRules()[0]!.name).toBe("test-first");
    registerDecideRule({
      name: "test-first",
      respond: () => ({ response: { choice: "continue" }, reason: "x" }),
    });
    expect(decideRules()[0]!.respond(ctx("PRESENTES: nadie", 1))?.reason).toBe("x");
    // Se quita para no afectar a otros tests.
    registerDecideRule({ name: "test-first", respond: () => null });
  });
});
