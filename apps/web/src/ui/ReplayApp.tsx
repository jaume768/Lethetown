import type { Drama, Moment, ReplayBundle, SimEvent } from "@lethetown/shared";
import { splitSpeech } from "@lethetown/shared";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { TownMap, type MapController } from "../game/TownMap";
import { useI18n, type MessageKey } from "../i18n";
import { ReplayPlayer } from "../net/replay-player";
import { decodeBundle, REPLAY_SPEEDS, ReplaySource, type ReplaySpeed } from "../net/replay-source";
import { feed, startReplay, useGame } from "../net/store";
import {
  CLIP_FORMATS,
  SAFE_ZONE,
  drawCineOverlay,
  formatPlayedOn,
  subtitleMs,
  subtitleSize,
  type ClipFormat,
  type SubtitleLine,
} from "./cine";
import { ChroniclePanel } from "./ChroniclePanel";
import { ClipRecorder } from "./ClipRecorder";
import { DramaFeed } from "./DramaFeed";
import { ErrorBoundary } from "./ErrorBoundary";
import { EventLog } from "./EventLog";
import { formatGameTime } from "./format";
import { GoalsPanel } from "./GoalsPanel";
import { MemoryGarden } from "./MemoryGarden";
import { Modal } from "./Modal";
import { NetworkModal } from "./NetworkModal";
import { RashomonModal } from "./RashomonModal";
import { SkillsPanel } from "./SkillsPanel";
import { LoadingScreen } from "./StatusOverlay";
import { cardsFor, safeReplaySrc, type Card } from "./replay-cards";
import { Tabs } from "./Tabs";

const PREF_KEY = "lethetown.replay";
interface Prefs {
  format: ClipFormat;
  guides: boolean;
  mark: boolean;
}
function loadPrefs(): Prefs {
  const def: Prefs = { format: "9:16", guides: true, mark: true };
  try {
    const raw = JSON.parse(localStorage.getItem(PREF_KEY) ?? "{}") as Partial<Prefs>;
    return {
      format: CLIP_FORMATS.includes(raw.format as ClipFormat)
        ? (raw.format as ClipFormat)
        : def.format,
      guides: raw.guides ?? def.guides,
      mark: raw.mark ?? def.mark,
    };
  } catch {
    return def;
  }
}
function savePrefs(p: Prefs) {
  try {
    localStorage.setItem(PREF_KEY, JSON.stringify(p));
  } catch {
    /* sin almacenamiento: no se recuerda */
  }
}

/** `/replay`: carga un paquete (arrastrándolo o con `?src=/replays/…`) y lo reproduce. */
export function ReplayApp() {
  const { t } = useI18n();
  const params = useMemo(() => new URLSearchParams(location.search), []);
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  /** Ya se pidió el `?src` (StrictMode monta dos veces). */
  const requested = useRef(false);

  const open = useCallback(
    async (bytes: () => Promise<ArrayBuffer>) => {
      setLoading(true);
      setError(null);
      try {
        setSession(createSession(await decodeBundle(await bytes()), params));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    },
    [params],
  );

  useEffect(() => {
    const raw = params.get("src");
    const src = safeReplaySrc(raw);
    if (raw && !src) return setError(t("replay.badSrc"));
    if (src && !requested.current) {
      requested.current = true;
      void open(async () => {
        const res = await fetch(src);
        if (!res.ok) throw new Error(`${src}: ${res.status}`);
        return res.arrayBuffer();
      });
    }
  }, [open, params, t]);

  if (session)
    return (
      <ErrorBoundary
        fallback={(message) => (
          <div className="replay-drop">
            <div className="panel readable replay-drop-box" role="alert">
              <h1 className="brand">{t("replay.title")}</h1>
              <p>{t("replay.crashed")}</p>
              <p className="error small">{message}</p>
              <p className="muted small">
                <a href={location.pathname + location.search}>{t("replay.reload")}</a> ·{" "}
                <a href="/">{t("replay.backLive")}</a>
              </p>
            </div>
          </div>
        )}
      >
        <ReplayView session={session} params={params} />
      </ErrorBoundary>
    );
  return (
    <div
      className="replay-drop"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const file = e.dataTransfer.files[0];
        if (file) void open(() => file.arrayBuffer());
      }}
    >
      <div className="panel readable replay-drop-box">
        <h1 className="brand">{t("replay.title")}</h1>
        <p>{t("replay.dropHint")}</p>
        <label className="btn primary">
          {t("replay.choose")}
          <input
            type="file"
            accept=".gz,.json,application/gzip,application/json"
            className="sr-only"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void open(() => file.arrayBuffer());
            }}
          />
        </label>
        {loading && (
          <p role="status" aria-live="polite">
            {t("replay.loading")}
          </p>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <p className="muted small">
          <a href="/">{t("replay.backLive")}</a>
        </p>
      </div>
    </div>
  );
}

