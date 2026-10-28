import { useCallback, useState } from "react";
import { TownMap } from "../game/TownMap";
import { useGame } from "../net/store";
import { ChroniclePanel } from "./ChroniclePanel";
import { CostCounter } from "./CostCounter";
import { EventLog } from "./EventLog";
import { MemoryGarden } from "./MemoryGarden";
import { RashomonModal } from "./RashomonModal";
import { SpeedControls } from "./SpeedControls";
import { WorldPanel } from "./WorldPanel";

export function App() {
  const game = useGame();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [followId, setFollowId] = useState<string | null>(null);
  const [minimap, setMinimap] = useState(true);
  const [rashomonId, setRashomonId] = useState<string | null>(null);
  const onSelect = useCallback((id: string) => setSelectedId(id), []);
  const selected = game.agents.find((a) => a.id === selectedId);
  const today = Math.floor(game.clock.time / 1440);
  const thinking = selectedId ? game.thinking[selectedId] : undefined;

  return (
    <div className="layout">
      <main>
        <TownMap
          world={game.world}
          agents={game.agents}
          selectedId={selectedId}
          followId={followId}
          weather={game.weather}
          minimap={minimap}
          onSelect={onSelect}
          onFollowChange={setFollowId}
        />
        <div className="follow wrap">
          <button
            className={`btn small ${minimap ? "active" : ""}`}
            onClick={() => setMinimap(!minimap)}
          >
            Minimapa
          </button>
          {selected && (
            <button
              className={`btn small ${followId === selected.id ? "active" : ""}`}
              onClick={() => setFollowId(followId === selected.id ? null : selected.id)}
            >
              {followId === selected.id
                ? "Dejar de seguir"
                : `Seguir a ${selected.name.split(" ")[0]}`}
            </button>
          )}
        </div>
        <EventLog events={game.events} today={today} onOpenEvent={setRashomonId} />
      </main>
      <aside>
        <SpeedControls clock={game.clock} connected={game.connected} provider={game.provider} />
        <CostCounter costs={game.costs} />
        <MemoryGarden
          agent={selected}
          agents={game.agents}
          world={game.world}
          thinkingTask={thinking && thinking.count > 0 ? thinking.task : null}
        />
        <WorldPanel world={game.world} weather={game.weather} />
        <ChroniclePanel chronicles={game.chronicles} day={today} />
      </aside>
      {rashomonId && <RashomonModal eventId={rashomonId} onClose={() => setRashomonId(null)} />}
    </div>
  );
}
