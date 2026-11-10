import type { Moment } from "@lethetown/shared";

/** Solo paquetes de la carpeta pública `replays/` del propio sitio (nada de URLs de fuera). */
export function safeReplaySrc(src: string | null): string | null {
  if (!src) return null;
  return /^\/replays\/[\w.-]+\.json(\.gz)?$/.test(src) && !src.includes("..") ? src : null;
}

export type Card =
  | { kind: "garden" | "goals" | "skills"; agentId: string }
  | { kind: "rashomon"; eventId: string }
  | { kind: "network" };

/** Las tarjetas que tienen sentido para un momento (la primera, la que se abre por defecto). */
export function cardsFor(m: Moment, hasAccounts: (eventId: string) => boolean): Card[] {
  const out: Card[] = [];
  const [a, b] = m.agents;
  if (m.eventId && hasAccounts(m.eventId)) out.push({ kind: "rashomon", eventId: m.eventId });
  if (m.kind === "goal" && a) out.push({ kind: "goals", agentId: a });
  if (m.kind === "teaching" && (b ?? a)) out.push({ kind: "skills", agentId: (b ?? a)! });
  if (a) out.push({ kind: "garden", agentId: a });
  if (a && m.kind !== "goal") out.push({ kind: "goals", agentId: a });
  out.push({ kind: "network" });
  return out;
}
