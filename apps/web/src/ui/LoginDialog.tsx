import { useState, type FormEvent } from "react";
import { useI18n } from "../i18n";
import { hasRole, login } from "../net/auth";
import { Modal } from "./Modal";

/** Entrar para el modo Director (la sesión va en una cookie httpOnly). */
export function LoginDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { t } = useI18n();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const user = await login(username.trim(), password);
      if (!hasRole(user, "director")) setError(t("auth.noRole"));
      else onDone();
    } catch {
      setError(t("auth.error"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={t("auth.title")} onClose={onClose} className="narrow">
      <form className="form" onSubmit={(e) => void submit(e)}>
        <p className="muted small">{t("auth.hint")}</p>
        <label>
          {t("auth.username")}
          <input
            className="field"
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
          />
        </label>
        <label>
          {t("auth.password")}
          <input
            className="field"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button className="btn primary" type="submit" disabled={busy}>
          {t("auth.login")}
        </button>
      </form>
    </Modal>
  );
}
