import { useEffect, useState } from "react";
import { api } from "../net/store";

/**
 * Pide `path` a la API y lo refresca cada `everyMs`. Mientras llega lo de una clave nueva (otro
 * agente), devuelve null: así no se ve un momento lo del anterior.
 */
export function usePolled<T>(path: string, key: string, everyMs = 5000): T | null {
  const [data, setData] = useState<{ key: string; value: T } | null>(null);
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const value = await api<T>(path);
        if (!cancelled) setData({ key, value });
      } catch {
        /* reintenta en el siguiente intervalo */
      }
    };
    void load();
    const timer = setInterval(load, everyMs);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [path, key, everyMs]);
  return data && data.key === key ? data.value : null;
}
