import type { SimEvent } from "@lethetown/shared";
import { useEffect, useRef, useState } from "react";
import { api } from "../net/store";
import { formatGameTime } from "./format";

const RASHOMON_KINDS = new Set(["speech", "world", "thought"]);

interface Props {
  events: SimEvent[];
  today: number;
  onOpenEvent: (id: string) => void;
}

/** Log en vivo y línea de tiempo (eventos guardados por día y hora). */
export function EventLog({ events, today, onOpenEvent }: Props) {
  const end = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<"live" | "history">("live");
  const [day, setDay] = useState(today);
  const [hour, setHour] = useState(24);
  const [history, setHistory] = useState<SimEvent[]>([]);

  useEffect(() => {
    if (mode === "live") end.current?.scrollIntoView({ block: "end" });
  }, [events.length, mode]);

  useEffect(() => {
    if (mode !== "history") return;
    let cancelled = false;
    void api<SimEvent[]>(`/api/events?day=${day}&limit=3000`).then(
      (e) => !cancelled && setHistory(e),
    );
    return () => {
      cancelled = true;
    };
  }, [mode, day]);

  const shown = mode === "live" ? events : history.filter((e) => e.time % 1440 < hour * 60);

  return (
    <section className="panel log">
      <div className="row">
        <h3>{mode === "live" ? "Eventos" : "Línea de tiempo"}</h3>
        <div className="wrap">
          <button
            className={`btn small ${mode === "live" ? "active" : ""}`}
            onClick={() => setMode("live")}
          >
            En vivo
          </button>
          <button
            className={`btn small ${mode === "history" ? "active" : ""}`}
            onClick={() => {
              setDay(today);
              setMode("history");
            }}
          >
            Historial
          </button>
        </div>
      </div>
      {mode === "history" && (
        <div className="timeline small">
          <button className="btn" onClick={() => setDay(Math.max(0, day - 1))}>
            ◀
          </button>
          <span>Día {day}</span>
          <button className="btn" onClick={() => setDay(Math.min(today, day + 1))}>
            ▶
          </button>
          <input
            type="range"
            min={1}
            max={24}
            value={hour}
            onChange={(e) => setHour(Number(e.target.value))}
          />
          <span>hasta las {String(hour).padStart(2, "0")}:00</span>
        </div>
      )}
      <div className="log-body">
        {shown.map((e) => {
          const clickable = RASHOMON_KINDS.has(e.kind);
          return (
            <div
              key={e.id}
              className={`ev ev-${e.kind} ${clickable ? "clickable" : ""}`}
              title={clickable ? "Ver cómo lo recuerda cada uno (Rashomon)" : undefined}
              onClick={clickable ? () => onOpenEvent(e.id) : undefined}
            >
              <span className="muted">{formatGameTime(e.time)}</span> {e.text}
            </div>
          );
        })}
        {mode === "history" && shown.length === 0 && (
          <div className="muted">Sin eventos guardados.</div>
        )}
        <div ref={end} />
      </div>
    </section>
  );
}
