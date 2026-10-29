/**
 * Lógica no visual de las relaciones para el cliente: la red del pueblo en un instante (a partir
 * del historial), colores y grosores de las aristas, un layout de fuerzas determinista, el icono
 * de afinidad sobre el mapa y la mini gráfica de evolución. Puro y con tests; el cliente solo pinta.
 */
import type { RelationshipType, SocialProfile, SocialProfileChange } from "../schemas/memory";

/** Arista dirigida: lo que `from` piensa de `to`. */
export interface NetworkEdge {
  from: string;
  to: string;
  affinity: number;
  trust: number;
  familiarity: number;
  type: RelationshipType;
}

export function edgeFromProfile(p: SocialProfile): NetworkEdge {
  return {
    from: p.ownerId,
    to: p.aboutId,
    affinity: p.affinity,
    trust: p.trust,
    familiarity: p.familiarity,
    type: p.relationshipType,
  };
}

/** La red en el instante `t`: el último cambio (≤ t) de cada par, según el historial. */
export function networkAt(history: SocialProfileChange[], t: number): NetworkEdge[] {
  const last = new Map<string, SocialProfileChange>();
  for (const c of history) {
    if (c.at > t) continue;
    const key = `${c.ownerId}|${c.aboutId}`;
    const prev = last.get(key);
    if (!prev || c.at >= prev.at) last.set(key, c);
  }
  return [...last.values()].map((c) => ({
    from: c.ownerId,
    to: c.aboutId,
    affinity: c.affinity,
    trust: c.trust,
    familiarity: c.familiarity,
    type: c.relationshipType,
  }));
}

/** Solo los tipos elegidos (todos si `types` está vacío). */
export function filterEdges(edges: NetworkEdge[], types: ReadonlySet<RelationshipType>) {
  return types.size ? edges.filter((e) => types.has(e.type)) : edges;
}

const RED = [214, 69, 80];
const GREY = [150, 156, 170];
const GREEN = [62, 168, 104];

