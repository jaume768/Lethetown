import type { AgentMemoryResponse, AgentState } from "@lethetown/shared";
import { useEffect, useState } from "react";
import { formatMinuteOfDay } from "./format";

const REFRESH_MS = 3000;

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

export function AgentInspector({ agent }: { agent: AgentState | undefined }) {
  const [memory, setMemory] = useState<AgentMemoryResponse | null>(null);
  const agentId = agent?.id;

  useEffect(() => {
    if (!agentId) return;
    let cancelled = false;
    const load = async () => {
      const res = await fetch(`/api/agents/${agentId}/memory?limit=12`);
      if (res.ok && !cancelled) setMemory((await res.json()) as AgentMemoryResponse);
    };
    void load();
    const timer = setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [agentId]);

  if (!agent)
    return (
      <section className="panel muted">Haz clic en un agente del mapa para inspeccionarlo.</section>
    );

  return (
    <section className="panel inspector">
      <h3>{agent.name}</h3>
      <div>
        📍 {agent.locationId}
        {agent.targetId ? ` → ${agent.targetId}` : ""} · {agent.action}
      </div>
      <div className="muted">
        Ánimo: {agent.mood.label} ({agent.mood.valence.toFixed(2)})
      </div>
      <Bar label="energía" value={agent.needs.energy} />
      <Bar label="hambre" value={agent.needs.hunger} />
      <Bar label="social" value={agent.needs.social} />

      <h4>Plan</h4>
      <ul className="plan">
        {agent.plan.map((p) => (
          <li key={p.startMinute}>
            {formatMinuteOfDay(p.startMinute)} · {p.activity}{" "}
            <span className="muted">({p.placeId})</span>
          </li>
        ))}
      </ul>

      <h4>Memoria de trabajo</h4>
      <ul className="small">
        {(memory?.workingMemory ?? []).map((t, i) => (
          <li key={i}>{t}</li>
        ))}
      </ul>

      <h4>Recuerdos (por puntuación respecto a la acción actual)</h4>
      <table className="memories">
        <thead>
          <tr>
            <th>total</th>
            <th>fuerza</th>
            <th>imp.</th>
            <th>recuerdo</th>
          </tr>
        </thead>
        <tbody>
          {(memory?.memories ?? []).map(({ memory: m, scores: s }) => (
            <tr key={m.id} className={`clarity-${s.clarity}`}>
              <td>{s.total.toFixed(2)}</td>
              <td>{s.strength.toFixed(2)}</td>
              <td>{m.importance}</td>
              <td
                title={`${m.type} · ${m.source} · relevancia ${s.relevance.toFixed(2)} · recencia ${s.recency.toFixed(2)}`}
              >
                {m.text}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
