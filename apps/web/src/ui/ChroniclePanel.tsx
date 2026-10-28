import type { Chronicle } from "@lethetown/shared";
import { api } from "../net/store";

/** Crónicas del pueblo (una por día de juego, se escriben solas a las 23:00). */
export function ChroniclePanel({ chronicles, day }: { chronicles: Chronicle[]; day: number }) {
  const sorted = [...chronicles].sort((a, b) => b.day - a.day);
  return (
    <section className="panel">
      <div className="row">
        <h3>Crónicas</h3>
        <button className="btn small" onClick={() => void api(`/api/chronicles/${day}`, {})}>
          Escribir la de hoy
        </button>
      </div>
      {sorted.length === 0 && (
        <div className="muted small">Aún no hay crónicas: se escriben a las 23:00.</div>
      )}
      {sorted.map((c) => (
        <div key={c.day} className="chronicle">
          <b>
            Día {c.day} · {c.title}
          </b>
          <p>{c.text}</p>
        </div>
      ))}
    </section>
  );
}
