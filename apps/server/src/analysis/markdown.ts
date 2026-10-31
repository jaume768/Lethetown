/**
 * El informe de evolución en Markdown (el resumen de ESTUDIO.md): coste por tarea, espera de
 * respuesta, longitud de las frases por estilo, intenciones, acciones, red social, memoria y
 * errores. Con dos informes, cada cifra lleva las dos partidas y la diferencia.
 */
import type { DayMetrics, EvolutionReport } from "@lethetown/shared";

type Value = number | null | undefined;

/** Una fila: la cifra de la partida A y, si se compara, la de B. */
interface Line {
  name: string;
  a: Value;
  b?: Value;
}

const fmt = (x: Value) =>
  x === null || x === undefined ? "—" : Number.isInteger(x) ? String(x) : x.toFixed(2);

function cells(line: Line, compare: boolean): string {
  if (!compare) return fmt(line.a);
  const { a, b } = line;
  const delta = a === null || a === undefined || b === null || b === undefined ? null : b - a;
  const sign = delta !== null && delta > 0 ? "+" : "";
  return `${fmt(a)} | ${fmt(b)} | ${delta === null ? "—" : `${sign}${fmt(delta)}`}`;
}

function table(title: string, lines: Line[], compare: boolean): string {
  const head = compare ? "| | A | B | Δ |\n| --- | ---: | ---: | ---: |" : "| | |\n| --- | ---: |";
  const body = lines.map((l) => `| ${l.name} | ${cells(l, compare)} |`).join("\n");
  return `### ${title}\n\n${head}\n${body}\n`;
}

const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);
const keys = (...rs: (Record<string, unknown> | undefined)[]) =>
  [...new Set(rs.flatMap((r) => Object.keys(r ?? {})))].sort();

/** Las cifras de un resumen (un día o el total), en el orden en que se muestran. */
const SUMMARY: [string, (d: DayMetrics) => number][] = [
  ["Frases dichas", (d) => d.utterances],
  ["Parejas que han hablado", (d) => d.pairsTalked],
  ["… % de las posibles", (d) => d.pairsPct],
  ["Parejas que han hablado alguna vez", (d) => d.pairsEver],
  ["Frases de las 4 parejas que más hablan (parte)", (d) => d.top4Share],
  ["Gini de las frases por agente", (d) => d.gini],
  ["Interlocutores por agente (media)", (d) => d.partnersMean],
  ["Interlocutores por agente (mínimo)", (d) => d.partnersMin],
  ["Conversaciones", (d) => d.conversations.total],
  ["… de grupo", (d) => d.conversations.group],
  ["… turnos de media", (d) => d.conversations.meanTurns],
  ["Intenciones propuestas", (d) => d.intentions.proposed],
  ["… cumplidas", (d) => d.intentions.kept],
  ["… se le pasan", (d) => d.intentions.missed],
  ["… recordadas tarde", (d) => d.intentions.late],
  ["Acciones hechas", (d) => sum(Object.values(d.actions).map((v) => v.done))],
  ["… acordadas hablando", (d) => sum(Object.values(d.actions).map((v) => v.agreed))],
  ["… que no salieron", (d) => sum(Object.values(d.actions).map((v) => v.failed))],
  ["Cambios de tipo de relación", (d) => d.relationshipChanges],
  ["Metas activas (al final del día)", (d) => d.goals?.active ?? 0],
  ["… conseguidas ese día", (d) => d.goals?.achieved ?? 0],
  ["… abandonadas ese día", (d) => d.goals?.abandoned ?? 0],
  ["… progreso medio", (d) => d.goals?.meanProgress ?? 0],
  ["… frustración media", (d) => d.goals?.meanFrustration ?? 0],
  ["Anacronismos registrados", (d) => d.knowledge?.anachronism ?? 0],
  ["Referencias externas registradas", (d) => d.knowledge?.external ?? 0],
  ["Reconsolidaciones", (d) => d.memory.reconsolidated],
  ["Olvidos", (d) => d.memory.forgotten],
  ["Recuerdos archivados (resumidos)", (d) => d.memory.archived],
  ["Recuerdos borrados (presupuesto)", (d) => d.memory.deleted],
  ["Errores del LLM", (d) => sum(Object.values(d.llmErrors))],
  ["Coste ($)", (d) => d.usd],
];

/** Filas de una cifra de cada clave de dos registros (tareas, estilos, motivos…). */
function byKey<T>(
  a: Record<string, T>,
  b: Record<string, T> | undefined,
  rows: [string, (x: T | undefined) => Value][],
): Line[] {
  return keys(a, b).flatMap((k) =>
    rows.map(([label, f]) => ({
      name: label.replace("{k}", k),
      a: f(a[k]),
      ...(b ? { b: f(b[k]) } : {}),
    })),
  );
}

