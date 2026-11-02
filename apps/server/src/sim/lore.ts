/**
 * Saberes del pueblo (sistema `lore`): recetas, técnicas, sitios, historias y canciones. Cada
 * vecino tiene su versión (`LoreHolder`); al contarlo (`share_lore`) quien escucha se queda con
 * una copia deformada según la lógica de agent-core (lore/lore.ts), sin LLM. Usarlo (practicar su
 * habilidad, ir a su sitio) lo refuerza; sin uso se olvida y, si nadie lo sabe ya con fidelidad
 * suficiente, se pierde para el pueblo. Ver docs/decisiones/lore.md.
 */
import { forgetLore, transmit, useLore, type Agent, type LoreConfig } from "@lethetown/agent-core";
import type { HeldElement, Lore, LoreHolder } from "@lethetown/shared";
import { InMemoryLoreStore, type LoreStore } from "../db/skills";
import { errorMessage, type SimContext } from "./context";
import { levelOf, skillsState, type PracticeTick } from "./skills";

/** Usar un saber cuenta, como mucho, una vez cada este rato (min de juego). */
const USE_COOLDOWN = 60;
/** Tras ofrecerle sus saberes en una decisión, no vuelven a salir en este rato (cuestan tokens). */
const DECIDE_COOLDOWN = 180;

export interface LoreState {
  lore: Map<string, Lore>;
  holders: Map<string, LoreHolder>;
  seq: number;
  store: LoreStore;
  lastDecayDay: number;
  counts: { transmissions: number; forgotten: number; lost: number; altered: number };
  listening: boolean;
  /** Cuándo se le ofrecieron sus saberes en una decisión. */
  shownAt: Map<string, number>;
}

const hkey = (loreId: string, agentId: string) => `${loreId}:${agentId}`;

export const loreState = (ctx: SimContext) =>
  ctx.state<LoreState>("lore", () => ({
    lore: new Map(),
    holders: new Map(),
    seq: 0,
    store: ctx.deps.lore ?? new InMemoryLoreStore(),
    lastDecayDay: -1,
    counts: { transmissions: 0, forgotten: 0, lost: 0, altered: 0 },
    listening: false,
    shownAt: new Map(),
  }));

export const loreCfg = (ctx: SimContext): LoreConfig => ctx.deps.memory.config.lore;
const firstName = (ctx: SimContext, id: string) =>
  ctx.agents.get(id)?.seed.name.split(" ")[0] ?? id;

function saveLore(ctx: SimContext, l: Lore): void {
  ctx.deps.track?.(
    loreState(ctx)
      .store.upsertLore(structuredClone(l))
      .catch((e: unknown) =>
        ctx.emit("system", null, `⚠ No se pudo guardar el saber: ${errorMessage(e)}`),
      ),
  );
}

function saveHolder(ctx: SimContext, h: LoreHolder): void {
  loreState(ctx).holders.set(hkey(h.loreId, h.agentId), h);
  ctx.deps.track?.(
    loreState(ctx)
      .store.upsertHolder(structuredClone(h))
      .catch((e: unknown) =>
        ctx.emit("system", h.agentId, `⚠ No se pudo guardar el saber: ${errorMessage(e)}`),
      ),
  );
}

function audit(ctx: SimContext, agentId: string, l: Lore, reason: string, now: number): void {
  ctx.deps.track?.(
    ctx.deps.memory.audit({
      agentId,
      memoryId: `lore:${l.id}`,
      memoryText: l.title,
      action: "lore",
      reason,
      at: now,
    }),
  );
}

/** Lo que sabe alguien (lo que aún recuerda). */
export function heldBy(ctx: SimContext, agentId: string): { lore: Lore; holder: LoreHolder }[] {
  const s = loreState(ctx);
  return [...s.holders.values()]
    .filter((h) => h.agentId === agentId && h.forgottenAt === null)
    .map((holder) => ({ lore: s.lore.get(holder.loreId)!, holder }))
    .filter((x) => x.lore && x.lore.lostAt === null);
}

export function holderOf(ctx: SimContext, loreId: string, agentId: string) {
  return loreState(ctx).holders.get(hkey(loreId, agentId));
}

/**
 * Siembra los saberes de partida. Uno con el mismo título en dos semillas es el mismo saber (cada
 * uno con su versión). El origen: el vecino o la persona de fuera de la semilla (`from`), si existe
 * (sin personas inventadas); si no, quien lo sabe.
 */
