import { describe, expect, it } from "vitest";
import { lowerFirst } from "../text/case";

describe("lowerFirst (etiquetas metidas a media frase)", () => {
  it("baja la primera letra de una actividad", () => {
    expect(lowerFirst("Desayunar en casa")).toBe("desayunar en casa");
    expect(lowerFirst("Jugar al fútbol en la plaza")).toBe("jugar al fútbol en la plaza");
    expect(lowerFirst("Ésta es otra")).toBe("ésta es otra");
  });
  it("respeta siglas, nombres propios y lo que ya va en minúscula", () => {
    expect(lowerFirst("BUP por la tarde")).toBe("BUP por la tarde");
    expect(lowerFirst("Mateo y yo, al café", new Set(["Mateo"]))).toBe("Mateo y yo, al café");
    expect(lowerFirst("leer")).toBe("leer");
    expect(lowerFirst("")).toBe("");
    expect(lowerFirst("¡Hola!")).toBe("¡Hola!");
  });
});
