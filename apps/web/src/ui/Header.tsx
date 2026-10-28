import type { ClockState } from "@lethetown/shared";
import { LANGS, useI18n, type Lang } from "../i18n";
import type { User } from "../net/auth";
import { formatGameTime } from "./format";

export type Mode = "spectator" | "director";

interface Props {
  clock: ClockState;
  connected: boolean;
  mode: Mode;
  user: User | null;
  onMode: (m: Mode) => void;
  onLogin: () => void;
  onLogout: () => void;
  onHelp: () => void;
  onCredits: () => void;
}

export function Header(p: Props) {
  const { t, lang, setLang } = useI18n();
  return (
    <header className="header">
      <h1 className="brand">{t("app.title")}</h1>
      <span className="clock" aria-live="off">
        {formatGameTime(p.clock.time)}
        {p.clock.speed !== 1 && <span className="muted small"> · x{p.clock.speed}</span>}
      </span>
      <span className={p.connected ? "badge ok" : "badge off"} role="status">
        {p.connected ? t("conn.connected") : t("conn.reconnecting")}
      </span>
      <div className="spacer" />
      <div className="segmented" role="group" aria-label={t("mode.label")}>
        {(["spectator", "director"] as const).map((m) => (
          <button
            key={m}
            className={`btn small ${p.mode === m ? "active" : ""}`}
            aria-pressed={p.mode === m}
            onClick={() => p.onMode(m)}
          >
            {t(m === "spectator" ? "mode.spectator" : "mode.director")}
          </button>
        ))}
      </div>
      <select
        className="field compact"
        aria-label={t("common.language")}
        value={lang}
        onChange={(e) => setLang(e.target.value as Lang)}
      >
        {LANGS.map((l) => (
          <option key={l} value={l}>
            {l.toUpperCase()}
          </option>
        ))}
      </select>
      <button className="btn small" onClick={p.onHelp}>
        {t("onboarding.help")}
      </button>
      <button className="btn small" onClick={p.onCredits}>
        {t("credits.title")}
      </button>
      {p.user ? (
        <button
          className="btn small"
          onClick={p.onLogout}
          title={`${p.user.username} (${p.user.role})`}
        >
          {t("auth.logout")}
        </button>
      ) : (
        <button className="btn small" onClick={p.onLogin}>
          {t("auth.login")}
        </button>
      )}
    </header>
  );
}
