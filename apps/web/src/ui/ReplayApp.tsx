import type { AgentState, Drama, Moment, ReplayBundle, SimEvent } from "@lethetown/shared";
import { splitSpeech } from "@lethetown/shared";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type MutableRefObject,
  type ReactNode,
} from "react";
import { TownMap, type MapController } from "../game/TownMap";
import { t, useI18n, type MessageKey } from "../i18n";
import { ReplayPlayer } from "../net/replay-player";
import { decodeBundle, REPLAY_SPEEDS, ReplaySource, type ReplaySpeed } from "../net/replay-source";
import { LocalGame, useLocalGame } from "../net/local-game";
import { feed, startReplay, useGame } from "../net/store";
import {
  CLIP_FORMATS,
  DAY_CARD_MS,
  SAFE_ZONE,
  SPLIT_SCALE,
  directorOffsetFor,
  drawCentered,
  halfRects,
  halfSafe,
  splitStacked,
  dayAlpha,
  daySize,
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
import { MemoryStoryCard } from "./MemoryStoryCard";
import { Modal } from "./Modal";
import { NetworkModal } from "./NetworkModal";
import { RashomonModal } from "./RashomonModal";
import { SkillsPanel } from "./SkillsPanel";
import { LoadingScreen } from "./StatusOverlay";
import { cardsFor, safeReplaySrc, type Card } from "./replay-cards";
import { SCENES, sceneById, withScene } from "./scenes";
import { Tabs } from "./Tabs";

const PREF_KEY = "lethetown.replay";
interface Prefs {
  format: ClipFormat;
  guides: boolean;
  mark: boolean;
  /** Contador de días del modo cine (tecla D). */
  days: boolean;
}
function loadPrefs(): Prefs {
  const def: Prefs = { format: "9:16", guides: true, mark: true, days: true };
  try {
    const raw = JSON.parse(localStorage.getItem(PREF_KEY) ?? "{}") as Partial<Prefs>;
    return {
      format: CLIP_FORMATS.includes(raw.format as ClipFormat)
        ? (raw.format as ClipFormat)
        : def.format,
      guides: raw.guides ?? def.guides,
      mark: raw.mark ?? def.mark,
      days: raw.days ?? def.days,
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
  const params = useMemo(() => withScene(new URLSearchParams(location.search)), []);
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  /** Ya se pidió el `?src` (StrictMode monta dos veces). */
  const requested = useRef(false);

  const open = useCallback(
    async (bytes: () => Promise<ArrayBuffer>, second?: () => Promise<ArrayBuffer>) => {
      setLoading(true);
      setError(null);
      try {
        const [a, b] = await Promise.all([bytes(), second?.()]);
        setSession(createSession(await decodeBundle(a), params, b ? await decodeBundle(b) : null));
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
    // Pantalla partida: `&src2=…&split=1`.
    const raw2 = params.get("split") === "1" ? params.get("src2") : null;
    const src2 = safeReplaySrc(raw2);
    if ((raw && !src) || (raw2 && !src2)) return setError(t("replay.badSrc"));
    const get = (path: string) => async () => {
      const res = await fetch(path);
      if (!res.ok) throw new Error(`${path}: ${res.status}`);
      return res.arrayBuffer();
    };
    if (src && !requested.current) {
      requested.current = true;
      void open(get(src), src2 ? get(src2) : undefined);
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
  /** Etiqueta de la partida en la pantalla partida («Semilla 7»). */
  label: string;
  /** La segunda partida de la pantalla partida (mismo reloj, su propio estado), o null. */
  second: {
    src: ReplaySource;
    game: LocalGame;
    onSpeech: Set<(lines: SimEvent[]) => void>;
    mapUrl: string;
    label: string;
  } | null;
}

/** «Semilla 7», o el nombre del fichero si el paquete no sabe su semilla. */
function bundleLabel(bundle: ReplayBundle, path: string | null): string {
  if (bundle.meta.seed !== null) return t("replay.seedLabel", { n: bundle.meta.seed });
  return (
    (path ?? "")
      .split("/")
      .pop()
      ?.replace(/\.replay\.json(\.gz)?$|\.json(\.gz)?$/, "") ?? ""
  );
}

function createSession(
  bundle: ReplayBundle,
  params: URLSearchParams,
  bundle2: ReplayBundle | null = null,
): Session {
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
  let second: Session["second"] = null;
  if (bundle2) {
    const src2 = new ReplaySource(bundle2);
    const game = new LocalGame();
    const onSpeech2 = new Set<(lines: SimEvent[]) => void>();
    player.follow(src2, game.feed, (lines) => onSpeech2.forEach((l) => l(lines)));
    second = {
      src: src2,
      game,
      onSpeech: onSpeech2,
      mapUrl: blob(bundle2.map),
      label: bundleLabel(bundle2, params.get("src2")),
    };
  }
  const t = Number(params.get("t"));
  player.seek(Number.isFinite(t) && params.has("t") ? t : (memoryEnd(src, params) ?? src.from));
  return { src, player, onSpeech, label: bundleLabel(bundle, params.get("src")), second };
}

/** `&memory=<id>` sin `&t=`: justo después de lo último que le pasa (se ve la historia entera). */
function memoryEnd(src: ReplaySource, params: URLSearchParams): number | null {
  const id = params.get("memory");
  if (!id) return null;
  const story = src.views.story(id, src.to, src.bundle.meta.thresholds);
  const last = story?.steps.at(-1)?.at;
  return last === undefined ? null : last + 0.5;
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

type Line = SubtitleLine & { until: number };
const NO_SPEECH = new Set<(lines: SimEvent[]) => void>();

/**
 * Subtítulos y cámara del modo cine de una repetición (en pantalla partida, uno por mitad):
 * cada frase nueva entra en los subtítulos y la cámara encuadra a quien se sigue (y con quien
 * habla) o, en automático, a quien habla, quedándose en una conversación hasta que lleva 5
 * minutos callada.
 */
function useDirector(o: {
  player: ReplayPlayer;
  onSpeech: Set<(lines: SimEvent[]) => void>;
  agents: AgentState[];
  cine: boolean;
  focusId: string | null;
  map: MutableRefObject<MapController | null>;
}) {
  const { player, onSpeech, cine, focusId, map } = o;
  const [lines, setLines] = useState<Line[]>([]);
  const conversation = useRef<{ ids: string[]; at: number } | null>(null);
  const agentsRef = useRef(o.agents);
  agentsRef.current = o.agents;
  const focusRef = useRef(focusId);
  focusRef.current = focusId;

  useEffect(() => {
    const onLines = (evs: SimEvent[]) => {
      const focus = focusRef.current;
      const current = conversation.current;
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
    onSpeech.add(onLines);
    const prune = setInterval(() => {
      const now = performance.now();
      setLines((old) => (old.some((l) => l.until < now) ? old.filter((l) => l.until >= now) : old));
    }, 250);
    return () => {
      onSpeech.delete(onLines);
      clearInterval(prune);
    };
  }, [onSpeech, player]);

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
  }, [cine, focusId, player, map]);

  return { lines, conversation };
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
  const scene = useMemo(() => sceneById(params.get("scene")), [params]);
  // El formato de la escena (sin guardarlo en las preferencias).
  const [prefs, setPrefsState] = useState(() =>
    scene ? { ...loadPrefs(), format: scene.format } : loadPrefs(),
  );
  const setPrefs = (p: Partial<Prefs>) =>
    setPrefsState((old) => {
      const next = { ...old, ...p };
      savePrefs(next);
      return next;
    });
  const [tab, setTab] = useState<"moments" | "scenes" | "dramas" | "agent" | "chronicles">(
    scene ? "scenes" : params.get("agent") && !params.get("memory") ? "agent" : "moments",
  );
  /** `&agent=`, o el dueño del recuerdo de `&memory=`. */
  const initialAgent = useMemo(() => {
    const memoryId = params.get("memory");
    const owner = memoryId ? src.views.story(memoryId, src.to)?.agentId : undefined;
    return params.get("agent") ?? owner ?? null;
  }, [params, src]);
  const [selectedId, setSelectedId] = useState<string | null>(initialAgent);
  /** A quién sigue la cámara del modo cine (null = automático: quien habla). */
  const [focusId, setFocusId] = useState<string | null>(initialAgent);
  const [card, setCard] = useState<Card | null>(() => {
    const memoryId = params.get("memory");
    return memoryId ? { kind: "memory", memoryId } : null;
  });
  const [clip, setClip] = useState(false);
  const [frameSize, setFrameSize] = useState({ w: 0, h: 0 });
  const [kindFilter, setKindFilter] = useState<Moment["kind"] | "">("");
  const second = session.second;
  const game2 = useLocalGame(second?.game ?? null);
  const split = second !== null;
  const map2 = useRef<MapController | null>(null);
  const { lines, conversation } = useDirector({
    player,
    onSpeech: session.onSpeech,
    agents: game.agents,
    cine,
    focusId,
    map,
  });
  const { lines: lines2 } = useDirector({
    player,
    onSpeech: second?.onSpeech ?? NO_SPEECH,
    agents: game2.agents,
    cine,
    focusId,
    map: map2,
  });

  // `&agent=`: la cámara empieza en él (la orden espera a que exista la escena).
  useEffect(() => {
    if (initialAgent) map.current?.focusAgent(initialAgent);
    if (initialAgent) map2.current?.focusAgent(initialAgent);
  }, [initialAgent]);

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
      else if (k === "d" && cine) setPrefs({ days: !prefs.days });
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
  const lines2Ref = useRef(lines2);
  lines2Ref.current = lines2;

  // Contador de días: al cambiar de día y en cada salto, un rato.
  const [dayUntil, setDayUntil] = useState(0);
  const [, setDayTick] = useState(0);
  const dayUntilRef = useRef(dayUntil);
  dayUntilRef.current = dayUntil;
  useEffect(() => {
    if (cine && prefs.days) setDayUntil(performance.now() + DAY_CARD_MS);
  }, [today, ps.seeks, cine, prefs.days]);
  useEffect(() => {
    if (!dayUntil) return;
    // Repinta mientras se apaga (para la opacidad en pantalla).
    const timer = setInterval(() => {
      setDayTick((n) => n + 1);
      if (performance.now() > dayUntilRef.current) {
        clearInterval(timer);
        setDayUntil(0);
      }
    }, 100);
    return () => clearInterval(timer);
  }, [dayUntil]);
  const dayLabel = t("replay.dayN", { n: today });
  const dayRef = useRef({ label: dayLabel, on: false });
  dayRef.current = { label: dayLabel, on: cine && prefs.days };
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;

  const onSelect = useCallback((id: string) => {
    setSelectedId(id);
    setFocusId(id);
    setTab("agent");
  }, []);

  const cardView = (c: Card): ReactNode => {
    if (c.kind === "memory") {
      const story = src.views.story(c.memoryId, ps.t, meta.thresholds);
      const owner = story ? (src.names.get(story.agentId) ?? story.agentId) : "";
      return (
        <Modal
          title={t("replay.card.memory", { name: owner.split(" ")[0]! })}
          onClose={() => setCard(null)}
          className="cine-card"
        >
          <MemoryStoryCard story={story} />
        </Modal>
      );
    }
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
      case "scenes":
        return <ScenesList current={scene?.id ?? null} />;
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
  /** Pantalla partida: arriba y abajo en 9:16 (y en el móvil), si no, una al lado de la otra. */
  const stacked = cine && splitStacked(prefs.format);
  const markWidth = stacked ? 0.5 : 0.3;
  const own2 = useMemo(
    () =>
      second && {
        mapUrl: second.mapUrl,
        isThinking: (id: string) => (second.game.get().thinking[id]?.count ?? 0) > 0,
        onMemoryEffect: second.game.onMemoryEffect,
      },
    [second],
  );
  // Escena: su velocidad, y al acabar un plano, el siguiente (o pausa al final).
  useEffect(() => {
    if (scene) player.setSpeed(scene.speed);
  }, [scene, player]);
  const inShot = useRef<number | null>(null);
  useEffect(() => {
    if (!scene) return;
    const i = scene.shots.findIndex((x) => ps.t >= x.from - 0.01 && ps.t < x.to);
    if (i >= 0) {
      inShot.current = i;
      return;
    }
    const was = inShot.current;
    inShot.current = null;
    if (was === null || !ps.playing) return;
    const next = scene.shots[was + 1];
    if (next) player.seek(next.from);
    else player.pause();
  }, [scene, player, ps.t, ps.playing]);

  // Encuadre de cada mitad: en medio de lo que se ve de ella (zona segura y subtítulos).
  useEffect(() => {
    if (!cine) return;
    map.current?.directOffset(
      directorOffsetFor(split ? halfSafe(prefs.format, 0) : SAFE_ZONE[prefs.format]),
    );
    map2.current?.directOffset(directorOffsetFor(halfSafe(prefs.format, 1)));
  }, [cine, split, prefs.format]);

  /** El clip de la pantalla partida: los dos lienzos compuestos en uno, cada uno con lo suyo. */
  const paintSplit = (ctx: CanvasRenderingContext2D, W: number, H: number, format: ClipFormat) => {
    ctx.fillStyle = "#1d2330";
    ctx.fillRect(0, 0, W, H);
    const canvases = [map.current?.canvas() ?? null, map2.current?.canvas() ?? null];
    const labels = [session.label, second?.label ?? ""];
    const halfLines = [linesRef.current, lines2Ref.current];
    halfRects(format, W, H).forEach((r, i) => {
      const c = canvases[i];
      if (c) drawCentered(ctx, c, r);
      ctx.save();
      ctx.translate(r.x, r.y);
      ctx.beginPath();
      ctx.rect(0, 0, r.w, r.h);
      ctx.clip();
      drawCineOverlay(ctx, r.w, r.h, {
        format,
        lines: halfLines[i]!,
        watermark: null,
        label: labels[i],
        safe: halfSafe(format, i as 0 | 1),
        scale: (SPLIT_SCALE * H) / r.h,
      });
      ctx.restore();
    });
    // La raya entre las dos.
    ctx.fillStyle = "#10131b";
    if (splitStacked(format)) ctx.fillRect(0, Math.round(H / 2) - 2, W, 4);
    else ctx.fillRect(Math.round(W / 2) - 2, 0, 4, H);
    drawCineOverlay(ctx, W, H, {
      format,
      lines: [],
      watermark: prefsRef.current.mark ? watermark : null,
      markWidth: splitStacked(format) ? 0.5 : 0.3,
      day: dayRef.current.on
        ? { label: dayRef.current.label, alpha: dayAlpha(dayUntilRef.current, performance.now()) }
        : null,
    });
  };
  const halfView = (i: 0 | 1) => {
    const g = i === 0 ? game : game2;
    const hs = cine ? halfSafe(prefs.format, i) : null;
    return (
      <div className="replay-half" key={i}>
        <TownMap
          world={g.world}
          agents={g.agents}
          selectedId={cine || i === 1 ? null : selectedId}
          followId={null}
          weather={g.weather}
          minimap={false}
          onSelect={i === 0 ? onSelect : () => undefined}
          onFollowChange={() => undefined}
          controller={i === 0 ? map : map2}
          own={i === 0 ? undefined : (own2 ?? undefined)}
        />
        <div
          className="half-label"
          data-testid="split-label"
          style={
            hs
              ? { top: `${hs.top * 100}%`, right: `${hs.right * 100}%`, fontSize: fontPx * 0.45 }
              : undefined
          }
        >
          {i === 0 ? session.label : second?.label}
        </div>
        <Subtitles
          lines={i === 0 ? lines : lines2}
          cine={cine}
          safe={hs}
          fontPx={fontPx * SPLIT_SCALE}
        />
        {!g.loaded && <LoadingScreen />}
      </div>
    );
  };

  return (
    <div
      className={`replay ${cine ? "cine" : ""}`}
      // Las tarjetas del modo cine caben en el marco (para grabar la pestaña).
      style={
        cine && frameSize.w
          ? ({
              "--frame-w": `${frameSize.w}px`,
              "--frame-h": `${frameSize.h}px`,
            } as CSSProperties)
          : undefined
      }
    >
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
            className={`replay-frame ${split ? `split ${stacked ? "stack" : "side"}` : ""}`}
            style={cine && frameSize.w ? { width: frameSize.w, height: frameSize.h } : undefined}
          >
            {split ? (
              <>
                {halfView(0)}
                {halfView(1)}
              </>
            ) : (
              <>
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
                <Subtitles lines={lines} cine={cine} safe={safe} fontPx={fontPx} />
              </>
            )}
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
                  ...(split ? { maxWidth: `${markWidth * 100}%` } : {}),
                }}
              >
                <div>{watermark[0]}</div>
                <strong>{watermark[1]}</strong>
              </div>
            )}
            {cine && prefs.days && dayUntil > 0 && (
              <div
                className="cine-day"
                role="status"
                data-testid="cine-day"
                style={{
                  top: `${(safe.top + (1 - safe.top - safe.bottom) * 0.18) * 100}%`,
                  fontSize: daySize(prefs.format, frameSize.h),
                  opacity: dayAlpha(dayUntil, performance.now()),
                }}
              >
                {dayLabel}
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
              { id: "scenes", label: t("replay.scenes") },
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
              day: dayRef.current.on
                ? {
                    label: dayRef.current.label,
                    alpha: dayAlpha(dayUntilRef.current, performance.now()),
                  }
                : null,
            })
          }
          paint={split ? paintSplit : undefined}
          tabRect={() => frameRef.current?.getBoundingClientRect() ?? null}
        />
      )}
    </div>
  );
}

/** Subtítulos: grandes y dentro de la zona segura en el modo cine; si no, en línea. */
function Subtitles(props: {
  lines: Line[];
  cine: boolean;
  safe: { top: number; bottom: number; left: number; right: number } | null;
  fontPx: number;
}) {
  const { t } = useI18n();
  const { lines, cine, safe } = props;
  if (!cine && !lines.length) return null;
  return (
    <div
      className={`subtitles ${cine ? "" : "inline"}`}
      role="log"
      aria-live="polite"
      aria-label={t("replay.subtitles")}
      style={
        cine && safe
          ? {
              left: `${safe.left * 100}%`,
              right: `${safe.right * 100}%`,
              bottom: `${safe.bottom * 100}%`,
              fontSize: props.fontPx,
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
  );
}

/** Pestaña «Escenas»: las de `docs/videos/escenas.json` (cada una abre su repetición). */
function ScenesList({ current }: { current: string | null }) {
  const { t } = useI18n();
  return (
    <ol className="moment-list readable" data-testid="scenes">
      {SCENES.map((s) => (
        <li key={s.id} className={`card moment ${s.id === current ? "active" : ""}`}>
          <a
            className="moment-go"
            href={`/replay?scene=${s.id}`}
            aria-current={s.id === current ? "true" : undefined}
          >
            <span className="small muted">
              🎬 {s.src}
              {s.src2 ? ` | ${s.src2}` : ""} · {formatGameTime(s.shots[0]!.from)} · {s.format} · x
              {s.speed}
            </span>
            <strong>{s.title}</strong>
            {s.quote && <q className="moment-quote">{s.quote}</q>}
          </a>
          <span className="small muted">
            {t("replay.sceneShots", { n: s.shots.length })}
            {s.memory ? ` · ${t("replay.cardBtn.memory")}` : ""}
          </span>
        </li>
      ))}
    </ol>
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
          <button
            className={`btn small ${prefs.days ? "active" : ""}`}
            aria-pressed={prefs.days}
            onClick={() => props.onPrefs({ days: !prefs.days })}
          >
            {t("replay.days")}
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
