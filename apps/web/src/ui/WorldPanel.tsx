import type { Weather, World } from "@lethetown/shared";
import { useState } from "react";
import { api } from "../net/store";

const WEATHERS: { id: Weather; label: string }[] = [
  { id: "sunny", label: "☀ sol" },
  { id: "cloudy", label: "☁ nubes" },
  { id: "rain", label: "🌧 lluvia" },
];
const PRESETS = ["rota", "recién arreglada", "humeante", "vacía", "idle"];

/** Intervención del jugador sobre el mundo: estado de los objetos y tiempo atmosférico. */
export function WorldPanel({ world, weather }: { world: World | null; weather: Weather }) {
  const spots =
    world?.places.flatMap((p) => p.objects.map((o) => ({ ...o, placeName: p.name }))) ?? [];
  const [spotId, setSpotId] = useState("");
  const [state, setState] = useState("rota");
  const selected = spots.find((s) => s.id === spotId);

  return (
    <section className="panel">
      <h3>Mundo</h3>
      <div className="wrap">
        {WEATHERS.map((w) => (
          <button
            key={w.id}
            className={`btn ${weather === w.id ? "active" : ""}`}
            onClick={() => void api("/api/world/weather", { weather: w.id })}
          >
            {w.label}
          </button>
        ))}
      </div>
      <h4>Objetos</h4>
      <select className="field" value={spotId} onChange={(e) => setSpotId(e.target.value)}>
        <option value="">Elige un objeto…</option>
        {spots.map((s) => (
          <option key={s.id} value={s.id}>
            {s.placeName} · {s.name} ({s.state})
          </option>
        ))}
      </select>
      <div className="row" style={{ marginTop: 6 }}>
        <input
          className="field"
          list="spot-states"
          value={state}
          onChange={(e) => setState(e.target.value)}
        />
        <datalist id="spot-states">
          {PRESETS.map((p) => (
            <option key={p} value={p} />
          ))}
        </datalist>
        <button
          className="btn"
          disabled={!selected || !state.trim()}
          onClick={() => void api(`/api/world/spots/${spotId}`, { state: state.trim() })}
        >
          Aplicar
        </button>
      </div>
    </section>
  );
}
