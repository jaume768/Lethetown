/**
 * Iconos de las acciones del catálogo (por `meta.action` de los eventos) y de los objetos del
 * inventario (por `kind`). Lógica pura: el log y Rashomon la usan con una etiqueta accesible.
 */
import type { SimEvent } from "@lethetown/shared";

export const ACTION_ICONS: Record<string, string> = {
  do_activity: "🔀",
  say: "💬",
  propose_meeting: "📅",
  accept_meeting: "✔",
  decline_meeting: "✖",
  cancel_meeting: "🚫",
  meeting: "🤝",
  explore: "🧭",
  discover: "🧭",
  join_conversation: "👥",
  leave_conversation: "👋",
  use_object: "🛠",
  give_item: "🎁",
  lend_item: "🤝",
  return_item: "📗",
  take_item: "✋",
  leave_item: "📦",
  loan: "📕",
  invite: "💌",
  accept_invite: "🚶",
  go_together: "🚶",
  decline_invite: "✖",
  follow: "👣",
  post_note: "📌",
  leave_note: "✉",
  open_place: "🔓",
  close_place: "🔒",
  intruder: "🚪",
};

const ITEM_ICONS: Record<string, string> = {
  libro: "📕",
  camara: "📷",
  guitarra: "🎸",
  paraguas: "☂",
};

export function itemIcon(kind: string): string {
  return ITEM_ICONS[kind] ?? "📦";
}

/** Icono y si salió bien de un evento de acción (null si no es de una acción del catálogo). */
export function actionBadge(
  e: Pick<SimEvent, "meta">,
): { action: string; icon: string; ok: boolean } | null {
  const action = e.meta?.action;
  if (!action) return null;
  return { action, icon: ACTION_ICONS[action] ?? "•", ok: e.meta?.ok !== false };
}

/** El texto sin el icono del principio si ya lo pone la insignia (para no repetirlo). */
export function withoutLeadingIcon(text: string, icon: string): string {
  return text.startsWith(icon) ? text.slice(icon.length).trimStart() : text;
}
