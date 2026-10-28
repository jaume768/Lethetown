import { useCallback, useState } from "react";
import { TownMap } from "../game/TownMap";
import { useGame } from "../net/store";
import { AgentInspector } from "./AgentInspector";
import { CostCounter } from "./CostCounter";
import { EventLog } from "./EventLog";
import { SpeedControls } from "./SpeedControls";

export function App() {
  const game = useGame();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [followId, setFollowId] = useState<string | null>(null);
  const onSelect = useCallback((id: string) => setSelectedId(id), []);
  const selected = game.agents.find((a) => a.id === selectedId);

  return (
    <div className="layout">
      <main>
        <TownMap
          world={game.world}
          agents={game.agents}
          selectedId={selectedId}
          followId={followId}
          onSelect={onSelect}
          onFollowChange={setFollowId}
        />
        {selected && (
          <button
            className="follow"
            onClick={() => setFollowId(followId === selected.id ? null : selected.id)}
          >
            {followId === selected.id
              ? "Dejar de seguir"
              : `Seguir a ${selected.name.split(" ")[0]}`}
          </button>
        )}
        <EventLog events={game.events} />
      </main>
      <aside>
        <SpeedControls clock={game.clock} connected={game.connected} provider={game.provider} />
        <CostCounter costs={game.costs} />
        <AgentInspector agent={selected} />
      </aside>
    </div>
  );
}
