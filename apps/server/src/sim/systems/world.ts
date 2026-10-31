/**
 * Sistema del mundo: la biblia (config/world.json) en el prompt fijo, la fecha del calendario en
 * el plan del día y el clima de la estación (lo usa el modo demostración). Sin biblia en las
 * dependencias, no aporta nada. Ver docs/decisiones/mundo.md.
 */
import { bibleLines, gameDate, todayLine } from "@lethetown/agent-core";
import { registerSystem } from "./registry";

registerSystem({
  id: "world",
  description: "Dónde y cuándo vive el pueblo: época, lugar, glosario, calendario y clima.",
  identityLines: (_world, deps) => (deps.bible ? bibleLines(deps.bible) : []),
  planSections: (ctx, _agent, now) => {
    const bible = ctx.deps.bible;
    return bible ? [{ title: "", lines: [todayLine(bible, now)], order: 0 }] : [];
  },
  metrics: (ctx): Record<string, number> => {
    const bible = ctx.deps.bible;
    if (!bible) return {};
    const date = gameDate(bible, ctx.clock.now());
    return { year: date.year, month: date.month, day: date.day };
  },
});
