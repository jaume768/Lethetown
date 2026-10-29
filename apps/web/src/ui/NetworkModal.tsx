import {
  RelationshipType,
  affinityColor,
  edgeFromProfile,
  edgeWidth,
  filterEdges,
  layoutNetwork,
  networkAt,
  type NetworkEdge,
  type SocialGraphResponse,
  type SocialHistoryResponse,
  type SocialProfileChange,
} from "@lethetown/shared";
import { useEffect, useMemo, useState } from "react";
import { useI18n, type MessageKey } from "../i18n";
import { useAssets } from "../net/assets";
import { api } from "../net/store";
import { formatGameTime } from "./format";
import { Modal } from "./Modal";
import { Portrait } from "./Portrait";

/** Lienzo lógico del grafo (el SVG y los retratos se escalan a su contenedor). */
const W = 800;
const H = 600;
const NODE_R = 20;
/** Páginas de historial que se piden como mucho (2000 cambios cada una). */
const MAX_PAGES = 10;

interface Props {
  onSelect: (id: string) => void;
  onClose: () => void;
}

/** Segmento de `a` a `b` desplazado a un lado (para que se vean las dos direcciones) y recortado. */
function segment(a: { x: number; y: number }, b: { x: number; y: number }) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const d = Math.max(1, Math.hypot(dx, dy));
  const ux = dx / d;
  const uy = dy / d;
  const ox = -uy * 4;
  const oy = ux * 4;
  const x1 = a.x + ux * NODE_R + ox;
  const y1 = a.y + uy * NODE_R + oy;
  const x2 = b.x - ux * (NODE_R + 2) + ox;
  const y2 = b.y - uy * (NODE_R + 2) + oy;
  // Punta de flecha en el destino.
  const head = `${x2},${y2} ${x2 - ux * 8 - uy * 4},${y2 - uy * 8 + ux * 4} ${x2 - ux * 8 + uy * 4},${y2 - uy * 8 - ux * 4}`;
  return { x1, y1, x2: x2 - ux * 6, y2: y2 - uy * 6, head };
}

