import type { AgentMemoryResponse, AgentState, World } from "@lethetown/shared";
import { useEffect, useMemo, useState } from "react";
import { useAssets } from "../net/assets";
import { api } from "../net/store";
import { Portrait } from "./Portrait";
import { formatGameTime, formatMinuteOfDay } from "./format";

const REFRESH_MS = 3000;
const SOURCE_LABEL: Record<string, string> = { vivido: "vivido", inferido: "inferido" };
const TYPE_LABEL: Record<string, string> = {
  observation: "observación",
  reflection: "reflexión",
  plan: "plan",
  semantic: "conocimiento",
};
const AUDIT_LABEL: Record<string, string> = {
  forgotten: "olvidó",
  deleted: "borró",
  archived: "resumió",
  summarized: "resumió",
  gist: "solo recuerda la esencia de",
  reconsolidated: "reescribió",
  source_changed: "confundió la fuente de",
  weakened: "debilitó",
  reinforced: "reforzó",
};

function Bar({ value, label }: { value: number; label: string }) {
  return (
    <div className="bar" title={`${label}: ${value.toFixed(2)}`}>
      <span>{label}</span>
      <div className="bar-track">
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
}

/** Inspector del agente: estado, plan, fichas sociales y "jardín de recuerdos" con filtros. */
export function MemoryGarden({ agent, agents, world, thinkingTask }: Props) {
  const [data, setData] = useState<AgentMemoryResponse | null>(null);
  const [person, setPerson] = useState("");
  const [place, setPlace] = useState("");
  const [showForgotten, setShowForgotten] = useState(false);
  const [thought, setThought] = useState("");
  const agentId = agent?.id;
  const { pack } = useAssets();

  useEffect(() => {
    if (!agentId) return;
    let cancelled = false;
    const load = async () => {
      try {
        const res = await api<AgentMemoryResponse>(`/api/agents/${agentId}/memory?limit=80`);
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
  }, [agentId]);

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

  if (!agent) {
    return (
      <section className="panel muted">Haz clic en un agente del mapa para inspeccionarlo.</section>
    );
  }

  const sendThought = async () => {
    if (!thought.trim()) return;
    await api(`/api/agents/${agent.id}/thought`, { text: thought.trim() });
    setThought("");
  };

  return (
    <section className="panel inspector">
      <div className="row inspector-head">
        <Portrait
          pack={pack}
          agentId={agent.id}
          name={agent.name}
          animation={agent.lastUtterance ? "talk" : thinkingTask ? "nod" : null}
        />
        <div>
          <h3>{agent.name}</h3>
          {thinkingTask && <span className="thinking small">pensando… ({thinkingTask})</span>}
        </div>
      </div>
      <div className="small">
        📍 {agent.locationId}
        {agent.targetId ? ` → ${agent.targetId}` : ""} · {agent.action}{" "}
        <span className="tag">{agent.activityKind}</span>
      </div>
      <div className="muted small">
        Ánimo: {agent.mood.label} ({agent.mood.valence.toFixed(2)})
      </div>
      <Bar label="energía" value={agent.needs.energy} />
      <Bar label="hambre" value={agent.needs.hunger} />
      <Bar label="social" value={agent.needs.social} />

      <h4>Voz interior</h4>
      <div className="row">
        <input
          className="field"
          placeholder="Susúrrale un pensamiento…"
          value={thought}
          onChange={(e) => setThought(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void sendThought()}
        />
        <button className="btn" onClick={() => void sendThought()}>
          Enviar
        </button>
      </div>

      <h4>Plan</h4>
      <ul className="plan">
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

      <h4>Lo que piensa de los demás</h4>
      <div className="social small">
        {(data?.social ?? []).length === 0 && <span className="muted">Aún nada.</span>}
        {(data?.social ?? []).map((s) => (
          <div key={s.aboutId} className="card">
            <b>{names[s.aboutId] ?? s.aboutId}</b> · afinidad {s.affinity.toFixed(2)} · confianza{" "}
            {s.trust.toFixed(2)}
            <div className="muted">{s.summary}</div>
          </div>
        ))}
      </div>

      <h4>Jardín de recuerdos</h4>
      <div className="filters small">
        <select className="field" value={person} onChange={(e) => setPerson(e.target.value)}>
          <option value="">Todas las personas</option>
          {agents
            .filter((a) => a.id !== agent.id)
            .map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
        </select>
        <select className="field" value={place} onChange={(e) => setPlace(e.target.value)}>
          <option value="">Todos los lugares</option>
          {world?.places.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <label title="Mostrar olvidados">
          <input
            type="checkbox"
            checked={showForgotten}
            onChange={(e) => setShowForgotten(e.target.checked)}
          />{" "}
          🕳
        </label>
      </div>
      <div className="small muted">Memoria de trabajo: {(data?.workingMemory ?? []).length}/7</div>
      <div className="garden">
        {memories.map(({ memory: m, scores: s }) => (
          <div
            key={m.id}
            className={`card type-${m.type} clarity-${s.clarity}`}
            style={{ opacity: 0.3 + 0.7 * s.strength }}
            title={`total ${s.total.toFixed(2)} · recencia ${s.recency.toFixed(2)} · relevancia ${s.relevance.toFixed(2)} · ánimo ${s.moodMatch.toFixed(2)}`}
          >
            <div className="text">{s.clarity === "vague" && m.gist ? `… ${m.gist}` : m.text}</div>
            <div className="tags">
              <span className="tag">{TYPE_LABEL[m.type] ?? m.type}</span>
              <span className="tag">{SOURCE_LABEL[m.source] ?? m.source}</span>
              <span className="tag">fuerza {s.strength.toFixed(2)}</span>
              <span className="tag">imp. {m.importance}</span>
              {s.clarity !== "clear" && (
                <span className="tag">{s.clarity === "vague" ? "vago" : "olvidado"}</span>
              )}
              {m.links.length > 0 && <span className="tag">🔗 {m.links.length}</span>}
              <span className="tag">{formatGameTime(m.createdAt)}</span>
            </div>
          </div>
        ))}
      </div>

      <h4>Olvidos y cambios</h4>
      <ul className="audit">
        {(data?.audit ?? []).slice(0, 15).map((a, i) => (
          <li key={`${a.memoryId}-${a.at}-${i}`}>
            {formatGameTime(a.at)} · {AUDIT_LABEL[a.action] ?? a.action} «
            {a.memoryText.slice(0, 60)}» porque {a.reason}
          </li>
        ))}
      </ul>
    </section>
  );
}
