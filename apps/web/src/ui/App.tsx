import type { AffinityIcon, Drama, NotesResponse } from "@lethetown/shared";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { TownMap, type MapController } from "../game/TownMap";
import { useI18n } from "../i18n";
import { useAssets } from "../net/assets";
import { hasRole, logout, refreshMe, useAuth } from "../net/auth";
import { api, useGame } from "../net/store";
import { ChroniclePanel } from "./ChroniclePanel";
import { ClipRecorder } from "./ClipRecorder";
import { CreditsModal } from "./Credits";
import { DirectorPanel } from "./DirectorPanel";
import { EvolutionPanel } from "./EvolutionPanel";
import { DramaFeed } from "./DramaFeed";
import { EventLog } from "./EventLog";
import { Header, type Mode } from "./Header";
import { initialParams } from "./links";
import { LoginDialog } from "./LoginDialog";
import { MemoryGarden } from "./MemoryGarden";
import { NetworkModal } from "./NetworkModal";
import { Onboarding, shouldOnboard } from "./Onboarding";
import { RashomonModal } from "./RashomonModal";
import { ConnectionBanner, LoadingScreen, PausedOverlay } from "./StatusOverlay";
import { Tabs, type TabDef } from "./Tabs";
import { usePolled } from "./usePolled";

type TabId = "dramas" | "agent" | "events" | "chronicles" | "director" | "evolution";
const MODE_KEY = "lethetown.mode";
const MOBILE = "(max-width: 760px)";

function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia(query);
      mq.addEventListener("change", cb);
      return () => mq.removeEventListener("change", cb);
    },
    () => window.matchMedia(query).matches,
  );
}

function savedMode(): Mode {
  try {
    return localStorage.getItem(MODE_KEY) === "director" ? "director" : "spectator";
  } catch {
    return "spectator";
  }
}

