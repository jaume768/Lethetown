import type { AffinityIcon, AgentMemoryResponse, AgentState, World } from "@lethetown/shared";
import { useEffect, useMemo, useState } from "react";
import { t, useI18n, type MessageKey } from "../i18n";
import es from "../i18n/es";
import { useAssets } from "../net/assets";
import { api, gameTimeNow } from "../net/store";
import { formatGameTime, formatMinuteOfDay } from "./format";
import { filterMemories } from "./filters";
import { Portrait } from "./Portrait";
import { AgendaPanel } from "./AgendaPanel";
import { RelationshipsPanel } from "./RelationshipsPanel";
import { Tabs } from "./Tabs";

const REFRESH_MS = 3000;
/** Recuerdos por página del jardín. */
const PAGE = 40;

/** Barra de 0..1 (o de `min`..1, p. ej. la valencia de -1 a 1). */
function Bar({ value, label, min = 0 }: { value: number; label: string; min?: number }) {
  const fraction = (value - min) / (1 - min);
  return (
    <div className="bar" title={`${label}: ${value.toFixed(2)}`}>
      <span>{label}</span>
      <div
        className="bar-track"
        role="meter"
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={1}
        aria-valuenow={Number(value.toFixed(2))}
      >
        <div className="bar-fill" style={{ width: `${Math.round(fraction * 100)}%` }} />
      </div>
    </div>
  );
}

/** Etiqueta del ánimo (la pone el servidor en español) traducida si se conoce. */
function moodText(label: string): string {
  const key = `mood.${label}`;
  return key in es ? t(key as MessageKey) : label;
}

interface Props {
  agent: AgentState | undefined;
  agents: AgentState[];
  world: World | null;
  thinkingTask: string | null;
  /** Modo Director: puede susurrar a la voz interior. */
  canIntervene: boolean;
  /** Centra el mapa en alguien sin cambiar el inspector (`reveal`: y deja ver el mapa). */
  onFocus: (id: string, reveal?: boolean) => void;
  /** Abre la ficha de otra persona. */
  onSelectAgent: (id: string) => void;
  /** Marcas de afinidad sobre el mapa. */
  marksOn: boolean;
  onMarksOn: (on: boolean) => void;
  onMarks: (marks: Record<string, AffinityIcon> | null) => void;
  onOpenNetwork: () => void;
}

/** Inspector del agente: estado, plan, fichas sociales y "jardín de recuerdos" con filtros. */
export function MemoryGarden(props: Props) {
  const { agent, agents, world, thinkingTask, canIntervene } = props;
  const { onFocus, onSelectAgent, marksOn, onMarksOn, onMarks, onOpenNetwork } = props;
  const { t } = useI18n();
  const [view, setView] = useState<"mind" | "relations" | "agenda">("mind");
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

  const memories = useMemo(
    () =>
      filterMemories(data && data.agentId === agentId ? data.memories : [], {
        person,
        place,
        showForgotten,
      }),
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

  const placeName = (id: string) => world?.places.find((p) => p.id === id)?.name ?? id;
  const spotName = (id: string) =>
    world?.places.flatMap((p) => p.objects).find((o) => o.id === id)?.name ?? id;
  const minuteNow = Math.floor(gameTimeNow() % 1440);

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
        📍 {placeName(agent.locationId)}
        {agent.targetId ? ` → ${placeName(agent.targetId)}` : ""} · {agent.action}{" "}
        <span className="tag">{agent.activityKind}</span>
      </div>
      <Tabs
        tabs={[
          { id: "mind", label: t("inspector.mind") },
          { id: "relations", label: t("inspector.relations") },
          { id: "agenda", label: t("inspector.agenda") },
        ]}
        active={view}
        onChange={setView}
        label={t("inspector.label")}
      >
        {view === "agenda" ? (
          <AgendaPanel agent={agent} agents={agents} world={world} />
        ) : view === "relations" ? (
          <RelationshipsPanel
            agent={agent}
            onFocus={onFocus}
            onSelect={onSelectAgent}
            marksOn={marksOn}
            onMarksOn={onMarksOn}
            onMarks={onMarks}
            onOpenNetwork={onOpenNetwork}
          />
        ) : (
          <>
            {agent.lastUtterance && (
              <blockquote className="readable says">«{agent.lastUtterance}»</blockquote>
            )}
            <div className="muted small">
              {t("agent.mood", { label: moodText(agent.mood.label) })}
            </div>
            <Bar label={t("agent.moodValence")} value={agent.mood.valence} min={-1} />
            <Bar label={t("agent.moodArousal")} value={agent.mood.arousal} />
            <Bar label={t("agent.energy")} value={agent.needs.energy} />
            <Bar label={t("agent.hunger")} value={agent.needs.hunger} />
            <Bar label={t("agent.social")} value={agent.needs.social} />

            {agent.reasoning && (
              <section
                className={`reasoning ${agent.reasoning.innerVoice ? "voice" : ""}`}
                aria-label={t("agent.reasoning")}
              >
                <h4>
                  {t(agent.reasoning.innerVoice ? "agent.reasoningVoice" : "agent.reasoning")}{" "}
                  <span className="muted small num">{formatGameTime(agent.reasoning.at)}</span>
                </h4>
                <p className="readable">💭 {agent.reasoning.text}</p>
              </section>
            )}

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
              {agent.plan.map((p) => {
                const end = p.startMinute + p.durationMin;
                const now = minuteNow >= p.startMinute && minuteNow < end;
                const past = minuteNow >= end;
                return (
                  <li
                    key={`${p.startMinute}:${p.activity}`}
                    className={now ? "now" : past ? "past" : ""}
                    aria-current={now ? "true" : undefined}
                  >
                    {now ? "▶ " : ""}
                    <span className="num">{formatMinuteOfDay(p.startMinute)}</span> · {p.activity}{" "}
                    <span className="muted">
                      ({placeName(p.placeId)}
                      {p.spotId ? ` · ${spotName(p.spotId)}` : ""})
                    </span>
                    {p.replanned && <span className="tag changed">{t("agent.planChanged")}</span>}
                  </li>
                );
              })}
            </ul>

            <h4>{t("agent.doneToday")}</h4>
            <ul className="plan readable done-today">
              {(agent.doneToday ?? []).length === 0 && (
                <li className="muted">{t("agent.doneTodayNone")}</li>
              )}
              {(agent.doneToday ?? []).map((d) => (
                <li key={`${d.minute}:${d.activity}`}>
                  <span className="num">{formatMinuteOfDay(d.minute)}</span> · {d.activity}{" "}
                  <span className="muted">({placeName(d.placeId)})</span>
                </li>
              ))}
            </ul>

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
                    <span className="tag">
                      {t("memory.strength", { value: s.strength.toFixed(2) })}
                    </span>
                    <span className="tag">{t("memory.importance", { value: m.importance })}</span>
                    {s.clarity !== "clear" && (
                      <span className="tag">{t(`memory.clarity.${s.clarity}` as MessageKey)}</span>
                    )}
                    {m.meta.intention && (
                      <span className="tag">
                        {t(`memory.intention.${m.meta.intention.status}` as MessageKey)}
                      </span>
                    )}
                    {m.meta.falseMemory && (
                      <span className="tag warn">⚠ {t("memory.falseMemory")}</span>
                    )}
                    {m.links.length > 0 && <span className="tag">🔗 {m.links.length}</span>}
                    <span className="tag num">{formatGameTime(m.createdAt)}</span>
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
          </>
        )}
      </Tabs>
    </div>
  );
}
