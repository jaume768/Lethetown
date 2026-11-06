/**
 * Saberes del pueblo (lógica pura, sin LLM): cómo se deforman al contarse, cómo se refuerzan con
 * el uso y cómo se olvidan sin él. Al transmitirse, cada elemento (un ingrediente, un paso, un
 * detalle) puede perderse o cambiar según lo bien que lo sepa quien lo cuenta, su habilidad en
 * eso y la memoria de quien escucha; cada uno se queda con su versión. El servidor (sistema
 * `lore`) decide cuándo; aquí, qué pasa. Ver docs/decisiones/lore.md.
 */
import type { HeldElement, LoreElement } from "@lethetown/shared";
import { z } from "zod";
import type { Rng } from "../util/random";

const unit = (x: number) => z.number().min(0).max(1).default(x);

export const LoreConfig = z.object({
  enabled: z.boolean().default(true),
  /**
   * Al contarlo, probabilidad de que un elemento se pierda: base + k·(1 − fidelidad de quien lo
   * cuenta), × (1 − protección·su habilidad) × lo que olvida quien escucha.
   */
  loseBase: unit(0.03),
  loseFromFidelity: unit(0.3),
  /**
   * …y de que cambie (un número, un ingrediente, un sitio; de las variantes del saber). 0,05
   * (era 0,04) y cada elemento de las semillas con alguna variante: en la partida de una semana
   * solo se deformó 1 de 37 transmisiones; con las semillas, un 16 % (test).
   */
  alterBase: unit(0.05),
  alterFromFidelity: unit(0.25),
  /** Cuánto protege la habilidad de quien lo cuenta (un panadero no se equivoca con el pan). */
  skillProtect: unit(0.6),
  /** La fidelidad de quien escucha nunca pasa de la de quien lo cuenta × esto. */
  retellCeiling: unit(0.95),
  /** Usarlo (cocinar esa receta, ir a ese sitio) sube la fidelidad esto (tope 1). */
  useBoost: unit(0.05),
  /** Días sin usarlo antes de empezar a olvidarlo. */
  unusedGraceDays: z.number().nonnegative().default(5),
  /** Fidelidad que se pierde por día sin usarlo (más despacio con la habilidad en eso). */
  decayPerDay: unit(0.012),
  /**
   * No se le vuelve a contar a quien ya lo sabe con todos sus elementos y lo oyó o usó hace
   * menos de estos días (corrección 3.5: Aurora le contó a Clara lo de Alma 6 y 11 veces).
   */
  retellCooldownDays: z.number().nonnegative().default(3),
  /** Por debajo de esto ya no recuerda cómo era; si nadie llega, se pierde para el pueblo. */
  minFidelity: unit(0.25),
});
export type LoreConfig = z.infer<typeof LoreConfig>;

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/** Quien lo cuenta: su versión, lo bien que lo sabe y su habilidad en eso. */
export interface Teller {
  elements: HeldElement[];
  fidelity: number;
  skillLevel: number;
}

/** Quien escucha: lo que le cuesta retenerlo (1 = normal; > 1, olvida más; del perfil de memoria). */
export interface Listener {
  forgetfulness: number;
}

/** Un número cambiado («cuatro huevos» → «cinco huevos», «20 grados» → «25 grados»). */
const NUMBERS: [string, string][] = [
  ["dos", "tres"],
  ["tres", "cuatro"],
  ["cuatro", "cinco"],
  ["cinco", "seis"],
  ["seis", "cinco"],
  ["ocho", "diez"],
  ["diez", "doce"],
  ["doce", "quince"],
  ["una hora", "media hora"],
  ["media", "una"],
];

/** La versión cambiada de un elemento: una variante del saber o, si no, un número distinto. */
export function alterElement(text: string, variants: string[], roll: number): string | null {
  const others = variants.filter((v) => v !== text);
  if (others.length) return others[Math.floor(roll * others.length) % others.length]!;
  const digit = /\d+/.exec(text);
  if (digit) {
    const n = Number(digit[0]);
    const m = roll < 0.5 ? Math.max(1, Math.round(n * 0.8)) : Math.round(n * 1.25) || n + 1;
    if (m !== n) return text.replace(digit[0], String(m));
  }
  for (const [from, to] of NUMBERS) {
    const re = new RegExp(`(^|[^\\p{L}])${from}(?=$|[^\\p{L}])`, "u");
    if (re.test(text)) return text.replace(re, `$1${to}`);
  }
  return null;
}

