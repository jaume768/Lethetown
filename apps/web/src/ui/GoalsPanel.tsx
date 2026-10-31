import {
  AWAY_LOCATION,
  type AgentGoalsResponse,
  type AgentState,
  type Goal,
  type GoalCriterion,
  type World,
} from "@lethetown/shared";
import { useI18n, type MessageKey } from "../i18n";
import { formatGameTime } from "./format";
import { usePolled } from "./usePolled";

interface Props {
  agent: AgentState;
  agents: AgentState[];
  world: World | null;
}

type T = ReturnType<typeof useI18n>["t"];

/** Barra de 0..1 accesible (rol meter). */
function Meter({ value, label }: { value: number; label: string }) {
  return (
    <div className="bar" title={`${label}: ${Math.round(value * 100)} %`}>
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

const hours = (min: number) => Math.round((min / 60) * 10) / 10;

/** El criterio en palabras (lo que el motor mide y cuánto lleva). */
function criterionText(
  t: T,
  c: GoalCriterion,
  done: number,
  person: (id: string) => string,
  place: (id: string) => string,
): string {
  const who = (personId?: string, people?: number) =>
    personId
      ? t("goals.who.person", { name: person(personId) })
      : people
        ? t("goals.who.people", { n: people })
        : "";
  switch (c.type) {
    case "activity_hours":
      return t("goals.c.activity_hours", {
        hours: c.hours,
        keywords: c.keywords.join(", "),
        done: hours(done),
      });
    case "place_time":
      return t("goals.c.place_time", {
        hours: c.hours,
        place: place(c.placeId),
        done: hours(done),
      });
    case "visits":
      return t("goals.c.visits", { count: c.count, place: place(c.placeId), done });
    case "relationship": {
      const target = [
        ...(c.affinity !== undefined ? [t("goals.rel.affinity", { v: c.affinity })] : []),
        ...(c.trust !== undefined ? [t("goals.rel.trust", { v: c.trust })] : []),
        ...(c.relationship ? [t(`rel.type.${c.relationship}` as MessageKey)] : []),
      ].join(", ");
      return t("goals.c.relationship", { person: person(c.personId), target });
    }
    case "meetings":
      return t("goals.c.meetings", { count: c.count, who: who(c.personId, c.people), done });
    case "conversations":
      return t("goals.c.conversations", {
        count: c.count,
        who: who(c.personId, c.people),
        where: c.placeId ? t("goals.where", { place: place(c.placeId) }) : "",
        done,
      });
    case "places_discovered":
      return t("goals.c.places_discovered", { count: c.count, done });
    case "items":
      return t("goals.c.items", {
        action: t(`goals.item.${c.action}` as MessageKey),
        count: c.count,
        done,
      });
    case "notes":
      return t("goals.c.notes", { count: c.count, done });
    case "intentions_kept":
      return t("goals.c.intentions_kept", { count: c.count, done });
    case "projects":
      return t("goals.c.projects", { count: c.count });
  }
}

/** Pestaña «Metas» del inspector: vital, proyectos y pasos, con progreso e historial. */
export function GoalsPanel({ agent, agents, world }: Props) {
  const { t } = useI18n();
  const data = usePolled<AgentGoalsResponse>(`/api/agents/${agent.id}/goals`, agent.id, 8000);
  if (!data) return <p className="muted small">{t("rel.loading")}</p>;
  const person = (id: string) => agents.find((a) => a.id === id)?.name ?? id;
  const place = (id: string) => world?.places.find((p) => p.id === id)?.name ?? id;
  const goals = data.goals;
  if (!goals.length) return <p className="muted small">{t("goals.none")}</p>;
  const open = (g: Goal) => g.status === "active" || g.status === "postponed";
  const kids = (id: string | null) => goals.filter((g) => g.parentId === id && open(g));
  const lives = goals.filter((g) => g.level === "life" && open(g));
  const orphans = goals.filter(
    (g) => g.level === "project" && open(g) && !goals.some((p) => p.id === g.parentId && open(p)),
  );
  const closed = goals
    .filter((g) => !open(g) || g.status === "postponed")
    .sort((a, b) => b.updatedAt - a.updatedAt);

  const card = (g: Goal, depth: number) => (
    <li
      key={g.id}
      className={`card goal goal-${g.level}`}
      style={{ marginInlineStart: depth * 12 }}
    >
      <div className="row">
        <b>{g.text}</b>
        <span className="tag">{t(`goals.level.${g.level}` as MessageKey)}</span>
        {g.status !== "active" && (
          <span className="tag">{t(`goals.status.${g.status}` as MessageKey)}</span>
        )}
      </div>
      <div className="small muted">
        {criterionText(t, g.criterion, g.measured, person, place)}
        {g.departure ? ` · ${t("goals.leaves", { to: g.departure.to })}` : ""}
        {g.resource ? ` · ${t("goals.resource", { what: g.resource.replace(/_/g, " ") })}` : ""}
      </div>
      <Meter label={t("goals.progress")} value={g.progress} />
      {g.level !== "step" && (
        <>
          <Meter label={t("goals.motivation")} value={g.motivation} />
          <Meter label={t("goals.frustration")} value={g.frustration} />
        </>
      )}
      {kids(g.id).length > 0 && <ul className="rel-list">{kids(g.id).map((k) => card(k, 1))}</ul>}
    </li>
  );

  return (
    <div className="goals">
      {agent.locationId === AWAY_LOCATION && <p className="small tag">{t("agent.away")}</p>}
      <ul className="rel-list">
        {lives.map((g) => card(g, 0))}
        {orphans.map((g) => card(g, 0))}
      </ul>
      <h4>{t("goals.history")}</h4>
      {closed.length === 0 ? (
        <p className="small muted">{t("goals.historyEmpty")}</p>
      ) : (
        <ul className="small">
          {closed.map((g) => {
            const last = g.history.at(-1);
            return (
              <li key={g.id}>
                <details>
                  <summary>
                    <span className="tag">{t(`goals.status.${g.status}` as MessageKey)}</span>{" "}
                    {g.text}
                    {last ? ` — ${last.reason}` : ""}
                  </summary>
                  <ol>
                    {g.history.map((h, i) => (
                      <li key={i}>
                        {formatGameTime(h.at)} · {t(`goals.status.${h.status}` as MessageKey)} ·{" "}
                        {Math.round(h.progress * 100)} % · {h.reason}
                      </li>
                    ))}
                  </ol>
                </details>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
