import {
  RelationshipType,
  affinityColor,
  affinityIcon,
  isAsymmetric,
  sparklinePath,
  type AffinityIcon,
  type AgentState,
  type RelationshipEntry,
  type RelationshipsResponse,
  type SocialProfile,
} from "@lethetown/shared";
import { useEffect, useMemo, useState } from "react";
import { useI18n, type MessageKey } from "../i18n";
import { useAssets } from "../net/assets";
import { api } from "../net/store";
import { formatGameTime } from "./format";
import { Portrait } from "./Portrait";

const REFRESH_MS = 4000;

interface Props {
  agent: AgentState;
  /**
   * Centra el mapa en una persona (sin cambiar el inspector). `reveal`: además, deja ver el
   * mapa (en móvil, cierra la hoja de paneles).
   */
  onFocus: (id: string, reveal?: boolean) => void;
  /** Abre la ficha de otra persona en el inspector. */
  onSelect: (id: string) => void;
  /** Marcas de afinidad sobre el mapa: si están activas y cuáles son. */
  marksOn: boolean;
  onMarksOn: (on: boolean) => void;
  onMarks: (marks: Record<string, AffinityIcon> | null) => void;
  onOpenNetwork: () => void;
}

/** Sin tildes y en minúsculas, para buscar. */
const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

/** Barra de −1 a 1 que crece desde el centro, con el color de la afinidad. */
function AffinityBar({ value, label }: { value: number; label: string }) {
  const left = value < 0 ? 50 + value * 50 : 50;
  return (
    <div className="bar" title={`${label}: ${value.toFixed(2)}`}>
      <span>{label}</span>
      <div
        className="bar-track bipolar"
        role="meter"
        aria-label={label}
        aria-valuemin={-1}
        aria-valuemax={1}
        aria-valuenow={Number(value.toFixed(2))}
      >
        <div
          className="bar-fill"
          style={{
            left: `${left}%`,
            width: `${Math.abs(value) * 50}%`,
            background: affinityColor(value),
          }}
        />
      </div>
    </div>
  );
}

function UnitBar({ value, label }: { value: number; label: string }) {
  return (
    <div className="bar" title={`${label}: ${value.toFixed(2)}`}>
      <span>{label}</span>
      <div
        className="bar-track"
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={1}
        aria-valuenow={Number(value.toFixed(2))}
      >
        <div className="bar-fill" style={{ width: `${Math.round(value * 100)}%` }} />
      </div>
    </div>
  );
}

/** Mini gráfica de la evolución de la afinidad (−1..1, con la línea del 0). */
function Sparkline({ points, label }: { points: RelationshipEntry["trend"]; label: string }) {
  const W = 120;
  const H = 26;
  const last = points.at(-1)?.value ?? 0;
  return (
    <svg
      className="sparkline"
      viewBox={`0 0 ${W} ${H}`}
      width={W}
      height={H}
      role="img"
      aria-label={`${label}: ${points.map((p) => p.value.toFixed(2)).join(" → ")}`}
    >
      <line x1={0} x2={W} y1={H / 2} y2={H / 2} className="sparkline-zero" />
      <path
        d={sparklinePath(points, W, H)}
        fill="none"
        stroke={affinityColor(last)}
        strokeWidth={2}
      />
    </svg>
  );
}

function Bars({ p, t }: { p: SocialProfile; t: (k: MessageKey) => string }) {
  return (
    <>
      <AffinityBar label={t("rel.affinity")} value={p.affinity} />
      <UnitBar label={t("rel.trust")} value={p.trust} />
      <UnitBar label={t("rel.familiarity")} value={p.familiarity} />
    </>
  );
}

/**
 * Pestaña «Relaciones» del inspector: a quién conoce y qué piensa de cada uno (de más a menos
 * afinidad), con su evolución y lo que la otra persona piensa de él o ella.
 */