/** Lo que pasa al contarlo: la versión de quien escucha y con qué fidelidad. */
export function transmit(
  teller: Teller,
  listener: Listener,
  canonical: LoreElement[],
  rng: Rng,
  cfg: LoreConfig,
): { elements: HeldElement[]; fidelity: number; lost: number; altered: number } {
  const protect = 1 - cfg.skillProtect * clamp01(teller.skillLevel);
  const memory = Math.max(0.3, listener.forgetfulness);
  const lose = clamp01(
    (cfg.loseBase + cfg.loseFromFidelity * (1 - teller.fidelity)) * protect * memory,
  );
  const alter = clamp01(
    (cfg.alterBase + cfg.alterFromFidelity * (1 - teller.fidelity)) * protect * memory,
  );
  const out: HeldElement[] = [];
  let lost = 0;
  let altered = 0;
  for (const e of teller.elements) {
    if (rng() < lose) {
      lost++;
      continue;
    }
    if (rng() < alter) {
      const variants = canonical.find((c) => c.id === e.id)?.variants ?? [];
      const changed = alterElement(
        e.text,
        [canonical.find((c) => c.id === e.id)?.text ?? e.text, ...variants],
        rng(),
      );
      if (changed && changed !== e.text) {
        altered++;
        out.push({ id: e.id, text: changed, altered: true });
        continue;
      }
    }
    out.push({ ...e });
  }
  const total = Math.max(1, canonical.length);
  const kept = out.filter((e) => !e.altered).length + 0.5 * out.filter((e) => e.altered).length;
  const fidelity = clamp01(Math.min(teller.fidelity * cfg.retellCeiling, kept / total));
  return { elements: out, fidelity, lost, altered };
}

/**
 * ¿Lo sigue sabiendo el pueblo? Sí mientras algún portador que no lo ha olvidado llegue a
 * `minFidelity`; si no, se pierde para el pueblo.
 */
export function knownByTown(
  holders: { fidelity: number; forgotten: boolean }[],
  cfg: LoreConfig,
): boolean {
  return holders.some((h) => !h.forgotten && h.fidelity >= cfg.minFidelity);
}

/** Usarlo lo refuerza (sin recuperar lo que ya se perdió). */
export function useLore(fidelity: number, cfg: LoreConfig): number {
  return clamp01(fidelity + cfg.useBoost);
}

/**
 * El olvido de `days` días sin usarlo (pasados los de gracia): baja la fidelidad (más despacio
 * con habilidad en eso) y, si queda por debajo de lo que conserva, se le va un elemento.
 */
export function forgetLore(
  holder: { fidelity: number; elements: HeldElement[] },
  idleDays: number,
  days: number,
  skillLevel: number,
  total: number,
  rng: Rng,
  cfg: LoreConfig,
): { fidelity: number; elements: HeldElement[]; dropped: HeldElement | null } {
  if (idleDays <= cfg.unusedGraceDays || days <= 0) {
    return { fidelity: holder.fidelity, elements: holder.elements, dropped: null };
  }
  const fidelity = clamp01(holder.fidelity - cfg.decayPerDay * days * (1 - 0.5 * skillLevel));
  // Cuántos elementos se sostienen con esta fidelidad (al menos uno mientras recuerde algo).
  const keep = Math.max(fidelity >= cfg.minFidelity ? 1 : 0, Math.round(fidelity * total));
  if (holder.elements.length <= keep) return { fidelity, elements: holder.elements, dropped: null };
  const i = Math.floor(rng() * holder.elements.length) % holder.elements.length;
  const dropped = holder.elements[i]!;
  return { fidelity, elements: holder.elements.filter((_, j) => j !== i), dropped };
}
