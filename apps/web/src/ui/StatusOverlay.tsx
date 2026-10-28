import type { WorldRunStatus } from "@lethetown/shared";
import { useI18n, type MessageKey } from "../i18n";

/** Pantalla de carga hasta que llega el primer snapshot. */
export function LoadingScreen() {
  const { t } = useI18n();
  return (
    <div className="loading" role="status" aria-live="polite">
      <div className="spinner" aria-hidden="true" />
      {t("app.loading")}
    </div>
  );
}

/** Aviso de conexión perdida / reconectando. */
export function ConnectionBanner({ connected, retries }: { connected: boolean; retries: number }) {
  const { t } = useI18n();
  if (connected) return null;
  return (
    <div className="banner warn" role="status" aria-live="polite">
      {retries > 1 ? t("conn.offline") : t("conn.reconnecting")}
    </div>
  );
}

/** Mundo en pausa: a pantalla completa si es por presupuesto o kill switch; si no, discreto. */
export function PausedOverlay({
  status,
  canResume,
  onResume,
}: {
  status: WorldRunStatus;
  canResume: boolean;
  onResume: () => void;
}) {
  const { t } = useI18n();
  if (status.state !== "paused" || !status.reason) return null;
  const blocking = status.reason === "budget" || status.reason === "kill_switch";
  const text = t(`status.${status.reason}` as MessageKey);
  return (
    <div className={blocking ? "paused-screen" : "banner"} role="status" aria-live="polite">
      <div className={blocking ? "panel paused-card" : undefined}>
        <strong>⏸ {t("status.paused")}</strong>
        <p className="readable">{text}</p>
        {blocking && status.detail && <p className="muted small">{status.detail}</p>}
        {canResume && !blocking && (
          <button className="btn small" onClick={onResume}>
            {t("status.resume")}
          </button>
        )}
      </div>
    </div>
  );
}
