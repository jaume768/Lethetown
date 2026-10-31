/** Puente de la conversación a la acción: lo acordado hablando pasa por los manejadores formales. */
import { Agreement, type SimEvent } from "@lethetown/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { bootstrap, type App } from "../bootstrap";
import { loadConfig } from "../config";
import { agreementsState, applyAgreements, coveredBy } from "./agreements";
import type { SimContext } from "./context";
import { itemsState } from "./items";
import { meetingsState } from "./meetings";

let app: App;
let ctx: SimContext;
const events: SimEvent[] = [];

beforeAll(async () => {
  app = await bootstrap(
    loadConfig({ LLM_PROVIDER: "mock", EMBEDDINGS: "hash", DATABASE_URL: "", SIM_SEED: "7" }),
    () => {},
  );
  ctx = (app.defaultWorld.sim as unknown as { ctx: SimContext }).ctx;
  ctx.onEvent((e) => events.push(e));
});
afterAll(() => app.close());

/** Despierto y quieto en un sitio. */
function place(id: string, placeId: string) {
  const a = ctx.agents.get(id)!;
  a.state.locationId = placeId;
  a.state.activityKind = "talk";
  ctx.rt(id).travelling = false;
  ctx.rt(id).pending = [];
  return a;
}

beforeEach(() => {
  meetingsState(ctx).meetings.clear();
  agreementsState(ctx).done.clear();
  events.length = 0;
  (ctx.deps as { systems?: Record<string, boolean> }).systems = {};
  for (const id of ctx.agents.keys()) place(id, "casa_roja");
});

const agreement = (a: Partial<Agreement> & { type: string }) => Agreement.parse(a);
const conv = (id: string, people: string[]) => ({ id, people });

/** Lo último que dice la auditoría de un agente. */
async function lastAudit(agentId: string) {
  return (await ctx.deps.memory.store.audit(agentId, 5))[0];
}

describe("acuerdos: citas", () => {
  const meeting = agreement({
    type: "meeting",
    from: "lucia",
    to: ["mateo"],
    placeId: "cafe_ola",
    at: "18:00",
    day: "mañana",
    what: "tomar algo",
    quote: "Vale, mañana a las seis en el café.",
  });

  it("crea la cita aceptada por los dos, marcada como acordada hablando", async () => {
    place("lucia", "plaza");
    place("mateo", "plaza");
    const standing = await applyAgreements(ctx, conv("k1", ["lucia", "mateo"]), "lucia", [meeting]);
    expect(standing).toHaveLength(1);
    const [m] = [...meetingsState(ctx).meetings.values()];
    expect(m?.status).toBe("accepted");
    expect(m?.responses).toEqual({ lucia: "accepted", mateo: "accepted" });
    expect(m?.flags).toContain("agreed");
    expect(Object.keys(m?.intentions ?? {}).sort()).toEqual(["lucia", "mateo"]);
    const agreed = events.find((e) => e.meta?.agreed);
    expect(agreed?.meta).toMatchObject({ action: "propose_meeting", ok: true, agreed: true });
  });

  it("vale aunque uno ya se haya ido de la charla (estaba en ella)", async () => {
    place("lucia", "plaza");
    place("mateo", "plaza");
    ctx.rt("mateo").travelling = true;
    await applyAgreements(ctx, conv("k2", ["lucia", "mateo"]), "lucia", [meeting]);
    expect([...meetingsState(ctx).meetings.values()][0]?.status).toBe("accepted");
  });

  it("el otro lado de la charla no lo repite, y su intención se enlaza al compromiso", async () => {
    place("lucia", "plaza");
    place("mateo", "plaza");
    const people = ["lucia", "mateo"];
    await applyAgreements(ctx, conv("k3", people), "lucia", [meeting]);
    const other = await applyAgreements(ctx, conv("k3", people), "mateo", [
      agreement({ ...meeting, from: "mateo", to: ["lucia"] }),
    ]);
    expect(meetingsState(ctx).meetings.size).toBe(1);
    expect(other).toHaveLength(1);
    expect(coveredBy({ text: "quedar con Lucía en el café", personId: "lucia" }, other)).toBe(
      other[0],
    );
    expect(coveredBy({ text: "comprar pan", personId: "lucia" }, other)).toBeUndefined();
  });

  it("si ya habían quedado en esa franja, se descarta con el motivo en la auditoría", async () => {
    place("lucia", "plaza");
    place("mateo", "plaza");
    await applyAgreements(ctx, conv("k4", ["lucia", "mateo"]), "lucia", [meeting]);
    await applyAgreements(ctx, conv("k5", ["lucia", "mateo"]), "mateo", [
      agreement({ ...meeting, from: "mateo", to: ["lucia"], at: "18:30" }),
    ]);
    expect(meetingsState(ctx).meetings.size).toBe(1);
    const audit = await lastAudit("mateo");
    expect(audit).toMatchObject({ action: "agreement_discarded" });
    expect(audit?.reason).toMatch(/ya habían quedado/);
    // No es una percepción «No pude…»: nadie lo intentó a propósito.
    expect(ctx.rt("mateo").pending.some((p) => "text" in p && /No pude/.test(p.text))).toBe(false);
  });

  it("protección de menores: un adulto y un menor no quedan en una casa", async () => {
    place("sofia", "escuela");
    place("ines", "escuela");
    await applyAgreements(ctx, conv("k6", ["sofia", "ines"]), "sofia", [
      agreement({ type: "meeting", to: ["ines"], placeId: "casa_celeste", at: "17:00" }),
    ]);
    expect(meetingsState(ctx).meetings.size).toBe(0);
    expect((await lastAudit("sofia"))?.reason).toMatch(/sitio público/);
  });

  it("con quien no estaba en la charla no vale", async () => {
    await applyAgreements(ctx, conv("k7", ["lucia", "mateo", "carmen"]), "lucia", [
      agreement({ type: "meeting", to: ["hugo"], placeId: "cafe_ola", at: "18:00" }),
    ]);
    expect(meetingsState(ctx).meetings.size).toBe(0);
    expect((await lastAudit("lucia"))?.reason).toMatch(/con quién/);
  });
});

