import Phaser from "phaser";
import { useEffect, useRef } from "react";
import type { AgentState, World } from "@lethetown/shared";
import { gameTimeNow } from "../net/store";
import { TownScene } from "./TownScene";

interface Props {
  world: World | null;
  agents: AgentState[];
  selectedId: string | null;
  followId: string | null;
  onSelect: (id: string) => void;
  onFollowChange: (id: string | null) => void;
}

function sync(scene: TownScene, { world, agents, selectedId }: Props) {
  if (!scene.ready || !world) return;
  scene.setWorld(world);
  scene.updateAgents(agents);
  scene.setSelected(selectedId);
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
    scene.current = townScene;
    // Solo en desarrollo: acceso desde la consola / scripts de captura.
    if (import.meta.env.DEV) (window as unknown as { __town: TownScene }).__town = townScene;
    const game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: host.current!,
      backgroundColor: "#1d2330",
      // Pixel art: sin suavizado y con posiciones enteras (en Phaser 4 roundPixels es false por defecto).
      pixelArt: true,
      roundPixels: true,
      scene: townScene,
      scale: { mode: Phaser.Scale.RESIZE, width: "100%", height: "100%" },
    });
    return () => {
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

  return <div ref={host} className="map" />;
}
