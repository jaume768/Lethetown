import { WORLD_ID } from "../net/store";

/** Enlace permanente a un evento (abre su vista Rashomon) o a un drama del mundo actual. */
export function permalink(params: { event?: string; drama?: string; agent?: string }): string {
  const url = new URL(location.origin + location.pathname);
  url.searchParams.set("world", WORLD_ID);
  for (const [k, v] of Object.entries(params)) if (v) url.searchParams.set(k, v);
  return url.toString();
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Parámetros de la URL al cargar (enlaces permanentes). */
export function initialParams() {
  const p = new URLSearchParams(location.search);
  return { event: p.get("event"), drama: p.get("drama"), agent: p.get("agent") };
}
