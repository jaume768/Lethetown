import type { DayMetrics, EvolutionReport } from "@lethetown/shared";
import { useI18n, type MessageKey } from "../i18n";
import { formatUsd } from "./format";
import { usePolled } from "./usePolled";

/** Cada cuánto se recalcula (lee eventos, auditoría e historial: no hace falta más a menudo). */
const REFRESH_MS = 30_000;

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

/** Filas de la tabla por día: clave del texto y cómo se saca la cifra. */
const ROWS: [MessageKey, (d: DayMetrics) => number | string][] = [
  ["evolution.utterances", (d) => d.utterances],
  ["evolution.pairs", (d) => `${d.pairsTalked} (${d.pairsPct} %)`],
  ["evolution.pairsEver", (d) => d.pairsEver],
  ["evolution.top4", (d) => `${Math.round(d.top4Share * 100)} %`],
  ["evolution.gini", (d) => d.gini.toFixed(2)],
  ["evolution.partners", (d) => `${d.partnersMean} (${d.partnersMin})`],
  ["evolution.conversations", (d) => `${d.conversations.total} (${d.conversations.group})`],
  ["evolution.turns", (d) => d.conversations.meanTurns],
  [
    "evolution.intentions",
    (d) =>
      `${d.intentions.proposed} / ${d.intentions.kept} / ${d.intentions.missed} / ${d.intentions.late}`,
  ],
  [
    "evolution.actions",
    (d) =>
      `${sum(Object.values(d.actions).map((a) => a.done))} / ${sum(Object.values(d.actions).map((a) => a.agreed))}`,
  ],
  ["evolution.relationships", (d) => d.relationshipChanges],
  [
    "evolution.memory",
    (d) => `${d.memory.reconsolidated} / ${d.memory.forgotten} / ${d.memory.archived}`,
  ],
  ["evolution.errors", (d) => sum(Object.values(d.llmErrors))],
  [
    "evolution.goalsRow",
    (d) => (d.goals ? `${d.goals.active} / ${d.goals.achieved} / ${d.goals.abandoned}` : "—"),
  ],
  [
    "evolution.goalsMeans",
    (d) =>
      d.goals ? `${d.goals.meanProgress.toFixed(2)} / ${d.goals.meanFrustration.toFixed(2)}` : "—",
  ],
  [
    "evolution.knowledgeRow",
    (d) => `${d.knowledge?.anachronism ?? 0} / ${d.knowledge?.external ?? 0}`,
  ],
];

/** Pestaña de admin «Evolución»: cómo cambia el pueblo día a día (red, charlas, memoria, coste). */
export function EvolutionPanel() {
  const { t } = useI18n();
  const report = usePolled<EvolutionReport>("/api/evolution", "evolution", REFRESH_MS);
  if (!report) return <p className="muted small">{t("evolution.loading")}</p>;
  const columns = [...report.days, report.total];
  const tasks = Object.entries(report.cost.byTask).sort((a, b) => b[1].usd - a[1].usd);
  return (
    <section className="evolution" aria-labelledby="evolution-title">
      <h3 id="evolution-title">{t("evolution.title")}</h3>
      <div className="table-scroll" tabIndex={0} role="region" aria-labelledby="evolution-title">
        <table>
          <caption className="sr-only">{t("evolution.caption")}</caption>
          <thead>
            <tr>
              <th scope="col">{t("evolution.metric")}</th>
              {columns.map((d) => (
                <th scope="col" key={d.day}>
                  {d.day < 0 ? t("evolution.total") : t("evolution.day", { day: d.day })}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ROWS.map(([key, value]) => (
              <tr key={key}>
                <th scope="row">{t(key)}</th>
                {columns.map((d) => (
                  <td key={d.day}>{value(d)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h4>{t("evolution.cost")}</h4>
      <ul className="small">
        {tasks.map(([task, b]) => (
          <li key={task}>{t("evolution.task", { task, calls: b.calls, usd: formatUsd(b.usd) })}</li>
        ))}
        {Object.entries(report.cost.bySystem).map(([system, usd]) => (
          <li key={`s:${system}`}>{t("evolution.system", { system, usd: formatUsd(usd) })}</li>
        ))}
      </ul>

      {report.total.goals && Object.keys(report.total.goals.byAgent).length > 0 && (
        <>
          <h4>{t("evolution.goals")}</h4>
          <ul className="small">
            {Object.entries(report.total.goals.byAgent).map(([id, g]) => (
              <li key={id}>
                {t("evolution.goalsAgent", {
                  name: id,
                  active: g.active,
                  achieved: g.achieved,
                  abandoned: g.abandoned,
                  progress: g.meanProgress.toFixed(2),
                  frustration: g.meanFrustration.toFixed(2),
                })}
              </li>
            ))}
          </ul>
        </>
      )}

      {report.knowledge && (
        <>
          <h4>{t("evolution.knowledge")}</h4>
          {report.knowledge.examples.length === 0 ? (
            <p className="small muted">{t("evolution.knowledgeNone")}</p>
          ) : (
            <>
              <ul className="small">
                {Object.entries(report.knowledge.byAgent)
                  .sort((a, b) => sum(Object.values(b[1])) - sum(Object.values(a[1])))
                  .map(([id, k]) => (
                    <li key={id}>
                      {t("evolution.knowledgeAgent", {
                        name: id,
                        anachronism: k.anachronism ?? 0,
                        external: k.external ?? 0,
                      })}
                    </li>
                  ))}
              </ul>
              <ul className="small">
                {report.knowledge.examples.map((x, i) => (
                  <li key={i}>
                    <span className="tag">
                      {t(`evolution.knowledgeKind.${x.kind}` as MessageKey)}
                    </span>{" "}
                    <strong>{x.term}</strong> · {x.agentId ?? "—"} ({x.source}): «{x.text}»
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}

      {report.systems && (
        <>
          <h4>{t("evolution.systems")}</h4>
          <ul className="small">
            {Object.entries(report.systems).map(([id, figures]) => (
              <li key={id}>
                <strong>{id}</strong>:{" "}
                {Object.entries(figures)
                  .map(([k, v]) => `${k} ${v}`)
                  .join(" · ")}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
