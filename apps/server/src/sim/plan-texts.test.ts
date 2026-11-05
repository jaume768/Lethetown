import { describe, expect, it } from "vitest";
import { outdoorPlanText, planClashText } from "./plan-texts";

describe("avisos del plan: la actividad, en minúscula a media frase", () => {
  it("«Según tu plan ahora toca …»", () => {
    expect(planClashText("Desayunar con Inés", "Casa amarilla", "Mateo Ruiz")).toBe(
      "Según tu plan ahora toca desayunar con Inés en Casa amarilla, pero estás hablando con Mateo Ruiz.",
    );
  });
  it("el aviso del tiempo", () => {
    expect(outdoorPlanText("Está lloviendo", "Pasear por el lago", "Lago")).toBe(
      "Está lloviendo y lo que tenías previsto (pasear por el lago) es al aire libre, en Lago.",
    );
  });
});