describe("acuerdos: objetos, invitaciones y tipos", () => {
  it("devolver lo prestado: lo hace quien lo tiene, con el mismo manejador", async () => {
    const book = [...itemsState(ctx).items.values()].find((i) => i.loan?.to === "lucia")!;
    place("lucia", "plaza");
    place("carmen", "plaza");
    await applyAgreements(ctx, conv("k8", ["lucia", "carmen"]), "carmen", [
      agreement({ type: "return", from: "carmen", to: ["lucia"], itemId: book.id }),
    ]);
    expect(book.loan).toBeNull();
    expect(book.holderId).toBe("carmen");
    expect(events.some((e) => e.meta?.agreed && e.meta.action === "return_item")).toBe(true);
  });

  it("prestar: lo presta quien lo lleva encima", async () => {
    const guitar = [...itemsState(ctx).items.values()].find((i) => i.ownerId === "hugo")!;
    place("hugo", "plaza");
    place("valentina", "plaza");
    await applyAgreements(ctx, conv("k9", ["hugo", "valentina"]), "valentina", [
      agreement({ type: "loan", from: "valentina", to: ["hugo"], itemId: guitar.id }),
    ]);
    expect(guitar.holderId).toBe("valentina");
    expect(guitar.loan?.from).toBe("hugo");
  });

  it("invitar a ir juntos ahora: si el otro ya se fue, no se puede", async () => {
    place("mateo", "plaza");
    place("lucia", "plaza");
    ctx.rt("lucia").travelling = true;
    await applyAgreements(ctx, conv("k10", ["mateo", "lucia"]), "mateo", [
      agreement({ type: "invite", from: "mateo", to: ["lucia"], placeId: "casa_roja" }),
    ]);
    expect((await lastAudit("mateo"))?.reason).toMatch(/no está aquí/);
  });

  it("un tipo que ningún sistema sabe hacer (pagar, todavía) se descarta", async () => {
    await applyAgreements(ctx, conv("k11", ["hugo", "valentina"]), "hugo", [
      agreement({ type: "pay", to: ["valentina"], what: "lo que le debo" }),
    ]);
    expect((await lastAudit("hugo"))?.reason).toMatch(/no hay acuerdos de tipo "pay"/);
  });

  it("con el sistema desactivado en el mundo, no se hace", async () => {
    (ctx.deps as { systems?: Record<string, boolean> }).systems = { meetings: false };
    await applyAgreements(ctx, conv("k12", ["lucia", "mateo"]), "lucia", [
      agreement({ type: "meeting", to: ["mateo"], placeId: "cafe_ola", at: "18:00" }),
    ]);
    expect(meetingsState(ctx).meetings.size).toBe(0);
    expect((await lastAudit("lucia"))?.reason).toMatch(/no se puede hacer en este pueblo/);
  });
});