export function seedLore(ctx: SimContext, now: number): void {
  const s = loreState(ctx);
  const byTitle = new Map<string, Lore>();
  for (const agent of ctx.agents.values()) {
    for (const seed of agent.seed.lore) {
      let l = byTitle.get(seed.title);
      if (!l) {
        const offstage = agent.seed.offstagePeople.some((p) => p.name === seed.from);
        const neighbor = seed.from && ctx.agents.has(seed.from) ? seed.from : null;
        l = {
          id: `l${++s.seq}`,
          kind: seed.kind,
          title: seed.title,
          skill: seed.skill,
          placeId: seed.placeId && ctx.world.has(seed.placeId) ? seed.placeId : null,
          elements: seed.elements.map((e, i) => ({
            id: `e${i + 1}`,
            text: e.text,
            variants: e.variants,
          })),
          origin: {
            agentId: neighbor ?? (offstage ? null : agent.id),
            person: offstage ? seed.from : null,
          },
          createdAt: now,
          lostAt: null,
        };
        byTitle.set(seed.title, l);
        s.lore.set(l.id, l);
        saveLore(ctx, l);
      }
      saveHolder(ctx, {
        loreId: l.id,
        agentId: agent.id,
        fidelity: 0.9,
        elements: seed.elements.map((e, i) => ({ id: `e${i + 1}`, text: e.text, altered: false })),
        learnedFrom: seed.from && ctx.agents.has(seed.from) ? seed.from : null,
        learnedAt: now,
        lastUsedAt: now,
        forgottenAt: null,
      });
    }
  }
}

/** Cómo lo recuerda (para un recuerdo o el prompt): «Las magdalenas de Francisca: harina…; …». */
export function versionText(l: Lore, elements: HeldElement[]): string {
  return `${l.title}: ${elements.map((e) => e.text).join("; ")}`;
}

/**
 * Contar un saber a alguien: su versión, deformada según lo bien que lo sabe quien lo cuenta, su
 * habilidad en eso y la memoria de quien escucha. Si ya lo sabía peor, se queda con la nueva.
 * Devuelve lo que pasó (o null si no se quedó con nada).
 */
export function shareLore(
  ctx: SimContext,
  teller: Agent,
  listenerId: string,
  loreId: string,
  now: number,
): { kept: number; lost: number; altered: number } | null {
  const s = loreState(ctx);
  const l = s.lore.get(loreId);
  const t = holderOf(ctx, loreId, teller.id);
  const listener = ctx.agents.get(listenerId);
  if (!l || !t || !listener) return null;
  const profile = ctx.deps.memory.profileOf(listenerId);
  const r = transmit(
    {
      elements: t.elements,
      fidelity: t.fidelity,
      skillLevel: l.skill ? levelOf(ctx, teller.id, l.skill) : 0,
    },
    { forgetfulness: 1 / Math.max(0.3, profile.semanticStability) },
    l.elements,
    ctx.deps.rng,
    loreCfg(ctx),
  );
  s.counts.transmissions++;
  s.counts.altered += r.altered;
  // Contarlo también es usarlo.
  t.fidelity = useLore(t.fidelity, loreCfg(ctx));
  t.lastUsedAt = now;
  saveHolder(ctx, t);
  if (!r.elements.length) return null;
  const prev = holderOf(ctx, loreId, listenerId);
  if (prev && prev.forgottenAt === null && prev.fidelity >= r.fidelity) {
    prev.lastUsedAt = now;
    saveHolder(ctx, prev);
    return { kept: r.elements.length, lost: r.lost, altered: r.altered };
  }
  saveHolder(ctx, {
    loreId,
    agentId: listenerId,
    fidelity: r.fidelity,
    elements: r.elements,
    learnedFrom: teller.id,
    learnedAt: now,
    lastUsedAt: now,
    forgottenAt: null,
  });
  const how = [
    `${r.elements.length} de ${l.elements.length} cosas`,
    ...(r.altered ? [`${r.altered} cambiadas`] : []),
  ].join(", ");
  audit(
    ctx,
    listenerId,
    l,
    `lo aprendió de ${firstName(ctx, teller.id)}: ${how} (fidelidad ${r.fidelity.toFixed(2)})`,
    now,
  );
  // Lo recuerda con su versión (pasa por la protección de menores y por el PersonGuard).
  ctx.deps.track?.(
    ctx.deps.memory
      .tryRemember(
        {
          agentId: listenerId,
          text: `${teller.seed.name} me contó ${versionText(l, r.elements)}.`,
          type: "semantic",
          source: `contado por ${teller.id}`,
          importance: 5,
          people: [teller.id],
        },
        now,
      )
      .catch((e: unknown) =>
        ctx.emit("system", listenerId, `⚠ No se pudo guardar lo aprendido: ${errorMessage(e)}`),
      ),
  );
  return { kept: r.elements.length, lost: r.lost, altered: r.altered };
}

/** Practicar la habilidad de un saber (o estar en su sitio) lo refuerza. */
export function loreOnPractice(ctx: SimContext, p: PracticeTick): void {
  for (const { lore: l, holder: h } of heldBy(ctx, p.agent.id)) {
    const related = l.skill === p.skill || (l.placeId && l.placeId === p.agent.state.locationId);
    if (!related || (h.lastUsedAt !== null && p.now - h.lastUsedAt < USE_COOLDOWN)) continue;
    h.fidelity = useLore(h.fidelity, loreCfg(ctx));
    h.lastUsedAt = p.now;
    saveHolder(ctx, h);
  }
}

