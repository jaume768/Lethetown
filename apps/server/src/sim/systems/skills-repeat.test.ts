/**
 * Repetir la enseñanza (corrección 3.5): en la partida de una semana, Mateo y Hugo encadenaron 17
 * eventos de enseñanza de café y barra. Tope diario por pareja y habilidad y rendimientos
 * decrecientes en el vínculo y el drama.
 */
import type { SimEvent } from "@lethetown/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootstrap, type App } from "../../bootstrap";
import { loadConfig } from "../../config";
import { runAction } from "../actions";
import type { SimContext } from "../context";
import { DramaDetector } from "../dramas";
import {
  finishSession,
  mastersHere,
  mayRepeatSession,
  proposeSession,
  sessionsToday,
  skillsCfg,
  startSession,
} from "../skills";

let app: App;
let ctx: SimContext;
const agent = (id: string) => ctx.agents.get(id)!;
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

function bothAt(placeId: string, ...ids: string[]) {
  for (const id of ids) {
    const a = agent(id);
    a.state.locationId = placeId;
    a.state.tile = { ...ctx.world.place(placeId).anchor };
    a.state.activityKind = "idle";
    ctx.rt(id).travelling = false;
  }
}

/** Una sesión entera de Mateo a Hugo (café y barra). */
function session(now: number) {
  const v = proposeSession(
    ctx,
    {
      teacherId: "mateo",
      learnerId: "hugo",
      skill: "hospitality",
      proposedBy: "hugo",
      placeId: "cafe_ola",
    },
    now,
  );
  startSession(ctx, v, now);
  finishSession(ctx, v, now + skillsCfg(ctx).sessionMinutes);
  return events.filter((e) => e.meta?.action === "teach").at(-1)!;
}

describe("repetir la enseñanza", () => {
  it("la misma pareja y habilidad, como mucho N veces al día; luego no se ofrece", async () => {
    bothAt("cafe_ola", "mateo", "hugo");
    const now = ctx.clock.now();
    expect(mastersHere(ctx, agent("hugo"), now).some((m) => m.id === "mateo")).toBe(true);
    const first = session(now);
    expect(first.meta?.repeat).toBeUndefined();
    const second = session(now + 90);
    expect(second.meta?.repeat).toBe(2);
    expect(sessionsToday(ctx, "hugo", "mateo", "hospitality", now)).toBe(2);
    expect(mayRepeatSession(ctx, "mateo", "hugo", "hospitality", now)).toBe(false);
    // Ni «Aquí sabe más que tú», ni pedirlo, ni ofrecerlo.
    expect(mastersHere(ctx, agent("hugo"), now).some((m) => m.id === "mateo")).toBe(false);
    const asked = await runAction(
      { ctx, agent: agent("hugo"), now },
      { type: "ask_to_learn", who: "mateo", skill: "hospitality" },
    );
    expect(asked).toBe(false);
    // Otro día, vuelve a poder.
    expect(mayRepeatSession(ctx, "mateo", "hugo", "hospitality", now + 1440)).toBe(true);
  });

  it("cada repetición deja menos drama (la segunda ya no llega al mínimo)", () => {
    const dramas: number[] = [];
    let t = 0;
    const detector = new DramaDetector({
      now: () => t,
      name: (id) => id,
      placeOf: () => "cafe_ola",
    });
    detector.onDrama((d) => dramas.push(d.score));
    const base = { kind: "action" as const, agentId: "mateo", participants: ["mateo", "hugo"] };
    detector.onEvent({
      ...base,
      id: "t1",
      time: 0,
      text: "🧑‍🏫 enseña",
      meta: { action: "teach", ok: true },
    });
    t = 600;
    detector.onEvent({
      ...base,
      id: "t2",
      time: 600,
      text: "🧑‍🏫 enseña",
      meta: { action: "teach", ok: true, repeat: 2 },
    });
    // 0,55 → 0,275: por debajo de DRAMA_MIN_SCORE, ya no es un drama.
    expect(dramas).toEqual([0.55]);
  });
});
