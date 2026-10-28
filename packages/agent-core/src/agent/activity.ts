import type { ActivityKind, Pose } from "@lethetown/shared";

const RULES: [RegExp, ActivityKind][] = [
  [/dorm|siesta|sueño/i, "sleep"],
  [/caminando|\byendo\b|paseando hacia|volviendo/i, "walk"],
  [/hablando|charlando|convers/i, "talk"],
  [/cocin|prepar(ar|ando) la comida/i, "cook"],
  [/comer|comiendo|desayun|cenar|cenando|merend|almorz|café|tomando/i, "eat"],
  [/le(er|yendo)|libro|poema|periódico/i, "read"],
  [
    /trabaj|dibuj|ilustr|atender|atendiendo|abrir el café|caja|reponer|ordenar|huerto|recados|compras/i,
    "work",
  ],
  [/sentad|sentarse|descans/i, "sit"],
];

/** Deduce el tipo de actividad del texto (para rutinas sin LLM y como respaldo). */
export function inferActivityKind(action: string, pose?: Pose | null): ActivityKind {
  for (const [re, kind] of RULES) if (re.test(action)) return kind;
  if (pose === "sleep") return "sleep";
  if (pose === "sit") return "sit";
  if (pose === "use") return "work";
  return "idle";
}
