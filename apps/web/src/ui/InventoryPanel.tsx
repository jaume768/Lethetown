import type { AgentState, InventoryResponse, Item, World } from "@lethetown/shared";
import { useI18n } from "../i18n";
import { formatGameTime } from "./format";
import { itemIcon } from "./icons";
import { usePolled } from "./usePolled";

interface Props {
  agent: AgentState;
  agents: AgentState[];
  world: World | null;
}

/** Pestaña «Inventario» del inspector: lo que lleva, lo que ha prestado y lo suyo dejado por ahí. */
export function InventoryPanel({ agent, agents, world }: Props) {
  const { t } = useI18n();
  const data = usePolled<InventoryResponse>(`/api/agents/${agent.id}/inventory`, agent.id);
  if (!data) return <p className="muted small">{t("rel.loading")}</p>;
  const name = (id: string | null) =>
    (id && agents.find((a) => a.id === id)?.name.split(" ")[0]) ?? id ?? "";
  const place = (id: string | null) => world?.places.find((p) => p.id === id)?.name ?? id ?? "";
  const carried = data.items.filter((i) => i.holderId === agent.id);
  const lent = data.items.filter((i) => i.loan?.from === agent.id);
  const left = data.items.filter((i) => !i.holderId && i.ownerId === agent.id);

  const line = (i: Item, detail: string) => (
    <li key={i.id} className="card">
      <div className="row">
        <b>
          <span aria-hidden="true">{itemIcon(i.kind)}</span> {i.name}
        </b>
        {i.loan && (
          <span className={`tag ${data.now > i.loan.dueAt ? "warn" : ""}`}>
            {t("inventory.due", { when: formatGameTime(i.loan.dueAt) })}
          </span>
        )}
      </div>
      <div className="small muted readable">
        {detail}
        {i.description ? ` · ${i.description}` : ""}
      </div>
    </li>
  );

  return (
    <div className="inventory">
      <h4>{t("inventory.carried")}</h4>
      {carried.length ? (
        <ul className="rel-list">
          {carried.map((i) =>
            line(
              i,
              i.ownerId === agent.id
                ? t("inventory.own")
                : t("inventory.borrowed", { name: name(i.ownerId) }),
            ),
          )}
        </ul>
      ) : (
        <p className="muted small">{t("inventory.none")}</p>
      )}
      {lent.length > 0 && (
        <>
          <h4>{t("inventory.lent")}</h4>
          <ul className="rel-list">
            {lent.map((i) => line(i, t("inventory.lentTo", { name: name(i.loan!.to) })))}
          </ul>
        </>
      )}
      {left.length > 0 && (
        <>
          <h4>{t("inventory.left")}</h4>
          <ul className="rel-list">
            {left.map((i) => line(i, t("inventory.leftAt", { place: place(i.placeId) })))}
          </ul>
        </>
      )}
    </div>
  );
}
