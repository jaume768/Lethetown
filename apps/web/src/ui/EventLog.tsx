import type { SimEvent } from "@lethetown/shared";
import { useEffect, useRef } from "react";
import { formatGameTime } from "./format";

export function EventLog({ events }: { events: SimEvent[] }) {
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => end.current?.scrollIntoView({ block: "end" }), [events.length]);
  return (
    <section className="panel log">
      <h3>Eventos</h3>
      <div className="log-body">
        {events.map((e) => (
          <div key={e.id} className={`ev ev-${e.kind}`}>
            <span className="muted">{formatGameTime(e.time)}</span> {e.text}
          </div>
        ))}
        <div ref={end} />
      </div>
    </section>
  );
}
