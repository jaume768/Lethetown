/**
 * Registro de sistemas: cada uno se registra al importarse (sim/systems/index.ts fija el orden) y
 * la simulación solo recorre el registro: instantánea, carga, revisiones periódicas, prompt,
 * plan y acciones. El orden de registro es el orden en que corren (y el del test dorado).
 */
import type { Agent } from "@lethetown/agent-core";
import type { ActionType, AgentAction, PlanItem } from "@lethetown/shared";
import type { SimContext } from "../context";
import type { WorldMap } from "../world";
import type { AgreementKind, PromptSection, SimSystem } from "./types";

const SYSTEMS: SimSystem[] = [];
const ACTION_OWNER = new Map<ActionType, string>();
const AGREEMENTS = new Map<string, { kind: AgreementKind; system: string }>();

export function registerSystem<S>(system: SimSystem<S>): void {
  if (SYSTEMS.some((s) => s.id === system.id)) {
    throw new Error(`Sistema duplicado: ${system.id}`);
  }
  for (const type of system.actions ?? []) {
    const owner = ACTION_OWNER.get(type);
    if (owner) throw new Error(`La acción ${type} ya es del sistema ${owner}`);
    ACTION_OWNER.set(type, system.id);
  }
  for (const kind of system.agreements ?? []) {
    const owner = AGREEMENTS.get(kind.type);
    if (owner) throw new Error(`El acuerdo ${kind.type} ya es del sistema ${owner.system}`);
    AGREEMENTS.set(kind.type, { kind, system: system.id });
  }
  SYSTEMS.push(system as SimSystem);
  system.mock?.();
}

/** Todos los sistemas, en orden de registro. */
export function registeredSystems(): readonly SimSystem[] {
  return SYSTEMS;
}

/** Los activos en este mundo. */
export function activeSystems(ctx: SimContext): SimSystem[] {
  return SYSTEMS.filter((s) => ctx.enabled(s.id));
}

/** De qué sistema es una acción (las del núcleo, como `say`, no son de ninguno). */
export function systemOfAction(type: ActionType): string | undefined {
  return ACTION_OWNER.get(type);
}

/** Quién lleva a cabo un tipo de acuerdo hablado (y de qué sistema es), si alguien sabe. */
export function agreementKind(type: string): { kind: AgreementKind; system: string } | undefined {
  return AGREEMENTS.get(type);
}

/** Tipos de acuerdo que saben llevar a cabo los sistemas registrados. */
export function agreementTypes(): string[] {
  return [...AGREEMENTS.keys()];
}

/** ¿Se puede usar la acción en este mundo? (su sistema, si lo tiene, está activo). */
export function actionEnabled(ctx: SimContext, type: ActionType): boolean {
  const owner = ACTION_OWNER.get(type);
  return !owner || ctx.enabled(owner);
}

/** Parte de los sistemas en la instantánea: id → { versión, datos }. */
export type SystemsSnapshot = Record<string, { version: number; data: unknown }>;

export function snapshotSystems(ctx: SimContext): SystemsSnapshot {
  const out: SystemsSnapshot = {};
  for (const s of activeSystems(ctx)) {
    if (s.snapshot) out[s.id] = { version: s.snapshot.version, data: s.snapshot.save(ctx) };
  }
  return out;
}

/**
 * Restaura lo de cada sistema. Devuelve cuáles se restauraron y cuáles no se pudieron (otra
 * versión o datos que no validan): esos arrancan limpios, el resto del mundo sí se restaura.
 */
export function restoreSystems(
  ctx: SimContext,
  saved: SystemsSnapshot,
): { restored: string[]; skipped: string[] } {
  const restored: string[] = [];
  const skipped: string[] = [];
  for (const s of activeSystems(ctx)) {
    const part = saved[s.id];
    if (!s.snapshot || !part) continue;
    const parsed = s.snapshot.schema.safeParse(part.data);
    if (part.version !== s.snapshot.version || !parsed.success) {
      skipped.push(s.id);
      continue;
    }
    s.snapshot.restore(ctx, parsed.data);
    restored.push(s.id);
  }
  return { restored, skipped };
}