/** Al cambiar de día: lo que no se usa se olvida; un saber que ya no sabe nadie se pierde. */
export function loreTick(ctx: SimContext, now: number): void {
  const cfg = loreCfg(ctx);
  if (!cfg.enabled) return;
  const s = loreState(ctx);
  // Estar en el sitio de un saber (el sitio de pesca, la mejor luz) también es usarlo.
  for (const h of s.holders.values()) {
    const l = s.lore.get(h.loreId);
    const agent = ctx.agents.get(h.agentId);
    if (!l?.placeId || !agent || h.forgottenAt !== null || agent.state.locationId !== l.placeId)
      continue;
    if (agent.state.activityKind === "sleep") continue;
    if (h.lastUsedAt !== null && now - h.lastUsedAt < USE_COOLDOWN) continue;
    h.fidelity = useLore(h.fidelity, cfg);
    h.lastUsedAt = now;
    saveHolder(ctx, h);
  }
  const day = Math.floor(now / 1440);
  if (s.lastDecayDay < 0) s.lastDecayDay = day;
  if (day <= s.lastDecayDay) return;
  const days = day - s.lastDecayDay;
  s.lastDecayDay = day;
  for (const h of s.holders.values()) {
    const l = s.lore.get(h.loreId);
    if (!l || h.forgottenAt !== null || l.lostAt !== null) continue;
    const idle = (now - (h.lastUsedAt ?? h.learnedAt)) / 1440;
    const skill = l.skill ? levelOf(ctx, h.agentId, l.skill) : 0;
    const r = forgetLore(h, idle, days, skill, l.elements.length, ctx.deps.rng, cfg);
    if (r.fidelity === h.fidelity && !r.dropped) continue;
    h.fidelity = r.fidelity;
    h.elements = r.elements;
    if (r.dropped) {
      audit(
        ctx,
        h.agentId,
        l,
        `se le olvidó «${r.dropped.text}» (${Math.floor(idle)} días sin usarlo)`,
        now,
      );
    }
    if (h.fidelity < cfg.minFidelity) {
      h.forgottenAt = now;
      s.counts.forgotten++;
      audit(ctx, h.agentId, l, "ya no recuerda cómo era", now);
      ctx.emit(
        "action",
        h.agentId,
        `🕸 ${ctx.agents.get(h.agentId)?.seed.name ?? h.agentId} ya no recuerda cómo era «${l.title}»`,
        [h.agentId],
        undefined,
        { action: "lore", ok: false },
      );
    }
    saveHolder(ctx, h);
  }
  for (const l of s.lore.values()) {
    if (l.lostAt !== null) continue;
    const alive = [...s.holders.values()].some(
      (h) => h.loreId === l.id && h.forgottenAt === null && h.fidelity >= cfg.minFidelity,
    );
    if (alive) continue;
    l.lostAt = now;
    s.counts.lost++;
    saveLore(ctx, l);
    ctx.emit(
      "action",
      l.origin.agentId,
      `🕯 Se ha perdido para el pueblo: «${l.title}» (ya nadie lo recuerda bien)`,
      [...new Set([...s.holders.values()].filter((h) => h.loreId === l.id).map((h) => h.agentId))],
      undefined,
      { action: "lore_lost", ok: false },
    );
  }
}

/**
 * En la decisión, con alguien delante: los saberes que podría contar (ids para share_lore), como
 * mucho cada 3 h.
 */
export function loreLines(ctx: SimContext, agent: Agent, now: number): string[] {
  const s = loreState(ctx);
  const last = s.shownAt.get(agent.id);
  if (last !== undefined && now - last < DECIDE_COOLDOWN) return [];
  s.shownAt.set(agent.id, now);
  return heldBy(ctx, agent.id)
    .sort((a, b) => b.holder.fidelity - a.holder.fidelity)
    .slice(0, 3)
    .map(
      ({ lore: l, holder: h }) =>
        `${l.id} ${l.title} (${KIND_LABEL[l.kind]}${h.fidelity < 0.6 ? ", lo recuerdas a medias" : ""})`,
    );
}

const KIND_LABEL: Record<Lore["kind"], string> = {
  recipe: "receta",
  technique: "técnica",
  place: "sitio",
  story: "historia",
  song: "canción",
};

/** Para quien escucha cómo lo practica (los que siguen siendo del sistema skills). */
export function listenToPractice(ctx: SimContext): void {
  const s = loreState(ctx);
  if (s.listening) return;
  s.listening = true;
  skillsState(ctx).onPractice.push((p) => loreOnPractice(p.ctx, p));
}
