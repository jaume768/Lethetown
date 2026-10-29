import type { Drama } from "@lethetown/shared";
import { useState } from "react";
import { useI18n, type MessageKey } from "../i18n";
import { formatGameTime } from "./format";
import { copyText, permalink } from "./links";

interface Props {
  dramas: Drama[];
  /** Cámara al lugar y selección del primer implicado. */
  onGoTo: (d: Drama) => void;
  onOpenEvent: (eventId: string) => void;
  /** Versión compacta (overlay): sin botones. */
  compact?: boolean;
  limit?: number;
}

const ICON: Record<Drama["kind"], string> = {
  eavesdrop: "👂",
  rumor: "🗣",
  argument: "⚡",
  friendship: "💞",
  reconsolidation: "✎",
  forgetting: "🕳",
  false_memory: "🎭",
  intention_kept: "✅",
  intention_forgotten: "🫥",
  relationship: "🔀",
};

/** Feed de dramas: lo más interesante que ha pasado, con "Ir a verlo". */
export function DramaFeed({ dramas, onGoTo, onOpenEvent, compact, limit = 50 }: Props) {
  const { t } = useI18n();
  const [copied, setCopied] = useState<string | null>(null);
  if (dramas.length === 0) return <p className="muted readable">{t("dramas.empty")}</p>;
  return (
    <ol className={`dramas ${compact ? "compact" : ""}`} aria-label={t("dramas.title")}>
      {dramas.slice(0, limit).map((d) => (
        <li key={d.id} className={`drama drama-${d.kind}`}>
          <div className="drama-head">
            <span aria-hidden="true">{ICON[d.kind]}</span>
            <span className="tag">{t(`dramas.kind.${d.kind}` as MessageKey)}</span>
            <span className="muted small num">{formatGameTime(d.time)}</span>
            <span className="score" aria-hidden="true" style={{ width: `${d.score * 100}%` }} />
          </div>
          <div className="readable">{d.title}</div>
          {!compact && (
            <div className="wrap">
              <button className="btn small" onClick={() => onGoTo(d)}>
                {t("dramas.goto")}
              </button>
              {d.eventId && (
                <button className="btn small" onClick={() => onOpenEvent(d.eventId!)}>
                  {t("rashomon.title")}
                </button>
              )}
              <button
                className="btn small"
                onClick={() =>
                  void copyText(permalink({ drama: d.id, event: d.eventId ?? undefined })).then(
                    (ok) => ok && setCopied(d.id),
                  )
                }
              >
                {copied === d.id ? t("dramas.copied") : t("dramas.link")}
              </button>
            </div>
          )}
        </li>
      ))}
    </ol>
  );
}
