import {
  AssetManifest,
  UI_PIECES,
  activePack,
  assetsInUse,
  mapAssetPack,
  type AssetInUse,
  type AssetPack,
  type Credit,
} from "@lethetown/shared";
import { useEffect, useState } from "react";

export interface LoadedAssets {
  packName: string;
  pack: AssetPack | null;
  credits: Credit[];
  /** Assets en uso con licencia no comercial (aviso en modo Director). */
  nonCommercial: AssetInUse[];
  /** La piel de Modern UI cargó y sus piezas están en variables CSS. */
  uiSkin: boolean;
}

const EMPTY: LoadedAssets = {
  packName: "",
  pack: null,
  credits: [],
  nonCommercial: [],
  uiSkin: false,
};

let loading: Promise<LoadedAssets> | null = null;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`No se pudo cargar ${src}`));
    img.src = src;
  });
}

/**
 * Recorta las piezas de la hoja de UI a data URLs y las publica como variables CSS
 * (`--ui-panel`, `--ui-button`…). Si la hoja no está (sin vendor), la UI se queda con su
 * estilo propio: el CSS solo usa las piezas bajo `html.ui-skin`.
 */
async function applyUiSkin(pack: AssetPack): Promise<boolean> {
  const ui = pack.ui;
  if (!ui) return false;
  const img = await loadImage(encodeURI(`/${ui.image}`));
  const root = document.documentElement;
  for (const name of UI_PIECES) {
    const p = ui.pieces[name];
    if (!p) continue;
    const canvas = document.createElement("canvas");
    canvas.width = p.w;
    canvas.height = p.h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return false;
    ctx.drawImage(img, p.x, p.y, p.w, p.h, 0, 0, p.w, p.h);
    const css = name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
    root.style.setProperty(`--ui-${css}`, `url(${canvas.toDataURL()})`);
    root.style.setProperty(`--ui-${css}-slice`, String(p.slice));
  }
  root.classList.add("ui-skin");
  return true;
}

async function load(): Promise<LoadedAssets> {
  const [manifestJson, tmj] = await Promise.all([
    fetch("/assets/manifest.json").then((r) => r.json()),
    fetch("/api/map").then((r) => r.json()),
  ]);
  const manifest = AssetManifest.parse(manifestJson);
  const { name, pack } = activePack(manifest, mapAssetPack(tmj));
  const tilesets = (tmj as { tilesets: { name: string }[] }).tilesets.map((t) => t.name);
  const state = (await fetch("/api/state").then((r) => (r.ok ? r.json() : { agents: [] }))) as {
    agents: { id: string; appearance?: { sheet?: string } }[];
  };
  const agents = state.agents.map((a) => ({ id: a.id, sheet: a.appearance?.sheet }));
  const used = assetsInUse(pack, { tilesets, agents });
  const uiSkin = await applyUiSkin(pack).catch(() => false);
  return {
    packName: name,
    pack,
    credits: manifest.credits,
    nonCommercial: used.filter((a) => a.license === "non-commercial"),
    uiSkin,
  };
}

export function loadAssets(): Promise<LoadedAssets> {
  loading ??= load().catch((error: unknown) => {
    console.warn("No se pudo cargar el manifest de assets", error);
    return EMPTY;
  });
  return loading;
}

export function useAssets(): LoadedAssets {
  const [assets, setAssets] = useState<LoadedAssets>(EMPTY);
  useEffect(() => {
    let alive = true;
    void loadAssets().then((a) => alive && setAssets(a));
    return () => {
      alive = false;
    };
  }, []);
  return assets;
}

/** URL del retrato de un agente (`{agent}` sustituido), o null si el pack no tiene retratos. */
export function portraitUrl(pack: AssetPack | null, agentId: string, map = false): string | null {
  const p = pack?.portraits;
  if (!p) return null;
  const image = map && p.mapImage ? p.mapImage : p.image;
  return encodeURI(`/${image.replace("{agent}", agentId)}`);
}
