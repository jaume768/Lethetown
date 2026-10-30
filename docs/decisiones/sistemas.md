# Sistemas de la simulación

Principio: **el núcleo no crece con cada sistema**. Citas, inventario, notas, normas o, más
adelante, economía, metas u oficios son módulos (`SimSystem`) que se registran solos.
`simulation.ts` recorre el registro (`sim/systems/registry.ts`) y no conoce a ninguno.

## Decisiones

- **Un sistema declara lo suyo** (todo opcional salvo `id`): acciones del catálogo, su parte de
  la instantánea con su propia versión, carga al abrir el mundo, revisión periódica sin LLM,
  secciones del prompt de decidir, líneas fijas del prompt de identidad, huecos fijos del plan,
  ganchos antes de decidir y antes de actuar, retención de su tabla, métricas y datos de admin.
  Ver `sim/systems/types.ts`.
- **Orden de registro = orden de ejecución.** `sim/systems/index.ts` importa los sistemas en el
  orden en que corren sus revisiones (el del test dorado). Las revisiones del mismo intervalo
  corren juntas y en orden; solo se espera (`await`) lo que devuelve una promesa, para no añadir
  pasos de microtareas que cambien el orden del mock.
- **Estado del sistema fuera de `SimContext`.** Cada sistema guarda su estado con
  `ctx.state(id, init)` y lo lee con su accesor tipado (`meetingsState(ctx)`). El contexto solo
  tiene lo común (agentes, runtime, conversaciones, almacenes). Lo que es de cada agente y no de un
  sistema (`Runtime.following`, `normWarned`) sigue en el runtime del agente.
- **Instantánea por sistema** (`SimSnapshot.systems`: id → `{ version, data }`, validado con el
  `schema` zod del sistema). Si un sistema cambia su forma, sube **su** versión: al restaurar,
  solo ese sistema empieza de cero (con un aviso en el log) y el resto del mundo se restaura.
  `SIM_SNAPSHOT_VERSION` (18) solo sube si cambia lo común.
- **Activos por mundo** (`worlds.systems`, jsonb, `{ "notes": false }`; por defecto, todos). Un
  sistema desactivado no revisa, no añade nada al prompt, no guarda instantánea y sus acciones no
  se ofrecen; si el LLM las pide igualmente, el motor responde «eso no se puede hacer en este
  pueblo». Sin `norms`, `mayEnter` deja ir a cualquier sitio a cualquier hora.
- **Prompt**: las secciones llevan `order` (agenda 0, invitaciones 10, inventario 20; por
  defecto 50); por debajo de 5 van antes de LUGARES QUE HAS DESCUBIERTO. Lo fijo
  (`identityLines`) se añade a las reglas del prompt de identidad al crear el agente: tiene que
  ser igual en todas las llamadas (caché).
- **Mock**: el campo `mock()` registra reglas con `registerDecideRule` o respondedores con
  `registerMockHandler` (exportados por agent-core). Los sistemas migrados tienen sus reglas en
  `agent-core/src/agent/mock/` desde antes y no usan el campo.
- **Lo que no es un sistema**: decidir, hablar (`say`), moverse (`do_activity`), percibir,
  conversaciones y memoria son el núcleo.

## Sistemas actuales

| id         | Acciones                              | Revisión (5 min)             | Prompt                                | Tabla             |
| ---------- | ------------------------------------- | ---------------------------- | ------------------------------------- | ----------------- |
| `meetings` | propose/accept/decline/cancel_meeting | salidas, llegadas, plantones | AGENDA; huecos del plan               | `commitments`     |
| `items`    | give/lend/return/take/leave_item      | préstamos vencidos           | LLEVAS, HAS PRESTADO, AQUÍ HAY…       | `inventory_items` |
| `objects`  | use_object                            | lo que dura vuelve solo      | —                                     | —                 |
| `company`  | invite, accept/decline_invite, follow | seguir a quien acompaña      | INVITACIONES                          | —                 |
| `notes`    | post_note, leave_note                 | caducar                      | (se leen como percepción)             | `notes`           |
| `norms`    | —                                     | abrir y cerrar, intrusos     | —                                     | —                 |
| `places`   | explore                               | —                            | (lugares descubiertos, en agent-core) | `known_places`    |

## Cómo añadir un sistema

Plantilla (`apps/server/src/sim/systems/<id>.ts`, importado al final de `systems/index.ts`):

```ts
import { z } from "zod";
import type { SimContext } from "../context";
import { registerSystem } from "./registry";
import { REVIEW_MINUTES } from "./types";

interface MoneyState {
  balances: Map<string, number>;
}
export const moneyState = (ctx: SimContext) =>
  ctx.state<MoneyState>("money", () => ({ balances: new Map() }));

registerSystem({
  id: "money",
  description: "Dinero de cada uno: pagar, cobrar y deber.",
  actions: ["pay"],
  snapshot: {
    version: 1,
    schema: z.object({ balances: z.record(z.string(), z.number()) }),
    save: (ctx) => ({ balances: Object.fromEntries(moneyState(ctx).balances) }),
    restore: (ctx, d) => {
      moneyState(ctx).balances = new Map(Object.entries(d.balances));
    },
  },
  tick: { every: REVIEW_MINUTES, run: (ctx, now) => {} },
  promptSections: (ctx, agent) => [
    { title: "DINERO", lines: [`Tienes ${moneyState(ctx).balances.get(agent.id) ?? 0} €`] },
  ],
  retention: { table: "money_moves", policy: "moneyMoves" },
  metrics: (ctx) => ({ total: [...moneyState(ctx).balances.values()].reduce((a, b) => a + b, 0) }),
});
```

Checklist:

1. **shared**: esquemas zod de lo que viaja (mensajes, filas) y de sus acciones en
   `actions/catalog.ts` (ver [acciones](acciones.md#cómo-añadir-una-acción)).
2. **Tabla** en `db/schema.ts` con `world_id`, almacén Postgres y en RAM (`db/<id>.ts`), por
   inyección en `SimulationDeps` (en RAM por defecto); `pnpm db:generate` y commit de la migración.
3. **Instantánea**: `snapshot` con `version` y `schema`; subir la versión si cambia la forma.
4. **Carga** (`load`): leer del almacén si no viene de la instantánea (`restored`).
5. **Revisión** (`tick`) sin LLM y con el `Rng` inyectado; si algo afecta a alguien, percepción
   (`rt.pending`) y evento con `meta.action`.
6. **Prompt**: `promptSections` (lo variable, con `order`) e `identityLines` (lo fijo); si cambia
   algo del prompt, actualizar el respondedor del mock.
7. **Acciones**: manejadores con `registerAction` en `sim/actions/<id>.ts`, listados en
   `actions`; `minorMeetingRule` si hay alguien o un lugar de por medio; `mayEnter` para ir.
8. **Mock**: regla con `registerDecideRule` (en `mock()` o en `agent-core/src/agent/mock/`).
9. **Métricas** (`metrics`) para la pestaña «Evolución» y, si hace falta, `admin` (datos de su
   pestaña o endpoint).
10. **UI**: iconos (`ACTION_ICONS`) y textos en `i18n/es.ts` y `en.ts`.
11. **Retención**: política en `retention.ts` (y `config/retention.json`) o `keep` con el motivo.
12. **Tests** junto al sistema; el dorado no cambia si el sistema no está en el mundo por
    defecto o no altera nada; si lo altera, regenerarlo explicándolo en el commit; medir con
    `cost:report 48` si toca el prompt.
