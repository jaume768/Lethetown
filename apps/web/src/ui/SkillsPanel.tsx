import type {
  AgentSkillsResponse,
  AgentState,
  LoreKind,
  LoreResponse,
  SkillState,
} from "@lethetown/shared";
import { useI18n, type MessageKey } from "../i18n";
import { formatGameTime } from "./format";
import { Meter } from "./GoalsPanel";
import { usePolled } from "./usePolled";

interface Props {
  agent: AgentState;
  agents: AgentState[];
}

/** «principiante», «se defiende», «bien», «con maestría» (como en el motor). */
export function levelKey(level: number): MessageKey {
  return level < 0.2
    ? "skills.level.novice"
    : level < 0.45
      ? "skills.level.fair"
      : level < 0.7
        ? "skills.level.good"
        : "skills.level.expert";
}

const hours = (min: number) => Math.round((min / 60) * 10) / 10;

/** Pestaña «Habilidades y saberes» del inspector: niveles con su evolución y lo que sabe contar. */
export function SkillsPanel({ agent, agents }: Props) {
  const { t } = useI18n();
  const skills = usePolled<AgentSkillsResponse>(`/api/agents/${agent.id}/skills`, agent.id, 8000);
  const lore = usePolled<LoreResponse>("/api/lore", "lore", 15_000);
  if (!skills) return <p className="muted small">{t("rel.loading")}</p>;
  const name = (id: string) => agents.find((a) => a.id === id)?.name ?? id;
  const label = (id: string) => skills.labels[id] ?? id;
  const mine = [...skills.skills].sort((a, b) => b.level - a.level);
  const held = (lore?.items ?? [])
    .map((x) => ({ lore: x.lore, holder: x.holders.find((h) => h.agentId === agent.id) }))
    .filter((x) => x.holder);

  const skillCard = (s: SkillState) => {
    const first = s.history[0]?.level ?? s.level;
    return (
      <li key={s.skill} className="card">
        <div className="row">
          <b>{label(s.skill)}</b>
          <span className="tag">{t(levelKey(s.level))}</span>
          {s.learnedFrom && (
            <span className="tag">{t("skills.learnedFrom", { name: name(s.learnedFrom) })}</span>
          )}
        </div>
        <Meter label={t("skills.level")} value={s.level} />
        <div className="small muted">
          {t("skills.evolution", {
            from: first.toFixed(2),
            to: s.level.toFixed(2),
            hours: hours(s.practiceMinutes),
          })}
          {s.lastUsedAt !== null
            ? ` · ${t("skills.lastUsed", { when: formatGameTime(s.lastUsedAt) })}`
            : ""}
        </div>
        {s.history.length > 1 && (
          <details className="small">
            <summary>{t("skills.history")}</summary>
            <ol>
              {s.history.map((h, i) => (
                <li key={i}>
                  {formatGameTime(h.at)} · {h.level.toFixed(2)} · {h.reason}
                </li>
              ))}
            </ol>
          </details>
        )}
      </li>
    );
  };

  return (
    <div className="skills">
      {mine.length === 0 ? (
        <p className="small muted">{t("skills.none")}</p>
      ) : (
        <ul className="rel-list">{mine.map(skillCard)}</ul>
      )}
      <h4>{t("lore.mine")}</h4>
      {held.length === 0 ? (
        <p className="small muted">{t("lore.none")}</p>
      ) : (
        <ul className="rel-list">
          {held.map(({ lore: l, holder: h }) => (
            <li key={l.id} className={`card${h!.forgottenAt !== null ? " muted" : ""}`}>
              <div className="row">
                <b>{l.title}</b>
                <span className="tag">{t(`lore.kind.${l.kind as LoreKind}` as MessageKey)}</span>
                {h!.learnedFrom && (
                  <span className="tag">
                    {t("skills.learnedFrom", { name: name(h!.learnedFrom) })}
                  </span>
                )}
                {h!.forgottenAt !== null && <span className="tag">{t("lore.forgotten")}</span>}
              </div>
              <Meter label={t("lore.fidelity")} value={h!.fidelity} />
              <ul className="small">
                {h!.elements.map((e) => (
                  <li key={e.id}>
                    {e.text}
                    {e.altered && <span className="tag">{t("lore.altered")}</span>}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