export function App() {
  const { t } = useI18n();
  const game = useGame();
  // Notas del tablón de la plaza (para el marcador del mapa).
  const notes = usePolled<NotesResponse>("/api/notes", "notes", 30_000);
  const boardNotes = notes?.items.filter((n) => n.kind === "public").length ?? 0;
  const { user } = useAuth();
  const assets = useAssets();
  const mobile = useMediaQuery(MOBILE);
  const map = useRef<MapController | null>(null);
  const params = useRef(initialParams());

  const [mode, setModeState] = useState<Mode>(savedMode);
  const [tab, setTab] = useState<TabId>("dramas");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(params.current.agent);
  const [followId, setFollowId] = useState<string | null>(null);
  const [minimap, setMinimap] = useState(!window.matchMedia(MOBILE).matches);
  const [rashomonId, setRashomonId] = useState<string | null>(params.current.event);
  const [dialog, setDialog] = useState<"login" | "credits" | "clip" | "onboarding" | null>(
    shouldOnboard() ? "onboarding" : null,
  );
  const [seenDramas, setSeenDramas] = useState(0);
  /** Marcas de afinidad sobre el mapa (lo que el seleccionado piensa de los demás). */
  const [marksOn, setMarksOn] = useState(false);
  const [marks, setMarks] = useState<Record<string, AffinityIcon> | null>(null);
  const [network, setNetwork] = useState(false);
  const mapWrap = useRef<HTMLDivElement>(null);
  const [nativeFull, setNativeFull] = useState(false);
  /** Sin Fullscreen API (iOS): el mapa se fija a toda la ventana con CSS. */
  const [pseudoFull, setPseudoFull] = useState(false);
  const fullscreen = nativeFull || pseudoFull;

  useEffect(() => {
    const onChange = () => setNativeFull(document.fullscreenElement === mapWrap.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);
  useEffect(() => {
    if (!pseudoFull) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setPseudoFull(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pseudoFull]);

  const exitFullscreen = () => {
    setPseudoFull(false);
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
  };
  const toggleFullscreen = () => {
    const el = mapWrap.current;
    if (!el) return;
    if (fullscreen) return exitFullscreen();
    if (el.requestFullscreen) void el.requestFullscreen().catch(() => setPseudoFull(true));
    else setPseudoFull(true);
  };

  useEffect(() => {
    void refreshMe();
  }, []);

  const director = mode === "director" && hasRole(user, "director");
  const setMode = (m: Mode) => {
    if (m === "director" && !hasRole(user, "director")) return setDialog("login");
    setModeState(m);
    try {
      localStorage.setItem(MODE_KEY, m);
    } catch {
      /* no se recuerda el modo: no pasa nada */
    }
    if (m === "director") {
      setTab("director");
      if (mobile) setSheetOpen(true);
    } else if (tab === "director") setTab("dramas");
  };

  const onSelect = useCallback(
    (id: string) => {
      setSelectedId(id);
      setTab("agent");
      if (mobile) setSheetOpen(true);
    },
    [mobile],
  );

  const goTo = useCallback(
    (d: Drama) => {
      if (d.placeId) map.current?.focusPlace(d.placeId);
      if (d.agents[0]) setSelectedId(d.agents[0]);
      if (mobile) setSheetOpen(false);
    },
    [mobile],
  );

  // Enlace permanente a un drama: ir a verlo en cuanto llegue la lista.
  useEffect(() => {
    const id = params.current.drama;
    if (!id || !game.loaded) return;
    const d = game.dramas.find((x) => x.id === id);
    if (d) {
      params.current.drama = null;
      // Espera un poco a que el mapa esté construido.
      setTimeout(() => goTo(d), 500);
    }
  }, [game.dramas, game.loaded, goTo]);

  useEffect(() => {
    if (tab === "dramas") setSeenDramas(game.dramas.length);
  }, [tab, game.dramas.length]);

  const selected = game.agents.find((a) => a.id === selectedId);
  const today = Math.floor(game.clock.time / 1440);
  const thinking = selectedId ? game.thinking[selectedId] : undefined;
  const newDramas = tab === "dramas" ? 0 : Math.max(0, game.dramas.length - seenDramas);

  const tabs: TabDef<TabId>[] = [
    { id: "dramas", label: t("tabs.dramas"), badge: newDramas },
    { id: "agent", label: t("tabs.agent") },
    ...(mobile ? [{ id: "events" as const, label: t("tabs.events") }] : []),
    { id: "chronicles", label: t("tabs.chronicles") },
    ...(director ? [{ id: "director" as const, label: t("tabs.director") }] : []),
    ...(director && hasRole(user, "admin")
      ? [{ id: "evolution" as const, label: t("tabs.evolution") }]
      : []),
  ];
  const activeTab = tabs.some((x) => x.id === tab) ? tab : "dramas";

  const panel = (() => {
    switch (activeTab) {
      case "dramas":
        return <DramaFeed dramas={game.dramas} onGoTo={goTo} onOpenEvent={setRashomonId} />;
      case "agent":
        return (
          <MemoryGarden
            agent={selected}
            agents={game.agents}
            world={game.world}
            thinkingTask={thinking && thinking.count > 0 ? thinking.task : null}
            canIntervene={director}
            onFocus={(id, reveal) => {
              map.current?.focusAgent(id);
              if (mobile && reveal) setSheetOpen(false);
            }}
            onSelectAgent={onSelect}
            marksOn={marksOn}
            onMarksOn={setMarksOn}
            onMarks={setMarks}
            onOpenNetwork={() => {
              exitFullscreen();
              setNetwork(true);
            }}
          />
        );
      case "events":
        return <EventLog events={game.events} today={today} onOpenEvent={setRashomonId} />;
      case "chronicles":
        return <ChroniclePanel chronicles={game.chronicles} />;
      case "director":
        return user ? <DirectorPanel game={game} user={user} /> : null;
      case "evolution":
        return <EvolutionPanel />;
    }
  })();

  return (
    <div
      className={`app ${mobile ? "mobile" : ""} ${director ? "mode-director" : "mode-spectator"}`}
    >
      <a href="#side" className="skip-link">
        {t("app.skip")}
      </a>
      <Header
        clock={game.clock}
        weather={game.weather}
        connected={game.connected}
        mode={director ? "director" : "spectator"}
        user={user}
        onMode={setMode}
        onLogin={() => setDialog("login")}
        onLogout={() => {
          void logout();
          setModeState("spectator");
        }}
        onHelp={() => setDialog("onboarding")}
        onCredits={() => setDialog("credits")}
      />
      <ConnectionBanner connected={game.connected} retries={game.retries} />
      <main className="stage">
        <div ref={mapWrap} className={`map-wrap ${pseudoFull ? "fullscreen" : ""}`}>
          <TownMap
            world={game.world}
            agents={game.agents}
            selectedId={selectedId}
            followId={followId}
            weather={game.weather}
            minimap={minimap}
            boardNotes={boardNotes}
            affinityMarks={marksOn ? marks : null}
            onSelect={onSelect}
            onFollowChange={setFollowId}
            controller={map}
          />
          <div className="map-toolbar wrap">
            <select
              className="field compact"
              aria-label={t("map.selectAgent")}
              value={selectedId ?? ""}
              onChange={(e) => e.target.value && onSelect(e.target.value)}
            >
              <option value="">{t("map.selectAgent")}</option>
              {game.agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
            <button
              className={`btn small ${minimap ? "active" : ""}`}
              aria-pressed={minimap}
              onClick={() => setMinimap(!minimap)}
            >
              {t("map.minimap")}
            </button>
            {selected && (
              <button
                className={`btn small ${followId === selected.id ? "active" : ""}`}
                aria-pressed={followId === selected.id}
                onClick={() => setFollowId(followId === selected.id ? null : selected.id)}
              >
                {followId === selected.id
                  ? t("map.unfollow")
                  : t("map.follow", { name: selected.name.split(" ")[0] ?? selected.name })}
              </button>
            )}
            <button
              className="btn small"
              onClick={() => {
                // Los diálogos van fuera del mapa: en pantalla completa no se verían.
                exitFullscreen();
                setDialog("clip");
              }}
            >
              ⏺ {t("map.clip")}
            </button>
            <button
              className={`btn small ${fullscreen ? "active" : ""}`}
              aria-pressed={fullscreen}
              onClick={toggleFullscreen}
            >
              {fullscreen ? "✕" : "⛶"} {t(fullscreen ? "map.exitFullscreen" : "map.fullscreen")}
            </button>
          </div>
          <PausedOverlay
            status={game.status}
            canResume={director}
            onResume={() => void api("/api/resume", {}).catch(() => undefined)}
          />
          {!game.loaded && <LoadingScreen />}
        </div>
        {!mobile && (
          <EventLog events={game.events} today={today} onOpenEvent={setRashomonId} collapsible />
        )}
      </main>
      <aside
        id="side"
        className={`side ${mobile ? "sheet" : ""} ${sheetOpen ? "open" : ""}`}
        aria-label={t("tabs.label")}
      >
        {mobile && (
          <button
            className="sheet-handle"
            aria-expanded={sheetOpen}
            aria-controls="side-tabs"
            onClick={() => setSheetOpen(!sheetOpen)}
          >
            {sheetOpen ? "▼" : "▲"} {tabs.find((x) => x.id === activeTab)?.label}
          </button>
        )}
        <div id="side-tabs">
          <Tabs
            tabs={tabs}
            active={activeTab}
            label={t("tabs.label")}
            onChange={(id) => {
              setTab(id);
              if (mobile) setSheetOpen(true);
            }}
          >
            {panel}
          </Tabs>
        </div>
      </aside>

      {rashomonId && <RashomonModal eventId={rashomonId} onClose={() => setRashomonId(null)} />}
      {network && <NetworkModal onSelect={onSelect} onClose={() => setNetwork(false)} />}
      {dialog === "login" && (
        <LoginDialog
          onClose={() => setDialog(null)}
          onDone={() => {
            setDialog(null);
            setModeState("director");
            setTab("director");
            if (mobile) setSheetOpen(true);
          }}
        />
      )}
      {dialog === "credits" && (
        <CreditsModal credits={assets.credits} onClose={() => setDialog(null)} />
      )}
      {dialog === "clip" && (
        <ClipRecorder
          source={() => map.current?.canvas() ?? null}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === "onboarding" && <Onboarding onClose={() => setDialog(null)} />}
    </div>
  );
}