interface Session {
  src: ReplaySource;
  player: ReplayPlayer;
  /** Frases nuevas (para los subtítulos). */
  onSpeech: Set<(lines: SimEvent[]) => void>;
}

function createSession(bundle: ReplayBundle, params: URLSearchParams): Session {
  const src = new ReplaySource(bundle);
  const onSpeech = new Set<(lines: SimEvent[]) => void>();
  const player = new ReplayPlayer(
    src,
    (msgs, reset) => feed(msgs, reset),
    (lines) => onSpeech.forEach((l) => l(lines)),
  );
  const blob = (x: unknown) =>
    URL.createObjectURL(new Blob([JSON.stringify(x)], { type: "application/json" }));
  const files: Record<string, string> = {
    "/api/map": blob(bundle.map),
    "/api/state": blob({ agents: src.frames[0]!.agents }),
  };
  startReplay({
    api: (path) => src.api(path, player.now()),
    file: (path) => files[path] ?? null,
    now: () => player.now(),
  });
  const t = Number(params.get("t"));
  player.seek(Number.isFinite(t) && params.has("t") ? t : src.from);
  return { src, player, onSpeech };
}

const KIND_ICON: Record<Moment["kind"], string> = {
  drama: "🎭",
  chronicle: "📜",
  conversation: "💬",
  rashomon: "🪞",
  transformation: "✎",
  external: "🧭",
  goal: "🎯",
  teaching: "🧑‍🏫",
  forgetting: "🕳",
};

function usePlayer(player: ReplayPlayer) {
  return useSyncExternalStore(
    (l) => player.subscribe(l),
    () => player.state,
  );
}

