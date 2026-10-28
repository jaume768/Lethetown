import Phaser from "phaser";
import { useEffect, useRef } from "react";
import type { AgentState, World } from "@lethetown/shared";
import { TownScene } from "./TownScene";

interface Props {
  world: World | null;
  agents: AgentState[];
  selectedId: string | null;
  onSelect: (id: string) => void;
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
    townScene.onReady = () => sync(townScene, latest.current);
    scene.current = townScene;
    const game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: host.current!,
      width: 800,
      height: 610,
      backgroundColor: "#e8e2d0",
      scene: townScene,
      scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_HORIZONTALLY },
    });
    return () => {
      scene.current = null;
      game.destroy(true);
    };
  }, []);

  useEffect(() => {
    if (scene.current) scene.current.onSelect = props.onSelect;
  }, [props.onSelect]);

  useEffect(() => {
    if (scene.current) sync(scene.current, props);
  }, [props]);

  return <div ref={host} className="map" />;
}
