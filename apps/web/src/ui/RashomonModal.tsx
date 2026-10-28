import type { RashomonResponse } from "@lethetown/shared";
import { useEffect, useState } from "react";
import { api } from "../net/store";
import { formatGameTime } from "./format";

const CLARITY_LABEL: Record<string, string> = {
  clear: "nítido",
  vague: "vago",
  forgotten: "olvidado",
};

/** Vista Rashomon: cómo recuerda un evento cada implicado y cómo ha cambiado su versión. */
export function RashomonModal({ eventId, onClose }: { eventId: string; onClose: () => void }) {
  const [data, setData] = useState<RashomonResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api<RashomonResponse>(`/api/rashomon/${encodeURIComponent(eventId)}`)
      .then((d) => !cancelled && setData(d))
      .catch((e: unknown) => !cancelled && setError(String(e)));
    return () => {
      cancelled = true;
    };
  }, [eventId]);

  return (
    <div className="modal-back" onClick={onClose}>
      <section className="panel modal" onClick={(e) => e.stopPropagation()}>
        <div className="row">
          <h3>Rashomon</h3>
          <button className="btn" onClick={onClose}>
            Cerrar
          </button>
        </div>
        {data?.event && (
          <p className="small">
            {formatGameTime(data.event.time)} · {data.event.text}
          </p>
        )}
        {error && <p className="small">{error}</p>}
        {data && data.accounts.length === 0 && (
          <p className="muted">Nadie guarda (ya) un recuerdo de este evento.</p>
        )}
        <div className="rashomon">
          {data?.accounts.map((acc) => (
            <div key={acc.agentId}>
              <h4>{acc.name} lo recuerda así</h4>
              <div className="garden">
                {acc.memories.map((m) => (
                  <div
                    key={m.memory.id}
                    className={`card type-${m.memory.type} clarity-${m.clarity}`}
                    style={{ opacity: 0.3 + 0.7 * m.strength }}
                  >
                    <div className="text">
                      {m.clarity === "vague" && m.memory.gist
                        ? `… ${m.memory.gist}`
                        : m.memory.text}
                    </div>
                    <div className="tags">
                      <span className="tag">{m.memory.source}</span>
                      <span className="tag">fuerza {m.strength.toFixed(2)}</span>
                      <span className="tag">{CLARITY_LABEL[m.clarity] ?? m.clarity}</span>
                    </div>
                    {m.versions.length > 0 && (
                      <ol className="versions">
                        {m.versions.map((v) => (
                          <li key={v.version}>
                            {formatGameTime(v.at)} · antes: «{v.text}» ({v.source}; {v.reason})
                          </li>
                        ))}
                      </ol>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
