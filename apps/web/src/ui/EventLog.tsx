import type { SimEvent } from "@lethetown/shared";
import { useEffect, useRef, useState } from "react";
import { useI18n } from "../i18n";
import { api } from "../net/store";
import { EventText } from "./EventText";
import { formatGameTime } from "./format";

const RASHOMON_KINDS = new Set(["speech", "world", "thought"]);
const COLLAPSED_KEY = "lethetown.eventsCollapsed";

function savedCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

interface Props {
  events: SimEvent[];
  today: number;
  onOpenEvent: (id: string) => void;
  /** Con botón para plegarlo (escritorio: debajo del mapa). */
  collapsible?: boolean;
}

/** Log en vivo y línea de tiempo (eventos guardados por día y hora). */
export function EventLog({ events, today, onOpenEvent, collapsible = false }: Props) {
  const { t } = useI18n();
  const [collapsed, setCollapsed] = useState(() => collapsible && savedCollapsed());
  const toggle = () => {
    setCollapsed(!collapsed);
    try {
      localStorage.setItem(COLLAPSED_KEY, collapsed ? "0" : "1");
    } catch {
      /* no se recuerda: no pasa nada */
    }
  };
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
    <section className={`panel log ${collapsed ? "collapsed" : ""}`} aria-label={t("events.title")}>
      <div className="row">
        <h3>{mode === "live" ? t("events.title") : t("events.timeline")}</h3>
        <div className="wrap">
          {collapsible && (
            <button
              className="btn small"
              aria-expanded={!collapsed}
              aria-controls="event-log-body"
              onClick={toggle}
            >
              {collapsed ? "▸" : "▾"} {t(collapsed ? "events.expand" : "events.collapse")}
            </button>
          )}
          <button
            className={`btn small ${mode === "live" ? "active" : ""}`}
            aria-pressed={mode === "live"}
            onClick={() => setMode("live")}
          >
            {t("events.live")}
          </button>
          <button
            className={`btn small ${mode === "history" ? "active" : ""}`}
            aria-pressed={mode === "history"}
            onClick={() => {
              setDay(today);
              setMode("history");
            }}
          >
            {t("events.history")}
          </button>
        </div>
      </div>
      {mode === "history" && (
        <div className="timeline small">
          <button className="btn" aria-label="−1" onClick={() => setDay(Math.max(0, day - 1))}>
            ◀
          </button>
          <span>{t("events.day", { day })}</span>
          <button className="btn" aria-label="+1" onClick={() => setDay(Math.min(today, day + 1))}>
            ▶
          </button>
          <input
            aria-label={t("events.until", { hour: String(hour).padStart(2, "0") })}
            type="range"
            min={1}
            max={24}
            value={hour}
            onChange={(e) => setHour(Number(e.target.value))}
          />
          <span>{t("events.until", { hour: String(hour).padStart(2, "0") })}</span>
        </div>
      )}
      <div id="event-log-body" className="log-body readable" role="log" aria-live="off">
        {shown.map((e) => {
          const clickable = RASHOMON_KINDS.has(e.kind);
          const content = (
            <>
              <span className="muted num">{formatGameTime(e.time)}</span> <EventText event={e} />
            </>
          );
          return clickable ? (
            <button
              key={e.id}
              className={`ev ev-${e.kind} clickable`}
              title={t("events.rashomon")}
              onClick={() => onOpenEvent(e.id)}
            >
              {content}
            </button>
          ) : (
            <div key={e.id} className={`ev ev-${e.kind}`}>
              {content}
            </div>
          );
        })}
        {mode === "history" && shown.length === 0 && (
          <div className="muted">{t("events.none")}</div>
        )}
        <div ref={end} />
      </div>
    </section>
  );
}
