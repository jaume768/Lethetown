import type { AgentState, LoreKind, LoreResponse } from "@lethetown/shared";
import { useI18n, type MessageKey } from "../i18n";
import { formatGameTime } from "./format";
import { usePolled } from "./usePolled";

interface Props {
  agents: AgentState[];
  onSelect: (id: string) => void;
}

/**
 * «Saberes del pueblo»: quién sabe qué y cómo (la versión de cada uno, como el Rashomon de los
 * eventos) y los que se han perdido.
 */
export function LoreList({ agents, onSelect }: Props) {
  const { t } = useI18n();
  const data = usePolled<LoreResponse>("/api/lore", "lore", 15_000);
  if (!data?.items.length) return null;
  const name = (id: string) => agents.find((a) => a.id === id)?.name ?? id;
  const items = [...data.items].sort(
    (a, b) => (a.lore.lostAt === null ? 0 : 1) - (b.lore.lostAt === null ? 0 : 1),
  );
  return (
    <section className="lore" aria-labelledby="lore-title">
      <h4 id="lore-title">{t("lore.title")}</h4>
      <ul className="rel-list">
        {items.map(({ lore: l, holders }) => {
          const alive = holders.filter((h) => h.forgottenAt === null);
          return (
            <li key={l.id} className={`card${l.lostAt !== null ? " muted" : ""}`}>
              <details>
                <summary>
                  <b>{l.title}</b>{" "}
                  <span className="tag">{t(`lore.kind.${l.kind as LoreKind}` as MessageKey)}</span>{" "}
                  {l.lostAt !== null ? (
                    <span className="tag">
                      {t("lore.lost", { when: formatGameTime(l.lostAt) })}
                    </span>
                  ) : (
                    <span className="small muted">{t("lore.holders", { n: alive.length })}</span>
                  )}
                </summary>
                <div className="small muted">
                  {l.origin.person
                    ? t("lore.originPerson", { name: l.origin.person })
                    : l.origin.agentId
                      ? t("lore.originAgent", { name: name(l.origin.agentId) })
                      : ""}
                </div>
                <ol className="small">
                  {l.elements.map((e) => (
                    <li key={e.id}>{e.text}</li>
                  ))}
                </ol>
                <ul className="rel-list">
                  {holders.map((h) => (
                    <li key={h.agentId} className="small">
                      <button type="button" className="link" onClick={() => onSelect(h.agentId)}>
                        {name(h.agentId)}
                      </button>{" "}
                      ({Math.round(h.fidelity * 100)} %
                      {h.learnedFrom
                        ? `, ${t("skills.learnedFrom", { name: name(h.learnedFrom) })}`
                        : ""}
                      {h.forgottenAt !== null ? `, ${t("lore.forgotten")}` : ""}):{" "}
                      {h.elements.map((e) => (e.altered ? `«${e.text}»*` : e.text)).join("; ") ||
                        "—"}
                    </li>
                  ))}
                </ul>
              </details>
            </li>
          );
        })}
      </ul>
      <p className="small muted">{t("lore.legend")}</p>
    </section>
  );
}
