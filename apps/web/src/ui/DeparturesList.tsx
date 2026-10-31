import type { AgentState, DeparturesResponse } from "@lethetown/shared";
import { useI18n } from "../i18n";
import { formatGameTime } from "./format";
import { usePolled } from "./usePolled";

interface Props {
  agents: AgentState[];
  /** Abre la ficha de quien se fue (sus metas y recuerdos siguen ahí). */
  onSelect: (id: string) => void;
}

/** «Vecinos que se fueron»: quién se marchó del pueblo, adónde y si está de visita. */
export function DeparturesList({ agents, onSelect }: Props) {
  const { t } = useI18n();
  const data = usePolled<DeparturesResponse>("/api/departures", "departures", 15_000);
  if (!data?.items.length) return null;
  const name = (id: string) => agents.find((a) => a.id === id)?.name ?? id;
  return (
    <section className="departures" aria-labelledby="departures-title">
      <h4 id="departures-title">{t("departures.title")}</h4>
      <ul className="rel-list">
        {data.items.map((d) => (
          <li key={d.agentId} className="card">
            <div className="row">
              <button type="button" className="link" onClick={() => onSelect(d.agentId)}>
                {name(d.agentId)}
              </button>
              <span className="tag">
                {d.visiting ? t("departures.visiting") : t("departures.lives", { to: d.to })}
              </span>
            </div>
            <div className="small muted">
              {t("departures.left", { when: formatGameTime(d.leftAt), to: d.to })}
              {d.visits ? ` · ${t("departures.visits", { n: d.visits })}` : ""}
              {!d.visiting && d.nextVisitAt !== null
                ? ` · ${t("departures.next", { when: formatGameTime(d.nextVisitAt) })}`
                : ""}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