export function evolutionMarkdown(a: EvolutionReport, b?: EvolutionReport): string {
  const compare = Boolean(b);
  const both = (f: (r: EvolutionReport) => Value): Pick<Line, "a" | "b"> => ({
    a: f(a),
    ...(b ? { b: f(b) } : {}),
  });
  const out: string[] = [
    compare
      ? "## Comparación de dos partidas (A → B)\n"
      : `## Resumen (${a.agents} agentes, ${a.days.length} días de juego)\n`,
    table(
      "En cifras",
      SUMMARY.map(([name, f]) => ({ name, ...both((r) => f(r.total)) })),
      compare,
    ),
    table(
      "Coste por tarea y por sistema",
      [
        ...byKey(a.cost.byTask, b?.cost.byTask, [
          ["{k}: llamadas", (t) => t?.calls ?? 0],
          ["{k}: $", (t) => t?.usd ?? 0],
          ["{k}: % lectura de caché", (t) => t?.cacheReadPct ?? null],
        ]),
        { name: "**total $**", ...both((r) => r.cost.total) },
        ...byKey(a.cost.bySystem, b?.cost.bySystem, [["sistema {k}: $", (v) => v ?? 0]]),
      ],
      compare,
    ),
    table(
      "Espera de respuesta",
      [
        { name: "Respuestas medidas", ...both((r) => r.replyLatency.replies) },
        { name: "Media (min de juego)", ...both((r) => r.replyLatency.meanMinutes) },
        { name: "p90 (min de juego)", ...both((r) => r.replyLatency.p90Minutes) },
        { name: "Media (s reales)", ...both((r) => r.replyLatency.meanSeconds) },
      ],
      compare,
    ),
    table(
      "Longitud de las frases por estilo",
      byKey(a.speechByStyle, b?.speechByStyle, [
        ["{k}: frases", (s) => s?.n ?? 0],
        ["{k}: media (caracteres)", (s) => s?.meanChars ?? 0],
        ["{k}: máximo", (s) => s?.maxChars ?? 0],
        ["{k}: réplicas de 1-3 palabras", (s) => s?.short ?? 0],
      ]),
      compare,
    ),
    table(
      "Acciones del catálogo",
      byKey(a.total.actions, b?.total.actions, [
        ["{k} (formal)", (x) => x?.done ?? 0],
        ["{k} (acordado hablando)", (x) => x?.agreed ?? 0],
        ["{k} (no salió)", (x) => x?.failed ?? 0],
      ]),
      compare,
    ),
    table(
      "Cómo acaban las conversaciones",
      byKey(a.total.conversations.endReasons, b?.total.conversations.endReasons, [
        ["{k}", (n) => n ?? 0],
      ]),
      compare,
    ),
  ];
  if (a.total.goals || b?.total.goals) {
    const g = (r: EvolutionReport) => r.total.goals;
    out.push(
      table(
        "Metas",
        [
          { name: "Activas", ...both((r) => g(r)?.active ?? null) },
          { name: "Conseguidas", ...both((r) => g(r)?.achieved ?? null) },
          { name: "Abandonadas", ...both((r) => g(r)?.abandoned ?? null) },
          { name: "Progreso medio (activas)", ...both((r) => g(r)?.meanProgress ?? null) },
          { name: "Frustración media (activas)", ...both((r) => g(r)?.meanFrustration ?? null) },
          ...byKey(a.total.goals?.byAgent ?? {}, b?.total.goals?.byAgent, [
            ["{k}: conseguidas", (x) => x?.achieved ?? 0],
            ["{k}: abandonadas", (x) => x?.abandoned ?? 0],
            ["{k}: frustración", (x) => x?.meanFrustration ?? 0],
          ]),
        ],
        compare,
      ),
    );
  }
  if (a.knowledge || b?.knowledge) {
    out.push(
      table(
        "Conocimiento externo (anacronismos y referencias)",
        [
          ...byKey(a.knowledge?.byKind ?? {}, b?.knowledge?.byKind, [["{k}", (n) => n ?? 0]]),
          ...byKey(
            Object.fromEntries(
              Object.entries(a.knowledge?.byAgent ?? {}).map(([k, v]) => [
                k,
                Object.values(v).reduce((s, n) => s + n, 0),
              ]),
            ),
            b?.knowledge &&
              Object.fromEntries(
                Object.entries(b.knowledge.byAgent).map(([k, v]) => [
                  k,
                  Object.values(v).reduce((s, n) => s + n, 0),
                ]),
              ),
            [["{k}", (n) => n ?? 0]],
          ),
        ],
        compare,
      ),
    );
    const examples = (a.knowledge?.examples ?? []).slice(0, 10);
    if (examples.length) {
      out.push(
        `Ejemplos:\n\n${examples.map((x) => `- ${x.kind} «${x.term}» (${x.agentId ?? "-"}, ${x.source}): ${x.text}`).join("\n")}\n`,
      );
    }
  }
  const errors = byKey(a.total.llmErrors, b?.total.llmErrors, [["{k}", (n) => n ?? 0]]);
  if (errors.length) out.push(table("Errores del LLM por tarea", errors, compare));

  for (const [label, r] of [
    ["A", a],
    ["B", b],
  ] as const) {
    if (!r) continue;
    const who = compare ? ` (${label})` : "";
    const pairs = r.topPairs.map((p) => `- ${p.pair}: ${p.utterances} frases`).join("\n");
    out.push(`### Red social${who}\n\n${pairs || "- (nadie habló)"}\n`);
    const transitions = Object.entries(r.relationshipTransitions).sort((x, y) => y[1] - x[1]);
    if (transitions.length) {
      const list = transitions.map(([t, n]) => `${t} (${n})`).join(", ");
      out.push(`Cambios de tipo de relación${who}: ${list}.\n`);
    }
  }
  if (!compare && a.days.length > 1) {
    const head = `| | ${a.days.map((d) => `día ${d.day}`).join(" | ")} |`;
    const sep = `| --- | ${a.days.map(() => "---:").join(" | ")} |`;
    const rows = SUMMARY.map(
      ([name, f]) => `| ${name} | ${a.days.map((d) => fmt(f(d))).join(" | ")} |`,
    );
    out.push(`### Por día de juego\n\n${head}\n${sep}\n${rows.join("\n")}\n`);
  }
  return out.join("\n");
}
