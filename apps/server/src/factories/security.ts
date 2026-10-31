/** Factorías de seguridad: usuarios, presupuesto, protección de menores y moderación. */
import type { LLMClient } from "@lethetown/agent-core";
import {
  MinorGuard,
  minorsOf,
  moderateUserText,
  hasStrongRomance,
  sanitizeUserText,
} from "@lethetown/agent-core";
import { isProduction, type AppConfig } from "../config";
import { InMemoryUserStore, type UserStore } from "../security/auth";
import { type DbHandle } from "../db/client";
import { type WorldRow } from "../db/worlds";
import { BudgetGuard } from "../security/budget";
import { budgetTotals } from "../worker/shared";
import type { Services, WorldRuntime } from "./types";

/** Usuarios en RAM; fuera de producción, DEV_ADMIN_PASSWORD crea el admin "admin". */
export async function devUsers(config: AppConfig, log: (msg: string) => void): Promise<UserStore> {
  const users = new InMemoryUserStore();
  if (config.DEV_ADMIN_PASSWORD && !isProduction(config)) {
    await users.create({ username: "admin", role: "admin", password: config.DEV_ADMIN_PASSWORD });
    log('Usuario "admin" de desarrollo creado en RAM (DEV_ADMIN_PASSWORD).');
  }
  return users;
}

/** Gasto en LLM (solo para verlo) y kill switch, con lo ya registrado en llm_calls. */
export async function createBudget(db: DbHandle | undefined): Promise<BudgetGuard> {
  const guard = new BudgetGuard();
  if (!db) return guard;
  guard.load(await budgetTotals(db.db));
  return guard;
}

/** Protección de menores de un mundo: lo descartado va a moderation_log (ver MinorGuard). */
export function createMinorGuard(
  services: Services,
  row: WorldRow,
  llm: LLMClient,
  worldLog: (msg: string) => void,
): MinorGuard {
  return new MinorGuard({
    minors: minorsOf(services.seeds),
    llm,
    onBlock: (b) => {
      // Se distingue lo bloqueado por no poder moderar (fail-closed) de lo rechazado por contenido.
      const reason = b.cause === "error" ? `error de moderación: ${b.reason}` : b.reason;
      worldLog(`🛡 Descartado (${b.kind}${b.agentId ? `, ${b.agentId}` : ""}): ${reason}`);
      services.track(
        services.moderationLog
          .add({
            worldId: row.id,
            userId: null,
            kind: `minor_safety:${b.kind}`,
            text: b.text.slice(0, 1000),
            reason,
          })
          .catch((e: unknown) => worldLog(`⚠ No se pudo registrar el descarte: ${String(e)}`)),
      );
    },
  });
}

/** Sanea y modera un texto de usuario (voz interior, objetos); los rechazos van al registro. */
export function createUserTextVetter(
  services: Services,
  row: WorldRow,
  llm: LLMClient,
  guard: MinorGuard,
  worldLog: (msg: string) => void,
): WorldRuntime["vetUserText"] {
  const { config } = services;
  return async (kind, text, userId, agentId) => {
    const reject = async (reason: string) => {
      services.track(
        services.moderationLog
          .add({ worldId: row.id, userId, kind, text: text.slice(0, 1000), reason })
          .catch((e: unknown) => worldLog(`⚠ No se pudo registrar el rechazo: ${String(e)}`)),
      );
      worldLog(`🛡 Texto rechazado (${kind}): ${reason}`);
      return { ok: false as const, error: `Texto rechazado: ${reason}` };
    };
    const clean = sanitizeUserText(text, config.USER_TEXT_MAX);
    if (!clean) return reject(`vacío o de más de ${config.USER_TEXT_MAX} caracteres`);
    // Protección de menores, también con la moderación apagada.
    const minors = guard.involvedMinors(clean, agentId ? [agentId] : []);
    if (minors.length && hasStrongRomance(clean)) {
      return reject(
        `contenido romántico o sexual con un menor (${minors.map((m) => m.name).join(", ")})`,
      );
    }
    if (config.MODERATION === "off") return { ok: true, text: clean };
    try {
      const verdict = await moderateUserText(llm, { kind, text: clean });
      if (!verdict.allowed) return reject(verdict.reason || "no permitido");
    } catch (error) {
      // Sin moderación (p. ej. sin presupuesto) no entra nada.
      return reject(
        `no se pudo moderar (${error instanceof Error ? error.message : String(error)})`,
      );
    }
    return { ok: true, text: clean };
  };
}
