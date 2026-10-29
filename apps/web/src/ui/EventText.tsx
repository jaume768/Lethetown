import type { SimEvent } from "@lethetown/shared";
import { useI18n } from "../i18n";
import { actionBadge, withoutLeadingIcon } from "./icons";

/** Texto de un evento con la insignia de su acción (icono + nombre para lectores de pantalla). */
export function EventText({ event }: { event: Pick<SimEvent, "text" | "meta"> }) {
  const { t } = useI18n();
  const badge = actionBadge(event);
  if (!badge) return <>{event.text}</>;
  const label = t("action.label", { action: badge.action.replace(/_/g, " ") });
  return (
    <>
      <span className={`act-badge ${badge.ok ? "" : "failed"}`} title={label}>
        <span aria-hidden="true">{badge.ok ? badge.icon : "✗"}</span>
        <span className="sr-only">{badge.ok ? label : t("action.failed", { action: label })}</span>
      </span>{" "}
      {withoutLeadingIcon(withoutLeadingIcon(event.text, badge.icon), "✗")}
    </>
  );
}
