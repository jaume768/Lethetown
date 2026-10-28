import type { AssetInUse, Credit } from "@lethetown/shared";
import { useI18n } from "../i18n";
import { Modal } from "./Modal";

/** Créditos que exigen las licencias de los assets (manifest → `credits`). */
export function CreditsModal({ credits, onClose }: { credits: Credit[]; onClose: () => void }) {
  const { t } = useI18n();
  return (
    <Modal title={t("credits.title")} onClose={onClose}>
      <ul className="credits">
        {credits.map((c) => (
          <li key={c.id}>
            <a href={c.url} target="_blank" rel="noreferrer">
              <b>{c.name}</b>
            </a>{" "}
            — {c.author}
            {c.license === "non-commercial" && (
              <span className="tag warn">{t("credits.nonCommercial")}</span>
            )}
            {c.notice && <div className="muted small">{c.notice}</div>}
          </li>
        ))}
      </ul>
    </Modal>
  );
}

/** Aviso discreto (modo Director) si hay assets no comerciales en uso. */
export function NonCommercialNotice({ assets, label }: { assets: AssetInUse[]; label: string }) {
  if (assets.length === 0) return null;
  return (
    <div
      className="notice small"
      role="note"
      title={assets.map((a) => `${a.kind}: ${a.name}`).join("\n")}
    >
      {label}
    </div>
  );
}
