import { SIM_SPEEDS, type ClockState } from "@lethetown/shared";
import { send } from "../net/store";
import { formatGameTime } from "./format";

export function SpeedControls({
  clock,
  connected,
  provider,
}: {
  clock: ClockState;
  connected: boolean;
  provider: string;
}) {
  return (
    <section className="panel">
      <div className="row">
        <strong className="clock">{formatGameTime(clock.time)}</strong>
        <span className={connected ? "badge ok" : "badge off"}>
          {connected ? `conectado · ${provider}` : "desconectado"}
        </span>
      </div>
      <div className="speeds">
        {SIM_SPEEDS.map((s) => (
          <button
            key={s}
            className={`btn ${clock.speed === s ? "active" : ""}`}
            onClick={() => send({ type: "setSpeed", speed: s })}
          >
            {s === 0 ? "⏸" : `x${s}`}
          </button>
        ))}
      </div>
    </section>
  );
}
