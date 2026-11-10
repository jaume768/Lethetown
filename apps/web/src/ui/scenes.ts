import { ReplayScenes, sceneBundlePath, type ReplayScene } from "@lethetown/shared";
import data from "../../../../docs/videos/escenas.json";

/** Escenas guardadas de `docs/videos/escenas.json` (si el fichero no vale, ninguna). */
export const SCENES: readonly ReplayScene[] = (() => {
  const parsed = ReplayScenes.safeParse(data);
  if (!parsed.success) console.warn("docs/videos/escenas.json no es válido", parsed.error);
  return parsed.success ? parsed.data.scenes : [];
})();

export function sceneById(id: string | null): ReplayScene | null {
  return (id && SCENES.find((s) => s.id === id)) || null;
}

/**
 * Los parámetros de la repetición con los de la escena (`?scene=<id>`): sus paquetes, modo
 * cine, el vecino, el minuto del primer plano y la tarjeta. Lo que ya venga en la URL manda.
 */
export function withScene(params: URLSearchParams): URLSearchParams {
  const scene = sceneById(params.get("scene"));
  if (!scene) return params;
  const out = new URLSearchParams(params);
  const def = (k: string, v: string | null | undefined) => {
    if (v != null && !out.has(k)) out.set(k, v);
  };
  def("src", sceneBundlePath(scene.src));
  if (scene.src2) {
    def("src2", sceneBundlePath(scene.src2));
    def("split", "1");
  }
  def("cine", "1");
  def("agent", scene.agent);
  def("t", String(scene.shots[0]!.from));
  def("memory", scene.memory);
  return out;
}
