/**
 * Inventario: objetos que los agentes llevan encima, con dueño y préstamos (ver
 * sim/actions/items.ts). Viven en el estado del sistema (`itemsState`, en la instantánea) y se
 * escriben en `inventory_items` en cada cambio. Un préstamo que vence sin devolverse lo nota el dueño.
 */
import { applySocialUpdate, type Agent } from "@lethetown/agent-core";
import { verbsFor, type Item } from "@lethetown/shared";
import type { SimContext } from "./context";

/** Afinidad que pierde el dueño hacia quien no le devuelve algo a tiempo. */
const OVERDUE_AFFINITY = -0.05;

const firstName = (ctx: SimContext, id: string | null) =>
  (id && ctx.agents.get(id)?.seed.name.split(" ")[0]) ?? id ?? "nadie";

/** Estado del inventario: los objetos y su contador ("i1", "i2"…). */
export interface ItemsState {
  items: Map<string, Item>;
  seq: number;
}

export const itemsState = (ctx: SimContext) =>
  ctx.state<ItemsState>("items", () => ({ items: new Map(), seq: 0 }));

export function newItemId(ctx: SimContext): string {
  return `i${++itemsState(ctx).seq}`;
}

/** Guarda el objeto en el runtime y lo escribe (en segundo plano). */
export function saveItem(ctx: SimContext, item: Item, touch = true): void {
  if (touch) item.updatedAt = ctx.clock.now();
  itemsState(ctx).items.set(item.id, item);
  const write = ctx.itemStore
    .upsert(structuredClone(item))
    .catch((e: unknown) =>
      ctx.emit("system", null, `⚠ No se pudo guardar el objeto: ${String(e)}`),
    );
  ctx.deps.track?.(write);
}

/**
 * Carga los objetos al arrancar: los de la instantánea si se restauró, si no los guardados y, en
 * un mundo nuevo, los de las semillas (con sus préstamos).
 */
export function loadItems(ctx: SimContext, stored: Item[], now: number): void {
  // Restaurados de la instantánea: se vuelven a guardar (el almacén sigue a la instantánea).
  const state = itemsState(ctx);
  if (state.items.size) {
    for (const item of state.items.values()) saveItem(ctx, item, false);
    return;
  }
  if (stored.length) {
    for (const i of stored) state.items.set(i.id, i);
    state.seq = Math.max(state.seq, ...stored.map((i) => Number(i.id.slice(1)) || 0));
    return;
  }
  for (const seed of ctx.deps.seeds) {
    for (const s of seed.items) {
      const lent = s.lentTo && ctx.agents.has(s.lentTo) ? s.lentTo : null;
      saveItem(ctx, {
        id: newItemId(ctx),
        kind: s.kind,
        name: s.name,
        description: s.description,
        ownerId: seed.id,
        holderId: lent ?? seed.id,
        placeId: null,
        loan: lent
          ? {
              from: seed.id,
              to: lent,
              since: now,
              dueAt: now + s.dueInDays * 1440,
              overdueNoticed: false,
            }
          : null,
        value: s.value,
        createdAt: now,
        updatedAt: now,
      });
    }
  }
}

/** "libro de poemas (de Carmen; te lo prestó: devuélveselo antes del día 2)". */
function carriedLine(ctx: SimContext, agent: Agent, item: Item): string {
  const whose =
    item.ownerId === agent.id
      ? "tuyo"
      : item.ownerId
        ? `de ${firstName(ctx, item.ownerId)}`
        : "de nadie";
  const loan =
    item.loan?.to === agent.id
      ? `; te lo prestó: devuélveselo antes del día ${Math.floor(item.loan.dueAt / 1440)}`
      : "";
  return `${item.id} ${item.name} (${whose}${loan})`;
}

/** Secciones del prompt de decidir: lo que lleva, lo que ha prestado, lo que hay aquí y qué puede usar. */
export function inventorySections(
  ctx: SimContext,
  agent: Agent,
): { title: string; lines: string[] }[] {
  const items = [...itemsState(ctx).items.values()];
  const here = agent.state.locationId;
  const place = ctx.world.place(here);
  return [
    {
      title: "LLEVAS",
      lines: items.filter((i) => i.holderId === agent.id).map((i) => carriedLine(ctx, agent, i)),
    },
    {
      title: "HAS PRESTADO",
      lines: items
        .filter((i) => i.loan?.from === agent.id)
        .map(
          (i) =>
            `${i.id} ${i.name}: lo tiene ${firstName(ctx, i.loan!.to)} (hasta el día ${Math.floor(i.loan!.dueAt / 1440)})`,
        ),
    },
    {
      title: "AQUÍ HAY",
      lines: items
        .filter((i) => !i.holderId && i.placeId === here)
        .map(
          (i) =>
            `${i.id} ${i.name} (${i.ownerId === agent.id ? "tuyo" : i.ownerId ? `de ${firstName(ctx, i.ownerId)}` : "de nadie"})`,
        ),
    },
    {
      title: "PUEDES USAR",
      lines: place.objects.flatMap((o) =>
        verbsFor(o.id, o.state).map((v) => `${o.id}: ${v.verb} (${v.label})`),
      ),
    },
  ];
}

/** Préstamos vencidos: el dueño lo nota (una vez), le sienta mal y queda un drama. */
export async function itemsTick(ctx: SimContext, now: number): Promise<void> {
  for (const item of itemsState(ctx).items.values()) {
    const loan = item.loan;
    if (!loan || loan.overdueNoticed || now < loan.dueAt) continue;
    loan.overdueNoticed = true;
    saveItem(ctx, item);
    const owner = ctx.agents.get(loan.from);
    const borrower = ctx.agents.get(loan.to);
    if (!owner || !borrower) continue;
    ctx.rt(owner.id).pending.push({
      kind: "world",
      text: `${borrower.seed.name} todavía no me ha devuelto ${item.name} (${item.id}).`,
      placeId: null,
    });
    await applySocialUpdate(ctx.deps.social, {
      ownerId: owner.id,
      aboutId: borrower.id,
      affinityDelta: OVERDUE_AFFINITY,
      now,
      reason: `no me ha devuelto ${item.name}`,
      config: ctx.deps.memory.config.social,
    });
    ctx.emit(
      "action",
      borrower.id,
      `📕 ${borrower.seed.name} aún no le ha devuelto a ${owner.seed.name} ${item.name}`,
      [borrower.id, owner.id],
      undefined,
      { action: "loan", ok: false },
    );
  }
}
