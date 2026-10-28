import type { CostSummary } from "@lethetown/shared";
import { formatUsd } from "./format";

export function CostCounter({ costs }: { costs: CostSummary | null }) {
  const t = costs?.total;
  return (
    <section className="panel">
      <h3>Coste LLM</h3>
      <div className="cost">{formatUsd(t?.usd ?? 0)}</div>
      <div className="muted">
        {t?.calls ?? 0} llamadas · entrada {t?.inputTokens ?? 0} · salida {t?.outputTokens ?? 0} ·
        caché {t?.cacheReadTokens ?? 0}
      </div>
      {costs && (
        <div className="muted small">
          {Object.entries(costs.byTask)
            .map(([task, b]) => `${task}: ${b.calls} (${formatUsd(b.usd)})`)
            .join(" · ")}
        </div>
      )}
    </section>
  );
}