function ReplayView({ session, params }: { session: Session; params: URLSearchParams }) {
  const { t } = useI18n();
  const { src, player } = session;
  const game = useGame();
  const ps = usePlayer(player);
  const map = useRef<MapController | null>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const [cine, setCine] = useState(params.get("cine") === "1");
  const [prefs, setPrefsState] = useState(loadPrefs);
  const setPrefs = (p: Partial<Prefs>) =>
    setPrefsState((old) => {
      const next = { ...old, ...p };
      savePrefs(next);
      return next;
    });
  const [tab, setTab] = useState<"moments" | "dramas" | "agent" | "chronicles">(
    params.get("agent") ? "agent" : "moments",
  );
  const [selectedId, setSelectedId] = useState<string | null>(params.get("agent"));
  /** A quién sigue la cámara del modo cine (null = automático: quien habla). */
  const [focusId, setFocusId] = useState<string | null>(params.get("agent"));
  const [card, setCard] = useState<Card | null>(null);
  const [clip, setClip] = useState(false);
  const [lines, setLines] = useState<(SubtitleLine & { until: number })[]>([]);
  const [frameSize, setFrameSize] = useState({ w: 0, h: 0 });
  const [kindFilter, setKindFilter] = useState<Moment["kind"] | "">("");
  const conversation = useRef<{ ids: string[]; at: number } | null>(null);

  const agentsRef = useRef(game.agents);
  agentsRef.current = game.agents;
  const focusRef = useRef(focusId);
  focusRef.current = focusId;

  // Subtítulos y encuadre: cada frase nueva.
  useEffect(() => {
    const onLines = (evs: SimEvent[]) => {
      const focus = focusRef.current;
      const current = conversation.current;
      // En automático se queda en una conversación hasta que lleva 5 minutos callada.
      const holding = !focus && current && player.now() - current.at < 5 ? current.ids : null;
      const relevant = evs.filter((e) =>
        focus
          ? e.agentId === focus || e.participants.includes(focus)
          : !holding || holding.some((id) => e.agentId === id || e.participants.includes(id)),
      );
      const last = relevant.at(-1) ?? (holding ? undefined : evs.at(-1));
      if (!last?.agentId) return;
      const other = last.participants.find((p) => p !== last.agentId);
      conversation.current = { ids: other ? [last.agentId, other] : [last.agentId], at: last.time };
      const now = performance.now();
      const fresh = relevant.slice(-2).map((e) => {
        const a = agentsRef.current.find((x) => x.id === e.agentId);
        const text = splitSpeech(e.text).line;
        return {
          id: e.id,
          name: (a?.name ?? e.agentId ?? "").split(" ")[0]!,
          color: a?.appearance.shirt ?? "#f0b84c",
          text,
          until: now + subtitleMs(text),
        };
      });
      setLines((old) =>
        [...old.filter((l) => !fresh.some((f) => f.id === l.id)), ...fresh].slice(-2),
      );
    };
    session.onSpeech.add(onLines);
    const prune = setInterval(() => {
      const now = performance.now();
      setLines((old) => (old.some((l) => l.until < now) ? old.filter((l) => l.until >= now) : old));
    }, 250);
    return () => {
      session.onSpeech.delete(onLines);
      clearInterval(prune);
    };
  }, [session, player]);

  // `&agent=`: la cámara empieza en él (la orden espera a que exista la escena).
  useEffect(() => {
    const id = params.get("agent");
    if (id) map.current?.focusAgent(id);
  }, [params]);

  // Cámara del modo cine: a quien se sigue (y con quien habla), o a quien habla.
  useEffect(() => {
    if (!cine) {
      map.current?.direct(null);
      return;
    }
    const pick = () => {
      const c = conversation.current;
      const recent = c && player.now() - c.at < 5 ? c.ids : null;
      const focus = focusRef.current;
      const ids = focus ? (recent?.includes(focus) ? recent : [focus]) : (recent ?? null);
      map.current?.direct(ids);
    };
    pick();
    const timer = setInterval(pick, 300);
    return () => clearInterval(timer);
  }, [cine, focusId, player]);

  // El marco del formato, lo más grande que quepa.
  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const fit = () => {
      if (!cine) return setFrameSize({ w: 0, h: 0 });
      const { w: fw, h: fh } = { w: host.clientWidth, h: host.clientHeight };
      const [a, b] = prefs.format.split(":").map(Number) as [number, number];
      const w = Math.floor(Math.min(fw, (fh * a) / b));
      setFrameSize({ w, h: Math.floor((w * b) / a) });
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(host);
    return () => ro.disconnect();
  }, [cine, prefs.format]);

  const goToMoment = useCallback(
    (m: Moment, withCard = false) => {
      // Un poco antes, para ver cómo empieza; lo de la memoria, justo después (que ya exista).
      player.seek(m.kind === "rashomon" || m.kind === "transformation" ? m.time + 0.5 : m.time - 1);
      const a = m.agents[0] ?? null;
      if (a) {
        setSelectedId(a);
        setFocusId(a);
        map.current?.focusAgent(a);
      }
      if (m.agents.length) conversation.current = { ids: m.agents.slice(0, 2), at: m.time };
      if (withCard) setCard(cardsFor(m, (id) => src.views.hasAccounts(id))[0] ?? null);
    },
    [player, src],
  );

  const moments = useMemo(
    () =>
      [...src.moments]
        .filter((m) => !kindFilter || m.kind === kindFilter)
        .sort((a, b) => a.time - b.time),
    [src, kindFilter],
  );
  const nextMoment = (dir: 1 | -1) => {
    const list = [...src.moments].sort((a, b) => a.time - b.time);
    const now = player.now();
    const m =
      dir > 0
        ? list.find((x) => x.time - 1 > now + 0.5)
        : list.filter((x) => x.time - 1 < now - 0.5).at(-1);
    if (m) goToMoment(m);
  };

  // Atajos de teclado (fuera de los campos y del mapa, que usa las flechas).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest("input, select, textarea, .map") || e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key;
      const jump = e.shiftKey ? 60 : 10;
      if (k === " " && !el.closest("button")) player.toggle();
      else if (k === "k") player.toggle();
      else if (k === "ArrowRight" || k === "l") player.seek(player.now() + jump);
      else if (k === "ArrowLeft" || k === "j") player.seek(player.now() - jump);
      else if (/^[1-5]$/.test(k)) player.setSpeed(REPLAY_SPEEDS[Number(k) - 1]!);
      else if (k === "n") nextMoment(1);
      else if (k === "p") nextMoment(-1);
      else if (k === "c") setCine((c) => !c);
      else if (k === "g" && cine) setPrefs({ guides: !prefs.guides });
      else if (k === "m" && cine) setPrefs({ mark: !prefs.mark });
      else if (k === "Escape" && card) setCard(null);
      else if (k === "Escape" && cine) setCine(false);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const meta = src.bundle.meta;
  const model = meta.models.join(", ") || "?";
  const watermark: [string, string] = [
    t("replay.watermark", { model, date: formatPlayedOn(meta.playedOn) }),
    "lethetown.com",
  ];
  const selected = game.agents.find((a) => a.id === selectedId);
  const today = Math.floor(ps.t / 1440);
  const linesRef = useRef(lines);
  linesRef.current = lines;
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;

  const onSelect = useCallback((id: string) => {
    setSelectedId(id);
    setFocusId(id);
    setTab("agent");
  }, []);

  const cardView = (c: Card): ReactNode => {
    const agent = "agentId" in c ? game.agents.find((a) => a.id === c.agentId) : undefined;
    if (c.kind === "rashomon")
      return <RashomonModal eventId={c.eventId} onClose={() => setCard(null)} />;
    if (c.kind === "network")
      return <NetworkModal onSelect={onSelect} onClose={() => setCard(null)} />;
    if (!agent) return null;
    const title = t(`replay.card.${c.kind}` as MessageKey, { name: agent.name });
    return (
      <Modal title={title} onClose={() => setCard(null)} className="cine-card">
        {c.kind === "garden" ? (
          <MemoryGarden
            agent={agent}
            agents={game.agents}
            world={game.world}
            thinkingTask={null}
            canIntervene={false}
            onFocus={(id) => map.current?.focusAgent(id)}
            onSelectAgent={onSelect}
            marksOn={false}
            onMarksOn={() => undefined}
            onMarks={() => undefined}
            onOpenNetwork={() => setCard({ kind: "network" })}
          />
        ) : c.kind === "goals" ? (
          <GoalsPanel agent={agent} agents={game.agents} world={game.world} />
        ) : (
          <SkillsPanel agent={agent} agents={game.agents} />
        )}
      </Modal>
    );
  };

  const side = (() => {
    switch (tab) {
      case "moments":
        return (
          <MomentsList
            moments={moments}
            names={src.names}
            now={ps.t}
            kind={kindFilter}
            onKind={setKindFilter}
            onGo={goToMoment}
            cards={(m) => cardsFor(m, (id) => src.views.hasAccounts(id))}
            onCard={(m, c) => {
              goToMoment(m);
              setCard(c);
            }}
          />
        );
      case "dramas":
        return (
          <DramaFeed
            dramas={game.dramas}
            onGoTo={(d: Drama) => {
              player.seek(d.time - 1);
              if (d.agents[0]) onSelect(d.agents[0]);
              if (d.placeId) map.current?.focusPlace(d.placeId);
            }}
            onOpenEvent={(id) => setCard({ kind: "rashomon", eventId: id })}
          />
        );
      case "agent":
        return (
          <MemoryGarden
            agent={selected}
            agents={game.agents}
            world={game.world}
            thinkingTask={null}
            canIntervene={false}
            onFocus={(id) => map.current?.focusAgent(id)}
            onSelectAgent={onSelect}
            marksOn={false}
            onMarksOn={() => undefined}
            onMarks={() => undefined}
            onOpenNetwork={() => setCard({ kind: "network" })}
          />
        );
      case "chronicles":
        return <ChroniclePanel chronicles={game.chronicles} />;
    }
  })();

  const safe = SAFE_ZONE[prefs.format];
  const fontPx = subtitleSize(prefs.format, frameSize.h);

  return (
    <div className={`replay ${cine ? "cine" : ""}`}>
      {!cine && (
        <header className="header replay-header">
          <a className="brand" href="/" aria-label={t("replay.backLive")}>
            Lethetown
          </a>
          <span className="tag">{t("replay.badge")}</span>
          <span className="small muted replay-meta">
            {t("replay.meta", {
              date: formatPlayedOn(meta.playedOn) || "?",
              model,
              seed: meta.seed ?? "?",
              hours: Math.round(meta.durationMinutes / 60),
            })}
          </span>
          <span className="spacer" />
          <button className="btn small" onClick={() => setClip(true)}>
            ⏺ {t("map.clip")}
          </button>
          <button className="btn small primary" onClick={() => setCine(true)}>
            🎬 {t("replay.cine")}
          </button>
        </header>
      )}
      <main className="replay-stage">
        <div ref={hostRef} className="replay-host">
          <div
            ref={frameRef}
            className="replay-frame"
            style={cine && frameSize.w ? { width: frameSize.w, height: frameSize.h } : undefined}
          >
            <TownMap
              world={game.world}
              agents={game.agents}
              selectedId={cine ? null : selectedId}
              followId={null}
              weather={game.weather}
              // Ni en el modo cine ni en los clips.
              minimap={!cine && !clip}
              onSelect={onSelect}
              onFollowChange={() => undefined}
              controller={map}
            />
            {cine && prefs.guides && (
              <div className="safe-guides" aria-hidden="true">
                <div style={{ top: 0, left: 0, right: 0, height: `${safe.top * 100}%` }} />
                <div style={{ bottom: 0, left: 0, right: 0, height: `${safe.bottom * 100}%` }} />
                <div
                  style={{
                    top: `${safe.top * 100}%`,
                    bottom: `${safe.bottom * 100}%`,
                    right: 0,
                    width: `${safe.right * 100}%`,
                  }}
                />
              </div>
            )}
            {cine && prefs.mark && (
              <div
                className="cine-mark"
                style={{
                  top: `${safe.top * 100}%`,
                  left: `${safe.left * 100}%`,
                  fontSize: fontPx * 0.5,
                }}
              >
                <div>{watermark[0]}</div>
                <strong>{watermark[1]}</strong>
              </div>
            )}
            {(cine || lines.length > 0) && (
              <div
                className={`subtitles ${cine ? "" : "inline"}`}
                role="log"
                aria-live="polite"
                aria-label={t("replay.subtitles")}
                style={
                  cine
                    ? {
                        left: `${safe.left * 100}%`,
                        right: `${safe.right * 100}%`,
                        bottom: `${safe.bottom * 100}%`,
                        fontSize: fontPx,
                      }
                    : undefined
                }
              >
                {lines.map((l) => (
                  <p key={l.id} className="subtitle">
                    <span className="subtitle-name" style={{ color: l.color }}>
                      {l.name}:
                    </span>{" "}
                    {l.text}
                  </p>
                ))}
              </div>
            )}
            {!game.loaded && <LoadingScreen />}
          </div>
        </div>
        {!cine && (
          <EventLog
            events={game.events}
            today={today}
            onOpenEvent={(id) => setCard({ kind: "rashomon", eventId: id })}
            collapsible
          />
        )}
      </main>
      {!cine && (
        <aside className="side" aria-label={t("tabs.label")}>
          <Tabs
            tabs={[
              { id: "moments", label: t("replay.moments") },
              { id: "dramas", label: t("tabs.dramas") },
              { id: "agent", label: t("tabs.agent") },
              { id: "chronicles", label: t("tabs.chronicles") },
            ]}
            active={tab}
            label={t("tabs.label")}
            onChange={setTab}
          >
            {side}
          </Tabs>
        </aside>
      )}
      <ReplayControls
        player={player}
        from={src.from}
        to={src.to}
        cine={cine}
        agents={game.agents.map((a) => ({ id: a.id, name: a.name }))}
        focusId={focusId}
        onFocus={setFocusId}
        prefs={prefs}
        onPrefs={setPrefs}
        onExitCine={() => setCine(false)}
        onClip={() => setClip(true)}
        onPrev={() => nextMoment(-1)}
        onNext={() => nextMoment(1)}
      />
      {card && cardView(card)}
      {clip && (
        <ClipRecorder
          source={() => map.current?.canvas() ?? null}
          onClose={() => setClip(false)}
          formats={
            cine ? [prefs.format, ...CLIP_FORMATS.filter((f) => f !== prefs.format)] : CLIP_FORMATS
          }
          overlay={(ctx, w, h, format) =>
            drawCineOverlay(ctx, w, h, {
              format,
              lines: linesRef.current,
              watermark: prefsRef.current.mark ? watermark : null,
            })
          }
          tabRect={() => frameRef.current?.getBoundingClientRect() ?? null}
        />
      )}
    </div>
  );
}

