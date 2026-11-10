import type { MemoryStory, StoryStep } from "@lethetown/shared";
import { useI18n, type MessageKey } from "../i18n";
import { formatGameTime } from "./format";

const num = (n: number, digits = 2) => n.toFixed(digits).replace(".", ",");

/** Una línea legible de lo que le pasó (el motivo de la auditoría, sin inventar nada). */
function StepText({ step }: { step: StoryStep }) {
  const { t } = useI18n();
  const d = step.detail;
  switch (d.kind) {
    case "gist":
      return <>{t("replay.story.gist", { gist: d.gist })}</>;
    case "source":
      return <>{t("replay.story.source", { from: d.from, to: d.to })}</>;
    case "forgotten":
      return (
        <>
          {t("replay.story.forgotten", {
            s: num(d.strength, 3),
            th: num(d.threshold, 2),
          })}
        </>
      );
    case "rewritten":
      return <>{t("replay.story.rewritten", { text: d.text })}</>;
    case "reason":
      return <>{`${t(`replay.story.action.${step.action}` as MessageKey)}: ${d.reason}`}</>;
  }
}

/** Curva de fuerza (minuto → fuerza) con las líneas de vaguedad y olvido marcadas. */
function Curve({ story }: { story: MemoryStory }) {
  const { t } = useI18n();
  const W = 600;
  const H = 140;
  const [x0, x1] = story.span;
  const x = (m: number) => ((Math.min(Math.max(m, x0), x1) - x0) / (x1 - x0 || 1)) * W;
  const y = (s: number) => H - s * H;
  const path = story.curve
    .map(([m, s], i) => `${i ? "L" : "M"}${x(m).toFixed(1)},${y(s).toFixed(1)}`)
    .join(" ");
  const { forget, vague } = story.thresholds;
  return (
    <svg
      className="story-curve"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={t("replay.story.curve", { n: num(story.strength) })}
    >
      <line className="story-vague" x1={0} x2={W} y1={y(vague)} y2={y(vague)} />
      <line className="story-forget" x1={0} x2={W} y1={y(forget)} y2={y(forget)} />
      {path && <path className="story-line" d={path} />}
    </svg>
  );
}

/**
 * «Así muere un recuerdo»: el texto, la fuerza bajando hasta el umbral de olvido (muestreada al
 * empaquetar con la curva del motor) y, en orden, lo que le pasó con el motivo de la auditoría.
 */
export function MemoryStoryCard({ story }: { story: MemoryStory | null }) {
  const { t } = useI18n();
  if (!story) return <p className="muted">{t("replay.story.none")}</p>;
  const { forget, vague } = story.thresholds;
  const forgotten = story.clarity === "forgotten";
  const pct = (s: number) => `${Math.min(100, Math.max(0, s * 100))}%`;
  return (
    <div className="memory-story readable" data-testid="memory-story">
      <blockquote className={`story-text ${story.clarity}`}>«{story.text}»</blockquote>
      {story.firstText !== story.text && (
        <p className="small muted">{t("replay.story.first", { text: story.firstText })}</p>
      )}
      <div
        className="story-bar"
        role="meter"
        aria-valuemin={0}
        aria-valuemax={1}
        aria-valuenow={Math.round(story.strength * 1000) / 1000}
        aria-label={t("replay.story.strength")}
      >
        <div className={`story-fill ${story.clarity}`} style={{ width: pct(story.strength) }} />
        <span className="story-mark vague" style={{ left: pct(vague) }}>
          {t("replay.story.vagueLine", { n: num(vague) })}
        </span>
        <span className="story-mark forget" style={{ left: pct(forget) }}>
          {t("replay.story.forgetLine", { n: num(forget) })}
        </span>
      </div>
      <p className="small">
        <strong>{t("replay.story.strengthN", { n: num(story.strength, 3) })}</strong> ·{" "}
        {t(`memory.clarity.${story.clarity}`)}
        {forgotten && story.forgottenAt !== null && ` · ${formatGameTime(story.forgottenAt)}`}
      </p>
      {story.curve.length > 1 && <Curve story={story} />}
      <ol className="story-steps">
        {story.createdAt !== null && (
          <li>
            <span className="small muted">{formatGameTime(story.createdAt)}</span>{" "}
            {t("replay.story.created")}
          </li>
        )}
        {story.steps.map((s, i) => (
          <li key={i} className={`story-step ${s.action}`}>
            <span className="small muted">{formatGameTime(s.at)}</span> <StepText step={s} />
          </li>
        ))}
      </ol>
    </div>
  );
}
