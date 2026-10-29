import type { ActivityKind, Facing } from "../schemas/agent";
import type { AnimationDef, CharacterSheet } from "./manifest";

export interface FrameChoice {
  /** Índice de frame en la hoja (fila * columnas + columna). */
  frame: number;
  /** Clave de animación usada (tras los respaldos). */
  key: string;
  /** Si true, el cliente tumba el sprite (no hay animación de dormir en la hoja). */
  lying: boolean;
}

/** Baldosas recorridas por cada frame de la animación de andar. */
const TILES_PER_WALK_FRAME = 0.5;

function frameOf(sheet: CharacterSheet, anim: AnimationDef, i: number): number {
  return anim.row * sheet.columns + anim.start + (((i % anim.count) + anim.count) % anim.count);
}

function find(sheet: CharacterSheet, keys: string[]): [string, AnimationDef] | null {
  for (const k of keys) {
    const a = sheet.animations[k];
    if (a) return [k, a];
  }
  return null;
}

/**
 * Elige el frame de un personaje. Andando, el frame depende de la distancia recorrida (no del
 * tiempo): a velocidades de simulación altas se saltan frames en vez de ir a trompicones.
 * Quieto, depende del tiempo real (`realSeconds`).
 */
export function pickFrame(
  sheet: CharacterSheet,
  opts: {
    moving: boolean;
    distance: number;
    facing: Facing;
    activityKind: ActivityKind;
    realSeconds: number;
  },
): FrameChoice {
  const f = opts.facing;
  const side = f === "left" ? "left" : "right";
  if (opts.moving) {
    const walk = find(sheet, [`walk_${f}`, "walk_down", `idle_${f}`, "idle_down"]);
    if (walk) {
      return {
        key: walk[0],
        frame: frameOf(sheet, walk[1], Math.floor(opts.distance / TILES_PER_WALK_FRAME)),
        lying: false,
      };
    }
  }
  let keys: string[];
  let lying = false;
  switch (opts.activityKind) {
    case "sit":
    case "eat":
      keys = [`sit_${f}`, `sit_${side}`, `idle_${f}`, "idle_down"];
      break;
    case "sleep":
      keys = ["sleep_down", `sleep_${f}`];
      if (!find(sheet, keys)) {
        keys = ["idle_down"];
        lying = true;
      }
      break;
    case "read":
      keys = [`read_${f}`, "read_down", `idle_${f}`, "idle_down"];
      break;
    default:
      keys = [`idle_${f}`, "idle_down"];
  }
  const anim = find(sheet, keys) ?? find(sheet, Object.keys(sheet.animations));
  if (!anim) return { key: "", frame: 0, lying };
  const i = lying ? 0 : Math.floor(opts.realSeconds * anim[1].frameRate);
  return { key: anim[0], frame: frameOf(sheet, anim[1], i), lying };
}

/**
 * Segundos reales que se ve un bocadillo una vez escrito: lo justo para leerlo (unos 20
 * caracteres por segundo), entre 4 y 9 s, sea cual sea la velocidad del juego.
 */
export function bubbleSeconds(text: string): number {
  return Math.min(9, Math.max(4, 1.5 + text.length / 20));
}
