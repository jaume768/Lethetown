import type { AgentState, KnownPlacesResponse, World } from "@lethetown/shared";
import { useI18n, type MessageKey } from "../i18n";
import { formatGameTime } from "./format";
import { usePolled } from "./usePolled";

interface Props {
  agent: AgentState;
  agents: AgentState[];
  world: World | null;
  /** Centrar el mapa en un lugar. */
  onFocusPlace?: (placeId: string) => void;
}

/** Pestaña «Lugares» del inspector: lo que conoce del pueblo y cómo lo conoció. */
export function PlacesPanel({ agent, agents, world, onFocusPlace }: Props) {
  const { t } = useI18n();
  const data = usePolled<KnownPlacesResponse>(`/api/agents/${agent.id}/places`, agent.id, 10_000);
  if (!data) return <p className="muted small">{t("rel.loading")}</p>;
  const total = world?.places.length ?? 0;
  const name = (id: string | null) =>
    (id && agents.find((a) => a.id === id)?.name.split(" ")[0]) ?? "";
  // Lo descubierto primero (lo más reciente arriba); lo de siempre, al final.
  const items = [...data.items].sort(
    (a, b) => Number(a.source === "seed") - Number(b.source === "seed") || b.at - a.at,
  );
  return (
    <div className="places">
      <p className="small muted">{t("places.count", { n: data.items.length, total })}</p>
      <ul className="rel-list">
        {items.map((k) => {
          const p = world?.places.find((x) => x.id === k.placeId);
          return (
            <li key={k.placeId} className="card">
              <div className="row">
                {onFocusPlace ? (
                  <button type="button" className="link" onClick={() => onFocusPlace(k.placeId)}>
                    {p?.name ?? k.placeId}
                  </button>
                ) : (
                  <b>{p?.name ?? k.placeId}</b>
                )}
                <span className="tag">{t(`places.source.${k.source}` as MessageKey)}</span>
              </div>
              {k.source !== "seed" && (
                <div className="small muted">
                  {formatGameTime(k.at)}
                  {k.toldBy ? ` · ${t("places.toldBy", { name: name(k.toldBy) })}` : ""}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
