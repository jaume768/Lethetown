import type { AssetPack, PortraitAnimation } from "@lethetown/shared";
import { useEffect, useState, type CSSProperties } from "react";
import { portraitUrl } from "../net/assets";

interface Props {
  pack: AssetPack | null;
  agentId: string;
  name: string;
  /** Animación en bucle; sin ella se muestra el primer frame de `talk` (cara quieta). */
  animation?: PortraitAnimation | null;
  /** Tamaño en px de pantalla (múltiplo del frame para que el pixel art quede nítido). */
  size?: number;
}

/**
 * Retrato animado de un agente (Portrait Generator). Si el pack no tiene retratos o la imagen
 * no carga, muestra la inicial del nombre.
 */
export function Portrait({ pack, agentId, name, animation = null, size = 64 }: Props) {
  const url = portraitUrl(pack, agentId);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setFailed(false);
    if (!url) return;
    const img = new Image();
    img.onerror = () => setFailed(true);
    img.src = url;
  }, [url]);

  const p = pack?.portraits;
  if (!url || !p || failed) {
    return (
      <div className="portrait fallback" style={{ width: size, height: size }} aria-hidden="true">
        {name.charAt(0)}
      </div>
    );
  }
  const anim = p.animations[animation ?? "talk"];
  const row = anim?.row ?? 0;
  const style = {
    width: size,
    height: size,
    backgroundImage: `url(${url})`,
    backgroundSize: `${p.columns * size}px auto`,
    backgroundPositionY: `${-row * size}px`,
    "--portrait-end": `${-(anim?.count ?? 1) * size}px`,
    "--portrait-steps": anim?.count ?? 1,
    "--portrait-duration": `${(anim?.count ?? 1) / (anim?.frameRate ?? 8)}s`,
  } as CSSProperties;
  return (
    <div
      className={`portrait ${animation ? "animated" : ""}`}
      style={style}
      role="img"
      aria-label={`Retrato de ${name}`}
    />
  );
}
