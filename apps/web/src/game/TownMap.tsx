import Phaser from "phaser";
import { useEffect, useRef } from "react";
import type { AffinityIcon, AgentState, Weather, World } from "@lethetown/shared";
import { gameTimeNow, getState, onMemoryEffect } from "../net/store";
import { t } from "../i18n";
import { TownScene } from "./TownScene";

/** Lo que la UI puede pedirle al mapa (botones, teclado, clips). */
export interface MapController {
  focusPlace(placeId: string): void;
  /** Centra la cámara en un agente sin seleccionarlo. */
  focusAgent(agentId: string): void;
  nudge(dx: number, dy: number): void;
  zoom(step: number): void;
  canvas(): HTMLCanvasElement | null;
}

interface Props {
  world: World | null;
  agents: AgentState[];
  selectedId: string | null;
  followId: string | null;
  weather: Weather;
  minimap: boolean;
  /** Notas vivas en el tablón de la plaza. */
  boardNotes?: number;
  /** Lo que el seleccionado piensa de los demás, como marca sobre cada uno (o nada). */
  affinityMarks?: Record<string, AffinityIcon> | null;
  onSelect: (id: string) => void;
  onFollowChange: (id: string | null) => void;
  /** Overlay para OBS: fondo transparente y sin minimapa. */
  transparent?: boolean;
  controller?: { current: MapController | null };
}

function sync(
  scene: TownScene,
  { world, agents, selectedId, weather, minimap, affinityMarks, boardNotes }: Props,
) {
  if (!scene.ready || !world) return;
  scene.setWorld(world);
  scene.updateAgents(agents);
  scene.setSelected(selectedId);
  scene.setAffinityMarks(affinityMarks ?? null);
  scene.setWeather(weather);
  scene.setMinimapVisible(minimap);
  scene.setBoardNotes(boardNotes ?? 0);
}

export function TownMap(props: Props) {
  const host = useRef<HTMLDivElement>(null);
  const scene = useRef<TownScene | null>(null);
  const latest = useRef(props);
  latest.current = props;

  useEffect(() => {
    const townScene = new TownScene();
    townScene.onReady = () => {
      sync(townScene, latest.current);
      townScene.setFollow(latest.current.followId);
    };
    townScene.gameTime = gameTimeNow;
    townScene.isThinking = (id) => (getState().thinking[id]?.count ?? 0) > 0;
    const offEffects = onMemoryEffect((e) => townScene.memoryEffect(e.agentId, e.kind));
    scene.current = townScene;
    if (latest.current.controller) {
      latest.current.controller.current = {
        focusPlace: (id) => townScene.focusPlace(id),
        focusAgent: (id) => townScene.focusAgent(id),
        nudge: (dx, dy) => townScene.nudgeCamera(dx, dy),
        zoom: (step) => townScene.zoomBy(step),
        canvas: () => (townScene.ready ? townScene.canvas : null),
      };
    }
    // Solo en desarrollo: acceso desde la consola / scripts de captura.
    if (import.meta.env.DEV) (window as unknown as { __town: TownScene }).__town = townScene;
    const transparent = latest.current.transparent ?? false;
    const game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: host.current!,
      backgroundColor: transparent ? "rgba(0,0,0,0)" : "#1d2330",
      transparent,
      // Para poder grabar el lienzo (clips) tras pintar cada frame.
      render: { preserveDrawingBuffer: true },
      // Pixel art: sin suavizado y con posiciones enteras (en Phaser 4 roundPixels es false por defecto).
      pixelArt: true,
      roundPixels: true,
      scene: townScene,
      scale: { mode: Phaser.Scale.RESIZE, width: "100%", height: "100%" },
    });
    return () => {
      offEffects();
      scene.current = null;
      game.destroy(true);
    };
  }, []);

  useEffect(() => {
    if (!scene.current) return;
    scene.current.onSelect = props.onSelect;
    scene.current.onFollowChange = props.onFollowChange;
  }, [props.onSelect, props.onFollowChange]);

  useEffect(() => {
    if (scene.current) sync(scene.current, props);
  }, [props]);

  useEffect(() => {
    if (scene.current?.ready) scene.current.setFollow(props.followId);
  }, [props.followId]);

  return (
    <div
      ref={host}
      className="map"
      role="application"
      aria-label={t("map.label")}
      aria-describedby="map-keys"
      tabIndex={0}
      onKeyDown={(e) => {
        const c = props.controller?.current;
        if (!c) return;
        const moves: Record<string, [number, number]> = {
          ArrowLeft: [-1, 0],
          ArrowRight: [1, 0],
          ArrowUp: [0, -1],
          ArrowDown: [0, 1],
        };
        const m = moves[e.key];
        if (m) c.nudge(m[0], m[1]);
        else if (e.key === "+" || e.key === "=") c.zoom(1);
        else if (e.key === "-") c.zoom(-1);
        else return;
        e.preventDefault();
      }}
    >
      <span id="map-keys" className="sr-only">
        {t("map.keys")}
      </span>
    </div>
  );
}
