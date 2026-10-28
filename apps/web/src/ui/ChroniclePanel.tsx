import type { Chronicle } from "@lethetown/shared";
import { useI18n } from "../i18n";

/** Crónicas del pueblo (una por día de juego; se escriben solas a las 23:00). */
export function ChroniclePanel({ chronicles }: { chronicles: Chronicle[] }) {
  const { t } = useI18n();
  const sorted = [...chronicles].sort((a, b) => b.day - a.day);
  if (sorted.length === 0) return <p className="muted readable">{t("chronicles.empty")}</p>;
  return (
    <div>
      {sorted.map((c) => (
        <article key={c.day} className="chronicle">
          <h4>
            {t("chronicles.day", { day: c.day })} · {c.title}
          </h4>
          <p className="readable">{c.text}</p>
        </article>
      ))}
    </div>
  );
}
