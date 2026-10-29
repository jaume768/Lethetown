import type { AgentState, Commitment, CommitmentsResponse, World } from "@lethetown/shared";
import { useEffect, useState } from "react";
import { useI18n, type MessageKey } from "../i18n";
import { api } from "../net/store";
import { formatGameTime } from "./format";

const REFRESH_MS = 5000;
/** Más tarde que esto (minutos) es llegar tarde (como en el motor). */
const LATE_AFTER = 10;

interface Props {
  agent: AgentState;
  agents: AgentState[];
  world: World | null;
}

/** Pestaña «Agenda» del inspector: citas próximas y pasadas, y cómo acabaron. */
export function AgendaPanel({ agent, agents, world }: Props) {
  const { t } = useI18n();
  const [data, setData] = useState<CommitmentsResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await api<CommitmentsResponse>(`/api/agents/${agent.id}/commitments?limit=50`);
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
  if (!current) return <p className="muted small">{t("rel.loading")}</p>;
  const name = (id: string) => agents.find((a) => a.id === id)?.name.split(" ")[0] ?? id;
  const place = (id: string) => world?.places.find((p) => p.id === id)?.name ?? id;
  const open = (c: Commitment) => c.status === "proposed" || c.status === "accepted";
  const upcoming = current.items.filter(open).sort((a, b) => a.at - b.at);
  const past = current.items.filter((c) => !open(c));

  const item = (c: Commitment) => {
    const others = c.participants.filter((p) => p !== agent.id).map(name);
    const arrived = c.arrivals[agent.id];
    const late = arrived !== undefined && arrived > c.at + LATE_AFTER;
    return (
      <li key={c.id} className={`card agenda-${c.status}`}>
        <div className="row">
          <b className="num">{formatGameTime(c.at)}</b>
          <span className="tag">{t(`agenda.status.${c.status}` as MessageKey)}</span>
        </div>
        <div className="readable">
          {place(c.placeId)} · {t("agenda.with", { names: others.join(", ") })} · {c.reason}
        </div>
        <div className="tags small">
          {c.organizerId !== agent.id && (
            <span className="tag">{t("agenda.organizer", { name: name(c.organizerId) })}</span>
          )}
          {c.responses[agent.id] === "pending" && (
            <span className="tag">{t("agenda.pending")}</span>
          )}
          {c.responses[agent.id] === "declined" && (
            <span className="tag">{t("agenda.declined")}</span>
          )}
          {c.forgot.includes(agent.id) && <span className="tag warn">{t("agenda.forgot")}</span>}
          {late && (
            <span className="tag warn">
              {t("agenda.late", { min: Math.round(arrived - c.at) })}
            </span>
          )}
        </div>
      </li>
    );
  };

  return (
    <div className="agenda">
      <h4>{t("agenda.upcoming")}</h4>
      {upcoming.length ? (
        <ul className="rel-list">{upcoming.map(item)}</ul>
      ) : (
        <p className="muted small">{t("agenda.none")}</p>
      )}
      <h4>{t("agenda.past")}</h4>
      {past.length ? (
        <ul className="rel-list">{past.map(item)}</ul>
      ) : (
        <p className="muted small">{t("agenda.none")}</p>
      )}
    </div>
  );
}
