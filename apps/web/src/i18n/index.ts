import { useSyncExternalStore } from "react";
import en from "./en";
import es, { type MessageKey } from "./es";

export type Lang = "es" | "en";
export const LANGS: Lang[] = ["es", "en"];
const DICTS: Record<Lang, Record<MessageKey, string>> = { es, en };
const STORAGE_KEY = "lethetown.lang";

function initialLang(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "es" || saved === "en") return saved;
  } catch {
    /* sin almacenamiento (modo privado): idioma por defecto */
  }
  return "es";
}

let lang: Lang = initialLang();
const listeners = new Set<() => void>();

export function setLang(next: Lang) {
  lang = next;
  if (typeof document !== "undefined") document.documentElement.lang = next;
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    /* no se puede recordar: no pasa nada */
  }
  for (const l of listeners) l();
}

/** Texto traducido con variables `{nombre}`. Si falta en el idioma, cae al español. */
export function t(key: MessageKey, vars?: Record<string, string | number>): string {
  const text = DICTS[lang][key] ?? es[key];
  return vars ? text.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? `{${k}}`)) : text;
}

/** Hook: vuelve a pintar el componente al cambiar de idioma. */
export function useI18n() {
  const current = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => lang,
  );
  return { t, lang: current, setLang };
}

// Fuera del navegador (tests) no hay documento.
if (typeof document !== "undefined") document.documentElement.lang = lang;
export type { MessageKey };
