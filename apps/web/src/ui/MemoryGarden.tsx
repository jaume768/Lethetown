import type { AgentMemoryResponse, AgentState, World } from "@lethetown/shared";
import { useEffect, useMemo, useState } from "react";
import { useI18n, type MessageKey } from "../i18n";
import { useAssets } from "../net/assets";
import { api } from "../net/store";
import { formatGameTime, formatMinuteOfDay } from "./format";
import { Portrait } from "./Portrait";

const REFRESH_MS = 3000;
/** Recuerdos por página del jardín. */
const PAGE = 40;

function Bar({ value, label }: { value: number; label: string }) {
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

interface Props {
  agent: AgentState | undefined;
  agents: AgentState[];
  world: World | null;
  thinkingTask: string | null;
  /** Modo Director: puede susurrar a la voz interior. */
  canIntervene: boolean;
}

/** Inspector del agente: estado, plan, fichas sociales y "jardín de recuerdos" con filtros. */
export function MemoryGarden({ agent, agents, world, thinkingTask, canIntervene }: Props) {
  const { t } = useI18n();
  const [data, setData] = useState<AgentMemoryResponse | null>(null);
  const [person, setPerson] = useState("");
  const [place, setPlace] = useState("");
  const [showForgotten, setShowForgotten] = useState(false);
  const [thought, setThought] = useState("");
  const [voiceMsg, setVoiceMsg] = useState<string | null>(null);
  const [pages, setPages] = useState(1);
  const agentId = agent?.id;
  const { pack } = useAssets();

  useEffect(() => setPages(1), [agentId]);
  useEffect(() => {
    if (!agentId) return;
    let cancelled = false;
    const load = async () => {
      try {
        const res = await api<AgentMemoryResponse>(
          `/api/agents/${agentId}/memory?limit=${PAGE * pages}`,
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
  }, [agentId, pages]);

  const names = useMemo(() => Object.fromEntries(agents.map((a) => [a.id, a.name])), [agents]);
  const memories = useMemo(
    () =>
      (data && data.agentId === agentId ? data.memories : []).filter(
        ({ memory: m, scores }) =>
          (showForgotten || scores.clarity !== "forgotten") &&
          m.status === "active" &&
          (!person || m.people.includes(person)) &&
          (!place || m.placeId === place),
      ),
    [data, agentId, person, place, showForgotten],
  );

  if (!agent) return <p className="muted readable">{t("agent.pick")}</p>;

  const sendThought = async () => {
    if (!thought.trim()) return;
    setVoiceMsg(null);
    try {
      await api(`/api/agents/${agent.id}/thought`, { text: thought.trim() });
      setThought("");
      setVoiceMsg(t("agent.voiceSent"));
    } catch (e) {
      setVoiceMsg(t("director.error", { error: e instanceof Error ? e.message : String(e) }));
    }
  };

  return (
    <div className="inspector">
      <div className="row inspector-head">
        <Portrait
          pack={pack}
          agentId={agent.id}
          name={agent.name}
          animation={agent.lastUtterance ? "talk" : thinkingTask ? "nod" : null}
        />
        <div>
          <h3>{agent.name}</h3>
          {thinkingTask && (
            <span className="thinking small" role="status">
              {t("agent.thinking", { task: thinkingTask })}
            </span>
          )}
        </div>
      </div>
      <div className="small">
        📍 {agent.locationId}
        {agent.targetId ? ` → ${agent.targetId}` : ""} · {agent.action}{" "}
        <span className="tag">{agent.activityKind}</span>
      </div>
      {agent.lastUtterance && (
        <blockquote className="readable says">«{agent.lastUtterance}»</blockquote>
      )}
      <div className="muted small">
        {t("agent.mood", { label: agent.mood.label, value: agent.mood.valence.toFixed(2) })}
      </div>
      <Bar label={t("agent.energy")} value={agent.needs.energy} />
      <Bar label={t("agent.hunger")} value={agent.needs.hunger} />
      <Bar label={t("agent.social")} value={agent.needs.social} />

      {canIntervene && (
        <>
          <h4>
            <label htmlFor="voice">{t("agent.voice")}</label>
          </h4>
          <div className="row">
            <input
              id="voice"
              className="field"
              maxLength={280}
              placeholder={t("agent.voicePlaceholder")}
              value={thought}
              onChange={(e) => setThought(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void sendThought()}
            />
            <button className="btn" onClick={() => void sendThought()}>
              {t("agent.voiceSend")}
            </button>
          </div>
          {voiceMsg && (
            <p className="small muted" role="status">
              {voiceMsg}
            </p>
          )}
        </>
      )}

      <h4>{t("agent.plan")}</h4>
      <ul className="plan readable">
        {agent.plan.map((p) => (
          <li key={p.startMinute}>
            {formatMinuteOfDay(p.startMinute)} · {p.activity}{" "}
            <span className="muted">
              ({p.placeId}
              {p.spotId ? `/${p.spotId}` : ""})
            </span>
          </li>
        ))}
      </ul>

      <h4>{t("agent.social.title")}</h4>
      <div className="social small">
        {(data?.social ?? []).length === 0 && (
          <span className="muted">{t("agent.social.none")}</span>
        )}
        {(data?.social ?? []).map((s) => (
          <div key={s.aboutId} className="card">
            <b>{names[s.aboutId] ?? s.aboutId}</b> ·{" "}
            {t("agent.social.line", { affinity: s.affinity.toFixed(2), trust: s.trust.toFixed(2) })}
            <div className="muted readable">{s.summary}</div>
          </div>
        ))}
      </div>

      <h4>{t("agent.garden")}</h4>
      <div className="filters small">
        <select
          className="field"
          aria-label={t("agent.allPeople")}
          value={person}
          onChange={(e) => setPerson(e.target.value)}
        >
          <option value="">{t("agent.allPeople")}</option>
          {agents
            .filter((a) => a.id !== agent.id)
            .map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
        </select>
        <select
          className="field"
          aria-label={t("agent.allPlaces")}
          value={place}
          onChange={(e) => setPlace(e.target.value)}
        >
          <option value="">{t("agent.allPlaces")}</option>
          {world?.places.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <label>
          <input
            type="checkbox"
            checked={showForgotten}
            onChange={(e) => setShowForgotten(e.target.checked)}
          />{" "}
          {t("agent.showForgotten")}
        </label>
      </div>
      <div className="small muted">
        {t("agent.working", { n: (data?.workingMemory ?? []).length })}
      </div>
      <div className="garden">
        {memories.map(({ memory: m, scores: s }) => (
          <div
            key={m.id}
            className={`card type-${m.type} clarity-${s.clarity}`}
            style={{ opacity: 0.3 + 0.7 * s.strength }}
            title={`total ${s.total.toFixed(2)} · recencia ${s.recency.toFixed(2)} · relevancia ${s.relevance.toFixed(2)} · ánimo ${s.moodMatch.toFixed(2)}`}
          >
            <div className="text readable">
              {s.clarity === "vague" && m.gist ? `… ${m.gist}` : m.text}
            </div>
            <div className="tags">
              <span className="tag">{t(`memory.type.${m.type}` as MessageKey)}</span>
              <span className="tag">{m.source}</span>
              <span className="tag">{t("memory.strength", { value: s.strength.toFixed(2) })}</span>
              <span className="tag">{t("memory.importance", { value: m.importance })}</span>
              {s.clarity !== "clear" && (
                <span className="tag">{t(`memory.clarity.${s.clarity}` as MessageKey)}</span>
              )}
              {m.links.length > 0 && <span className="tag">🔗 {m.links.length}</span>}
              <span className="tag">{formatGameTime(m.createdAt)}</span>
            </div>
          </div>
        ))}
      </div>
      {data && data.total > data.memories.length && (
        <button className="btn small" onClick={() => setPages(pages + 1)}>
          {t("agent.more", { shown: data.memories.length, total: data.total })}
        </button>
      )}

      <h4>{t("agent.audit")}</h4>
      <ul className="audit readable">
        {(data?.audit ?? []).slice(0, 15).map((a, i) => (
          <li key={`${a.memoryId}-${a.at}-${i}`}>
            {formatGameTime(a.at)} · {t(`memory.audit.${a.action}` as MessageKey)} «
            {a.memoryText.slice(0, 60)}» {t("agent.because")} {a.reason}
          </li>
        ))}
      </ul>
    </div>
  );
}