export function RelationshipsPanel(props: Props) {
  const { agent, onFocus, onSelect, marksOn, onMarksOn, onMarks, onOpenNetwork } = props;
  const { t } = useI18n();
  const { pack } = useAssets();
  const [data, setData] = useState<RelationshipsResponse | null>(null);
  const [query, setQuery] = useState("");
  const [type, setType] = useState<RelationshipType | "">("");
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    setOpenId(null);
    let cancelled = false;
    const load = async () => {
      try {
        const res = await api<RelationshipsResponse>(
          `/api/agents/${agent.id}/relationships?limit=200`,
        );
        if (!cancelled) setData(res);
      } catch {
        /* reintenta en el siguiente intervalo */
      }
    };
    void load();
    const timer = setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [agent.id]);

  const current = data && data.agentId === agent.id ? data : null;

  // Marcas del mapa: lo que piensa de cada uno (con todos, sin filtros).
  useEffect(() => {
    if (!marksOn || !current) return onMarks(null);
    onMarks(
      Object.fromEntries(
        current.items.map((i) => [i.profile.aboutId, affinityIcon(i.profile.affinity)]),
      ),
    );
  }, [marksOn, current, onMarks]);
  useEffect(() => () => onMarks(null), [onMarks]);

  const items = useMemo(() => {
    const needle = fold(query.trim());
    return (current?.items ?? []).filter(
      (i) =>
        (!type || i.profile.relationshipType === type) &&
        (!needle || fold(i.name).includes(needle)),
    );
  }, [current, query, type]);
  const unknown = useMemo(() => {
    const needle = fold(query.trim());
    return (current?.unknown ?? []).filter((u) => !needle || fold(u.name).includes(needle));
  }, [current, query]);

  const first = agent.name.split(" ")[0] ?? agent.name;
  const typeLabel = (k: RelationshipType) => t(`rel.type.${k}` as MessageKey);

  return (
    <div className="relationships">
      <div className="filters small">
        <input
          className="field"
          type="search"
          aria-label={t("rel.search")}
          placeholder={t("rel.search")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select
          className="field"
          aria-label={t("rel.allTypes")}
          value={type}
          onChange={(e) => setType(e.target.value as RelationshipType | "")}
        >
          <option value="">{t("rel.allTypes")}</option>
          {RelationshipType.options.map((k) => (
            <option key={k} value={k}>
              {typeLabel(k)}
            </option>
          ))}
        </select>
        <label>
          <input type="checkbox" checked={marksOn} onChange={(e) => onMarksOn(e.target.checked)} />{" "}
          {t("rel.showOnMap")}
        </label>
      </div>
      <button className="btn small" onClick={onOpenNetwork}>
        🕸 {t("rel.network")}
      </button>

      {!current && <p className="muted small">{t("rel.loading")}</p>}
      {current && current.items.length === 0 && <p className="muted small">{t("rel.none")}</p>}

      <ul className="rel-list">
        {items.map((i) => {
          const p = i.profile;
          const open = openId === p.aboutId;
          const other = i.name.split(" ")[0] ?? i.name;
          const asym = isAsymmetric(p.affinity, i.reciprocal?.affinity);
          return (
            <li key={p.aboutId} className={`card rel rel-${p.relationshipType}`}>
              <button
                className="rel-head"
                aria-expanded={open}
                onClick={() => {
                  setOpenId(open ? null : p.aboutId);
                  if (!open) onFocus(p.aboutId);
                }}
              >
                <Portrait pack={pack} agentId={p.aboutId} name={i.name} size={32} />
                <span className="rel-name">
                  <b>{i.name}</b>
                  <span className="tag">{typeLabel(p.relationshipType)}</span>
                  {asym && (
                    <span className="tag warn" title={t("rel.asymmetric")}>
                      ⇄
                    </span>
                  )}
                </span>
                <Sparkline points={i.trend} label={t("rel.trend", { name: first })} />
              </button>
              <Bars p={p} t={t} />
              {p.summary && <div className="muted readable small">{p.summary}</div>}
              {open && (
                <div className="rel-detail">
                  <h5>{t("rel.reciprocal", { name: other, other: first })}</h5>
                  {i.reciprocal ? (
                    <>
                      <span className="tag">{typeLabel(i.reciprocal.relationshipType)}</span>
                      <Bars p={i.reciprocal} t={t} />
                      {i.reciprocal.summary && (
                        <div className="muted readable small">{i.reciprocal.summary}</div>
                      )}
                    </>
                  ) : (
                    <p className="muted small">
                      {t("rel.noReciprocal", { name: other, other: first })}
                    </p>
                  )}
                  {asym && <p className="small warn-text">⇄ {t("rel.asymmetric")}</p>}
                  {i.trend[0] && (
                    <p className="muted small num">
                      {t("rel.since")} {formatGameTime(i.trend[0].at)}
                    </p>
                  )}
                  <div className="row gap">
                    <button className="btn small" onClick={() => onFocus(p.aboutId, true)}>
                      📍 {t("rel.locate")}
                    </button>
                    <button className="btn small" onClick={() => onSelect(p.aboutId)}>
                      {t("rel.open")}
                    </button>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {unknown.length > 0 && (
        <details className="small">
          <summary>{t("rel.unknown", { n: unknown.length })}</summary>
          <ul className="rel-unknown">
            {unknown.map((u) => (
              <li key={u.id}>
                <button className="link" onClick={() => onFocus(u.id, true)}>
                  {u.name}
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