/**
 * Carga de cada sistema al abrir el mundo (en orden). `restored`: los que vienen de la
 * instantánea (su almacén sigue a la instantánea, no al revés).
 */
export async function loadSystems(
  ctx: SimContext,
  restored: ReadonlySet<string>,
  now: number,
): Promise<void> {
  for (const s of activeSystems(ctx)) await s.load?.(ctx, { restored: restored.has(s.id), now });
}

/**
 * Programa las revisiones periódicas: las de un mismo intervalo, juntas y en orden de registro
 * (cada una espera a la anterior). Solo se espera lo que devuelve una promesa: un `await` de
 * más cambia el orden de las tareas del mock (y el dorado).
 */
export function scheduleSystemTicks(ctx: SimContext, from: number): void {
  const byEvery = new Map<number, SimSystem[]>();
  for (const s of activeSystems(ctx)) {
    if (!s.tick) continue;
    byEvery.set(s.tick.every, [...(byEvery.get(s.tick.every) ?? []), s]);
  }
  for (const [every, group] of byEvery) {
    const schedule = (after: number) => {
      const next = (Math.floor(after / every) + 1) * every;
      ctx.clock.schedule(next, async () => {
        for (const s of group) {
          const r = s.tick!.run(ctx, next);
          if (r) await r;
        }
        schedule(next);
      });
    };
    schedule(from);
  }
}

/** Secciones del prompt de decidir de todos los sistemas, por su `order` (estable). */
export function systemSections(ctx: SimContext, agent: Agent, now: number): PromptSection[] {
  return activeSystems(ctx)
    .flatMap((s) => s.promptSections?.(ctx, agent, now) ?? [])
    .map((section, i) => ({ section, i }))
    .sort((a, b) => (a.section.order ?? 50) - (b.section.order ?? 50) || a.i - b.i)
    .map(({ section }) => section);
}

/** Líneas fijas (cacheables) que los sistemas activos añaden al prompt de identidad. */
export function systemIdentityLines(
  world: WorldMap,
  enabled: (id: string) => boolean = () => true,
): string[] {
  return SYSTEMS.filter((s) => enabled(s.id)).flatMap((s) => s.identityLines?.(world) ?? []);
}

/** Huecos fijos del plan de un día (citas aceptadas…). */
export function systemFixedPlan(ctx: SimContext, agent: Agent, day: number): PlanItem[] {
  return activeSystems(ctx).flatMap((s) => s.fixedPlan?.(ctx, agent, day) ?? []);
}

/**
 * Antes de decidir, en orden. Sin envoltorio `async`: con un solo sistema devuelve su misma
 * promesa (o nada), así no añade pasos de microtareas.
 */
export function systemsBeforeDecide(
  ctx: SimContext,
  agent: Agent,
  now: number,
): Promise<void> | void {
  let chain: Promise<void> | undefined;
  for (const s of activeSystems(ctx)) {
    const hook = s.beforeDecide;
    if (!hook) continue;
    chain = chain ? chain.then(() => hook(ctx, agent, now)) : (hook(ctx, agent, now) ?? undefined);
  }
  return chain;
}

export function systemsBeforeAction(ctx: SimContext, agent: Agent, action: AgentAction): void {
  for (const s of activeSystems(ctx)) s.beforeAction?.(ctx, agent, action);
}

/** Cifras de cada sistema activo (para «Evolución»). */
export function systemMetrics(ctx: SimContext): Record<string, Record<string, number>> {
  return Object.fromEntries(
    activeSystems(ctx).flatMap((s) => (s.metrics ? [[s.id, s.metrics(ctx)]] : [])),
  );
}