/** Color de una afinidad: rojo (−1) → gris (0) → verde (1). */
export function affinityColor(affinity: number): string {
  const a = Math.max(-1, Math.min(1, affinity));
  const [from, to, k] = a < 0 ? [GREY, RED, -a] : [GREY, GREEN, a];
  const mix = from.map((c, i) => Math.round(c + (to[i]! - c) * k));
  return `#${mix.map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

/** Grosor (px) de una arista según la familiaridad. */
export function edgeWidth(familiarity: number): number {
  return 0.75 + 3.25 * Math.max(0, Math.min(1, familiarity));
}

export type AffinityIcon = "heart" | "neutral" | "anger";

/** Icono sobre el mapa de lo que el agente seleccionado piensa de otro. */
export function affinityIcon(affinity: number): AffinityIcon {
  if (affinity >= 0.3) return "heart";
  if (affinity <= -0.3) return "anger";
  return "neutral";
}

/** Diferencia entre lo que uno piensa del otro y al revés (0 = simétrica). */
export function asymmetry(a: number | undefined, b: number | undefined): number {
  if (a === undefined || b === undefined) return 0;
  return Math.abs(a - b);
}

/** ¿Lo bastante asimétrica para destacarlo en la UI? */
export function isAsymmetric(a: number | undefined, b: number | undefined, threshold = 0.3) {
  return asymmetry(a, b) >= threshold;
}

/**
 * Trazado SVG ("M x y L …") de una serie en el tiempo (p. ej. la afinidad), escalada a
 * `width` × `height`; `range` es el rango de valores (por defecto, −1..1).
 */
export function sparklinePath(
  points: { at: number; value: number }[],
  width: number,
  height: number,
  range: [number, number] = [-1, 1],
): string {
  if (!points.length) return "";
  const sorted = [...points].sort((a, b) => a.at - b.at);
  const t0 = sorted[0]!.at;
  const span = Math.max(1, sorted.at(-1)!.at - t0);
  const [lo, hi] = range;
  const y = (v: number) => height - ((Math.max(lo, Math.min(hi, v)) - lo) / (hi - lo)) * height;
  const x = (at: number) => (sorted.length === 1 ? width : ((at - t0) / span) * width);
  const coords = sorted.map((p) => `${x(p.at).toFixed(1)} ${y(p.value).toFixed(1)}`);
  // Un solo punto: una raya horizontal hasta él.
  if (coords.length === 1) return `M 0 ${y(sorted[0]!.value).toFixed(1)} L ${coords[0]}`;
  return `M ${coords.join(" L ")}`;
}

/**
 * Layout de fuerzas (Fruchterman-Reingold) determinista: empieza en círculo y atrae más a quien
 * más se conoce. Devuelve posiciones dentro de `width` × `height` (con margen).
 */
export function layoutNetwork(
  nodes: string[],
  edges: NetworkEdge[],
  width: number,
  height: number,
  iterations = 250,
): Record<string, { x: number; y: number }> {
  const n = nodes.length;
  const margin = 40;
  const cx = width / 2;
  const cy = height / 2;
  const pos = nodes.map((_, i) => ({
    x: cx + (Math.min(width, height) / 2 - margin) * Math.cos((2 * Math.PI * i) / Math.max(1, n)),
    y: cy + (Math.min(width, height) / 2 - margin) * Math.sin((2 * Math.PI * i) / Math.max(1, n)),
  }));
  if (n < 2) return Object.fromEntries(nodes.map((id, i) => [id, pos[i]!]));
  const index = new Map(nodes.map((id, i) => [id, i]));
  const k = Math.sqrt(((width - 2 * margin) * (height - 2 * margin)) / n) * 0.9;
  let temp = Math.min(width, height) / 8;
  for (let it = 0; it < iterations; it++) {
    const disp = pos.map(() => ({ x: 0, y: 0 }));
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const dx = pos[i]!.x - pos[j]!.x;
        const dy = pos[i]!.y - pos[j]!.y;
        const d = Math.max(0.01, Math.hypot(dx, dy));
        const f = (k * k) / d;
        disp[i]!.x += (dx / d) * f;
        disp[i]!.y += (dy / d) * f;
        disp[j]!.x -= (dx / d) * f;
        disp[j]!.y -= (dy / d) * f;
      }
    }
    for (const e of edges) {
      const i = index.get(e.from);
      const j = index.get(e.to);
      if (i === undefined || j === undefined || i === j) continue;
      const dx = pos[i]!.x - pos[j]!.x;
      const dy = pos[i]!.y - pos[j]!.y;
      const d = Math.max(0.01, Math.hypot(dx, dy));
      const f = ((d * d) / k) * (0.3 + e.familiarity + Math.max(0, e.affinity) * 0.5);
      disp[i]!.x -= (dx / d) * f * 0.5;
      disp[i]!.y -= (dy / d) * f * 0.5;
      disp[j]!.x += (dx / d) * f * 0.5;
      disp[j]!.y += (dy / d) * f * 0.5;
    }
    for (let i = 0; i < n; i++) {
      const d = Math.max(0.01, Math.hypot(disp[i]!.x, disp[i]!.y));
      const step = Math.min(d, temp);
      pos[i]!.x = Math.min(width - margin, Math.max(margin, pos[i]!.x + (disp[i]!.x / d) * step));
      pos[i]!.y = Math.min(height - margin, Math.max(margin, pos[i]!.y + (disp[i]!.y / d) * step));
    }
    temp *= 0.98;
  }
  // Escala el resultado para que ocupe todo el lienzo (las fuerzas lo dejan apiñado).
  const xs = pos.map((p) => p.x);
  const ys = pos.map((p) => p.y);
  const fit = (v: number, lo: number, hi: number, size: number) =>
    hi - lo < 1 ? size / 2 : margin + ((v - lo) / (hi - lo)) * (size - 2 * margin);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  return Object.fromEntries(
    nodes.map((id, i) => [
      id,
      { x: fit(pos[i]!.x, x0, x1, width), y: fit(pos[i]!.y, y0, y1, height) },
    ]),
  );
}
