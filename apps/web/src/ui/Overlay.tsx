import { useCallback, useEffect } from "react";
import { TownMap } from "../game/TownMap";
import { useI18n } from "../i18n";
import { useGame } from "../net/store";
import { DramaFeed } from "./DramaFeed";
import { formatGameTime } from "./format";

/**
 * Overlay para OBS (`/overlay?world=…`): fondo transparente con el mapa, el reloj y los últimos
 * dramas. Sin controles ni datos de depuración.
 */
export function Overlay() {
  const { t } = useI18n();
  const game = useGame();
  const noop = useCallback(() => {}, []);
  useEffect(() => {
    document.documentElement.classList.add("overlay-mode");
    return () => document.documentElement.classList.remove("overlay-mode");
  }, []);
  return (
    <div className="overlay">
      <TownMap
        world={game.world}
        agents={game.agents}
        selectedId={null}
        followId={null}
        weather={game.weather}
        minimap={false}
        onSelect={noop}
        onFollowChange={noop}
        transparent
      />
      <div className="overlay-clock">{formatGameTime(game.clock.time)}</div>
      <div className="overlay-dramas">
        <h2 className="small">{t("overlay.latest")}</h2>
        <DramaFeed dramas={game.dramas} onGoTo={noop} onOpenEvent={noop} compact limit={3} />
      </div>
      <div className="overlay-mark">lethetown.com</div>
    </div>
  );
}