function ReplayControls(props: {
  player: ReplayPlayer;
  from: number;
  to: number;
  cine: boolean;
  agents: { id: string; name: string }[];
  focusId: string | null;
  onFocus: (id: string | null) => void;
  prefs: Prefs;
  onPrefs: (p: Partial<Prefs>) => void;
  onExitCine: () => void;
  onClip: () => void;
  onPrev: () => void;
  onNext: () => void;
}) {
  const { t } = useI18n();
  const { player, from, to, cine, prefs } = props;
  const ps = usePlayer(player);
  const firstDay = Math.floor(from / 1440);
  const lastDay = Math.floor(to / 1440);
  const [day, setDay] = useState(Math.floor(ps.t / 1440));
  const [hour, setHour] = useState("08:00");
  return (
    <div
      className={`replay-controls panel ${cine ? "floating" : ""}`}
      role="group"
      aria-label={t("replay.controls")}
    >
      <button
        className="btn primary"
        aria-pressed={ps.playing}
        aria-label={ps.playing ? t("replay.pause") : t("replay.play")}
        onClick={() => player.toggle()}
        data-testid="replay-play"
      >
        {ps.playing ? "⏸" : "▶"}
      </button>
      <button className="btn small" onClick={props.onPrev} aria-label={t("replay.prevMoment")}>
        ⏮
      </button>
      <button className="btn small" onClick={props.onNext} aria-label={t("replay.nextMoment")}>
        ⏭
      </button>
      <span className="replay-time" aria-live="off" data-testid="replay-time">
        {formatGameTime(ps.t)}
      </span>
      <input
        type="range"
        className="replay-slider"
        min={Math.floor(from)}
        max={Math.ceil(to)}
        step={1}
        value={Math.round(ps.t)}
        aria-label={t("replay.timeline")}
        aria-valuetext={formatGameTime(ps.t)}
        onChange={(e) => player.seek(Number(e.target.value))}
      />
      <div className="segmented" role="radiogroup" aria-label={t("replay.speed")}>
        {REPLAY_SPEEDS.map((s: ReplaySpeed) => (
          <button
            key={s}
            role="radio"
            aria-checked={ps.speed === s}
            className={`btn small ${ps.speed === s ? "active" : ""}`}
            onClick={() => player.setSpeed(s)}
          >
            x{s}
          </button>
        ))}
      </div>
      <form
        className="row replay-jump"
        onSubmit={(e) => {
          e.preventDefault();
          const [h, m] = hour.split(":").map(Number);
          player.seek(day * 1440 + (h ?? 0) * 60 + (m ?? 0));
        }}
      >
        <select
          className="field compact"
          aria-label={t("replay.day")}
          value={day}
          onChange={(e) => setDay(Number(e.target.value))}
        >
          {Array.from({ length: lastDay - firstDay + 1 }, (_, i) => firstDay + i).map((d) => (
            <option key={d} value={d}>
              {t("replay.dayN", { n: d })}
            </option>
          ))}
        </select>
        <input
          type="time"
          className="field compact"
          aria-label={t("replay.hour")}
          value={hour}
          onChange={(e) => setHour(e.target.value)}
        />
        <button className="btn small" type="submit">
          {t("replay.go")}
        </button>
      </form>
      {cine && (
        <>
          <select
            className="field compact"
            aria-label={t("replay.follow")}
            value={props.focusId ?? ""}
            onChange={(e) => props.onFocus(e.target.value || null)}
          >
            <option value="">{t("replay.followAuto")}</option>
            {props.agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          <div className="segmented" role="radiogroup" aria-label={t("clip.format")}>
            {CLIP_FORMATS.map((f) => (
              <button
                key={f}
                role="radio"
                aria-checked={prefs.format === f}
                className={`btn small ${prefs.format === f ? "active" : ""}`}
                onClick={() => props.onPrefs({ format: f })}
              >
                {f}
              </button>
            ))}
          </div>
          <button
            className={`btn small ${prefs.guides ? "active" : ""}`}
            aria-pressed={prefs.guides}
            onClick={() => props.onPrefs({ guides: !prefs.guides })}
          >
            {t("replay.guides")}
          </button>
          <button
            className={`btn small ${prefs.mark ? "active" : ""}`}
            aria-pressed={prefs.mark}
            onClick={() => props.onPrefs({ mark: !prefs.mark })}
          >
            {t("replay.mark")}
          </button>
          <button className="btn small" onClick={props.onClip}>
            ⏺ {t("map.clip")}
          </button>
          <button className="btn small" onClick={props.onExitCine}>
            ✕ {t("replay.exitCine")}
          </button>
        </>
      )}
      <span id="replay-keys" className="sr-only">
        {t("replay.keys")}
      </span>
    </div>
  );
}

function MomentsList(props: {
  moments: Moment[];
  names: Map<string, string>;
  now: number;
  kind: Moment["kind"] | "";
  onKind: (k: Moment["kind"] | "") => void;
  onGo: (m: Moment, withCard?: boolean) => void;
  cards: (m: Moment) => Card[];
  onCard: (m: Moment, c: Card) => void;
}) {
  const { t } = useI18n();
  const kinds = Object.keys(KIND_ICON) as Moment["kind"][];
  return (
    <div className="moments">
      <select
        className="field compact"
        aria-label={t("replay.momentKind")}
        value={props.kind}
        onChange={(e) => props.onKind(e.target.value as Moment["kind"] | "")}
      >
        <option value="">{t("replay.allMoments", { n: props.moments.length })}</option>
        {kinds.map((k) => (
          <option key={k} value={k}>
            {KIND_ICON[k]} {t(`replay.kind.${k}` as MessageKey)}
          </option>
        ))}
      </select>
      <ol className="moment-list readable" aria-describedby="replay-keys">
        {props.moments.map((m) => (
          <li key={m.id} className={`card moment ${m.time <= props.now ? "past" : ""}`}>
            <button className="moment-go" onClick={() => props.onGo(m)} data-testid="moment">
              <span className="small muted">
                {KIND_ICON[m.kind]} {formatGameTime(m.time)}
              </span>
              <strong>{m.title}</strong>
              {m.quote && <q className="moment-quote">{m.quote}</q>}
            </button>
            <div className="wrap small" role="group" aria-label={t("replay.cards")}>
              {props.cards(m).map((c, i) => (
                <button key={i} className="btn small" onClick={() => props.onCard(m, c)}>
                  {t(`replay.cardBtn.${c.kind}` as MessageKey, {
                    name: "agentId" in c ? (props.names.get(c.agentId) ?? "").split(" ")[0]! : "",
                  })}
                </button>
              ))}
            </div>
            <span className="small muted" title={m.why}>
              {t("replay.score", { n: m.score.toFixed(2) })}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
