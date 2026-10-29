import { SIM_SPEEDS, Weather } from "@lethetown/shared";
import { useEffect, useState } from "react";
import { useI18n, type MessageKey } from "../i18n";
import { useAssets } from "../net/assets";
import { hasRole, type User } from "../net/auth";
import { api, type GameState } from "../net/store";
import { NonCommercialNotice } from "./Credits";
import { formatUsd } from "./format";

const WEATHERS = Weather.options;
const PRESETS = ["rota", "recién arreglada", "humeante", "vacía", "idle"];

interface Props {
  game: GameState;
  user: User;
}

/** Modo Director: velocidad, pausa, clima, objetos, crónicas, métricas y (admin) costes y kill switch. */
export function DirectorPanel({ game, user }: Props) {
  const { t } = useI18n();
  const assets = useAssets();
  const [error, setError] = useState<string | null>(null);
  const [spotId, setSpotId] = useState("");
  const [spotState, setSpotState] = useState("rota");
  const [killed, setKilled] = useState(false);
  const admin = hasRole(user, "admin");
  useEffect(() => {
    if (!admin) return;
    void api<{ killed?: boolean }>("/api/admin/budget")
      .then((b) => setKilled(b.killed === true))
      .catch(() => undefined);
  }, [admin]);
  const spots =
    game.world?.places.flatMap((p) => p.objects.map((o) => ({ ...o, placeName: p.name }))) ?? [];
  const thinking = Object.values(game.thinking).filter((x) => x.count > 0).length;
  const total = game.costs?.total;
  const cacheRatio =
    total && total.inputTokens + total.cacheReadTokens > 0
      ? total.cacheReadTokens / (total.inputTokens + total.cacheReadTokens + total.cacheWriteTokens)
      : 0;

  const run = async (path: string, body: unknown = {}) => {
    setError(null);
    try {
      await api(path, body);
    } catch (e) {
      setError(t("director.error", { error: e instanceof Error ? e.message : String(e) }));
    }
  };

  return (
    <div className="director">
      <NonCommercialNotice
        assets={assets.nonCommercial}
        label={t("director.nonCommercial", { n: assets.nonCommercial.length })}
      />
      {error && (
        <p className="error small" role="alert">
          {error}
        </p>
      )}

      <h4>{t("director.speed")}</h4>
      <div className="speeds" role="group" aria-label={t("director.speed")}>
        {SIM_SPEEDS.map((s) => (
          <button
            key={s}
            className={`btn ${game.clock.speed === s ? "active" : ""}`}
            aria-pressed={game.clock.speed === s}
            onClick={() => void run("/api/speed", { speed: s })}
          >
            {s === 0 ? "⏸" : `x${s}`}
          </button>
        ))}
      </div>
      <div className="wrap">
        {game.status.state === "paused" ? (
          <button className="btn" onClick={() => void run("/api/resume")}>
            ▶ {t("director.resume")}
          </button>
        ) : (
          <button className="btn" onClick={() => void run("/api/pause")}>
            ⏸ {t("director.pause")}
          </button>
        )}
      </div>

      <h4>{t("director.world")}</h4>
      <div className="wrap" role="group" aria-label={t("director.world")}>
        {WEATHERS.map((w) => (
          <button
            key={w}
            className={`btn ${game.weather === w ? "active" : ""}`}
            aria-pressed={game.weather === w}
            onClick={() => void run("/api/world/weather", { weather: w })}
          >
            {t(`director.weather.${w}` as MessageKey)}
          </button>
        ))}
      </div>
      <h4>{t("director.objects")}</h4>
      <select
        className="field"
        aria-label={t("director.objects")}
        value={spotId}
        onChange={(e) => setSpotId(e.target.value)}
      >
        <option value="">{t("director.pickObject")}</option>
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
          aria-label={t("director.objects")}
          maxLength={280}
          value={spotState}
          onChange={(e) => setSpotState(e.target.value)}
        />
        <datalist id="spot-states">
          {PRESETS.map((p) => (
            <option key={p} value={p} />
          ))}
        </datalist>
        <button
          className="btn"
          disabled={!spotId || !spotState.trim()}
          onClick={() => void run(`/api/world/spots/${spotId}`, { state: spotState.trim() })}
        >
          {t("director.apply")}
        </button>
      </div>

      <h4>{t("chronicles.title")}</h4>
      <button
        className="btn small"
        onClick={() => void run(`/api/chronicles/${Math.floor(game.clock.time / 1440)}`)}
      >
        {t("chronicles.write")}
      </button>

      <h4>{t("director.metrics")}</h4>
      <div className="small">{t("director.thinking", { n: thinking })}</div>
      {total && (
        <div className="small">
          {t("director.calls", { calls: total.calls, cache: `${Math.round(cacheRatio * 100)} %` })}
        </div>
      )}
      {admin && total && (
        <>
          <h4>{t("director.cost")}</h4>
          <div className="cost">{formatUsd(total.usd)}</div>
          <div className="muted small">
            {Object.entries(game.costs?.byTask ?? {})
              .map(([task, b]) => `${task}: ${b.calls} (${formatUsd(b.usd)})`)
              .join(" · ")}
          </div>
          <h4>{t("director.kill")}</h4>
          <button
            className={`btn ${killed ? "active" : "danger"}`}
            onClick={() => {
              if (!killed && !window.confirm(t("director.killConfirm"))) return;
              void run("/api/admin/kill", { on: !killed }).then(() => setKilled(!killed));
            }}
          >
            {killed ? t("director.killOff") : t("director.killOn")}
          </button>
        </>
      )}
    </div>
  );
}