/** Red del pueblo: quién piensa qué de quién, con filtros por tipo y viaje en el tiempo. */
export function NetworkModal({ onSelect, onClose }: Props) {
  const { t } = useI18n();
  const { pack } = useAssets();
  const [graph, setGraph] = useState<SocialGraphResponse | null>(null);
  const [history, setHistory] = useState<SocialProfileChange[]>([]);
  const [time, setTime] = useState<number | null>(null);
  const [types, setTypes] = useState<Set<RelationshipType>>(new Set());
  const [hover, setHover] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const g = await api<SocialGraphResponse>("/api/social/graph");
        const all: SocialProfileChange[] = [];
        let since: number | null = -1;
        for (let page = 0; page < MAX_PAGES && since !== null; page++) {
          const h: SocialHistoryResponse = await api<SocialHistoryResponse>(
            `/api/social/history?limit=2000${since >= 0 ? `&since=${since}` : ""}`,
          );
          all.push(...h.changes);
          since = h.next;
        }
        if (cancelled) return;
        setGraph(g);
        setHistory(all);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const start = history[0]?.at ?? graph?.now ?? 0;
  const end = graph?.now ?? 0;
  const at = time ?? end;
  const live = time === null || time >= end;

  const allEdges = useMemo<NetworkEdge[]>(
    () => (graph ? graph.profiles.map(edgeFromProfile) : []),
    [graph],
  );
  // El layout se calcula una vez con la red de ahora: al mover el tiempo no saltan los nodos.
  const positions = useMemo(
    () =>
      graph
        ? layoutNetwork(
            graph.nodes.map((n) => n.id),
            allEdges,
            W,
            H,
          )
        : {},
    [graph, allEdges],
  );
  const edges = useMemo(() => {
    const shown = live ? allEdges : networkAt(history, at);
    return filterEdges(shown, types).sort((a, b) => a.familiarity - b.familiarity);
  }, [live, allEdges, history, at, types]);

  const names = new Map(graph?.nodes.map((n) => [n.id, n.name]) ?? []);
  const typeLabel = (k: RelationshipType) => t(`rel.type.${k}` as MessageKey);
  const toggleType = (k: RelationshipType) => {
    const next = new Set(types);
    if (next.has(k)) next.delete(k);
    else next.add(k);
    setTypes(next);
  };

  return (
    <Modal title={t("network.title")} onClose={onClose} className="network-modal">
      {error && <p className="error small">{error}</p>}
      {!graph && !error && <p className="muted">{t("network.loading")}</p>}
      {graph && (
        <>
          <p className="muted small readable">{t("network.legend")}</p>
          <fieldset className="network-filters small">
            <legend>{t("network.filter")}</legend>
            {RelationshipType.options.map((k) => (
              <label key={k} className={`chip ${types.has(k) ? "active" : ""}`}>
                <input type="checkbox" checked={types.has(k)} onChange={() => toggleType(k)} />{" "}
                {typeLabel(k)}
              </label>
            ))}
          </fieldset>
          <label className="network-time small">
            <span>
              {t("network.time")}:{" "}
              <b className="num">{live ? t("network.now") : formatGameTime(at)}</b>
            </span>
            <input
              type="range"
              min={start}
              max={end}
              step={10}
              value={at}
              aria-valuetext={live ? t("network.now") : formatGameTime(at)}
              onChange={(e) => setTime(Number(e.target.value))}
            />
          </label>
          <div className="network">
            <svg
              viewBox={`0 0 ${W} ${H}`}
              role="img"
              aria-label={t("network.title")}
              preserveAspectRatio="xMidYMid meet"
            >
              {edges.map((e) => {
                const a = positions[e.from];
                const b = positions[e.to];
                if (!a || !b) return null;
                const s = segment(a, b);
                const color = affinityColor(e.affinity);
                const dim = hover && e.from !== hover && e.to !== hover;
                // Lo débil (poco trato, casi indiferencia) se ve menos: así se lee la red.
                const strength = Math.max(e.familiarity, Math.abs(e.affinity));
                const focused = hover && !dim;
                return (
                  <g
                    key={`${e.from}|${e.to}`}
                    opacity={dim ? 0.08 : focused ? 1 : 0.25 + 0.7 * strength}
                  >
                    <line
                      x1={s.x1}
                      y1={s.y1}
                      x2={s.x2}
                      y2={s.y2}
                      stroke={color}
                      strokeWidth={edgeWidth(e.familiarity)}
                      strokeDasharray={e.type === "rivalry" ? "6 4" : undefined}
                    />
                    <polygon points={s.head} fill={color} />
                  </g>
                );
              })}
            </svg>
            {graph.nodes.map((n) => {
              const p = positions[n.id];
              if (!p) return null;
              return (
                <button
                  key={n.id}
                  className={`network-node ${hover === n.id ? "active" : ""}`}
                  style={{ left: `${(p.x / W) * 100}%`, top: `${(p.y / H) * 100}%` }}
                  onMouseEnter={() => setHover(n.id)}
                  onMouseLeave={() => setHover(null)}
                  onFocus={() => setHover(n.id)}
                  onBlur={() => setHover(null)}
                  onClick={() => {
                    onSelect(n.id);
                    onClose();
                  }}
                  aria-label={n.name}
                >
                  <Portrait pack={pack} agentId={n.id} name={n.name} size={32} />
                  <span className="network-name">{n.name.split(" ")[0]}</span>
                </button>
              );
            })}
          </div>
          <p className="muted small">{t("network.select")}</p>
          {edges.length === 0 && <p className="muted small">{t("network.empty")}</p>}
          <details className="small">
            <summary>{t("network.list")}</summary>
            <ul className="readable">
              {[...edges]
                .sort((a, b) => b.affinity - a.affinity)
                .map((e) => (
                  <li key={`${e.from}|${e.to}`}>
                    {t("network.edge", {
                      from: names.get(e.from) ?? e.from,
                      to: names.get(e.to) ?? e.to,
                      type: typeLabel(e.type),
                      affinity: e.affinity.toFixed(2),
                    })}
                  </li>
                ))}
            </ul>
          </details>
        </>
      )}
    </Modal>
  );
}
