import {
  AssetManifest,
  activePack,
  characterFor,
  mapAssetPack,
  recolorPixels,
  positionAt,
  type AgentState,
  type AssetPack,
  type Weather,
  type World,
} from "@lethetown/shared";
import Phaser from "phaser";
import { AgentView, PIXEL_FONT } from "./AgentView";
import { Ambience } from "./Ambience";
import { createPixelTextures } from "./pixelArt";

const TS = 16;
const ZOOM_MIN = 1;
const ZOOM_MAX = 4;
/** Opacidad de un tejado con alguien dentro (o con el ratón encima). */
const ROOF_HIDDEN_ALPHA = 0;
const MINIMAP_WIDTH = 192;

/**
 * Pueblo en pixel art: tilemap del .tmj con los tilesets del manifest, personajes animados,
 * emotes, bocadillos, efectos de memoria, ciclo día/noche y minimapa.
 * Si los assets no cargan (p. ej. falta la carpeta vendor), pinta formas simples con la misma geometría.
 */
export class TownScene extends Phaser.Scene {
  private views = new Map<string, AgentView>();
  private world: World | null = null;
  private pack: AssetPack | null = null;
  private roofs: Phaser.Tilemaps.TilemapLayer | null = null;
  private roofAlpha = new Map<string, number>();
  private ambience: Ambience | null = null;
  private minimap: Phaser.Cameras.Scene2D.Camera | null = null;
  private selectedId: string | null = null;
  private followId: string | null = null;
  private following = false;
  private assetsOk = false;
  private built = false;
  private pendingAgents: AgentState[] = [];
  private weather: Weather = "sunny";
  onSelect: (id: string) => void = () => {};
  /** Avisa a React cuando el usuario deja de seguir (arrastrando el mapa). */
  onFollowChange: (id: string | null) => void = () => {};
  onReady: () => void = () => {};
  /** Devuelve el tiempo de juego estimado ahora. */
  gameTime: () => number = () => 0;
  /** Agentes con una llamada al LLM en curso. */
  isThinking: (id: string) => boolean = () => false;
  ready = false;

  constructor() {
    super("town");
  }

  preload() {
    this.load.json("manifest", "/assets/manifest.json");
    this.load.json("tmj", "/api/map");
  }

  create() {
    createPixelTextures(this);
    let pack: AssetPack | null = null;
    try {
      // El pack es el que se usó para generar el mapa (propiedad assetPack del .tmj).
      const manifest = AssetManifest.parse(this.cache.json.get("manifest"));
      pack = activePack(manifest, mapAssetPack(this.cache.json.get("tmj"))).pack;
    } catch (error) {
      console.warn("Manifest de assets inválido; uso formas simples", error);
    }
    this.pack = pack;
    const fontReady = document.fonts.load(`8px ${PIXEL_FONT}`).catch(() => undefined);
    if (!pack) {
      void fontReady.then(() => this.finishLoading(false));
      return;
    }
    let failed = false;
    this.load.on(Phaser.Loader.Events.FILE_LOAD_ERROR, (file: Phaser.Loader.File) => {
      failed = true;
      console.warn(`No se pudo cargar ${file.src}`);
    });
    for (const t of pack.tilesets) this.load.image(t.name, encodeURI(`/${t.image}`));
    for (const [key, c] of Object.entries(pack.characters)) {
      this.load.spritesheet(`char:${key}`, encodeURI(`/${c.image}`), {
        frameWidth: c.frameWidth,
        frameHeight: c.frameHeight,
      });
    }
    this.load.once(Phaser.Loader.Events.COMPLETE, () => {
      void fontReady.then(() => this.finishLoading(!failed));
    });
    this.load.start();
  }

  private finishLoading(assetsOk: boolean) {
    this.assetsOk = assetsOk;
    this.setupCamera();
    this.ready = true;
    this.onReady();
  }

  setWorld(world: World) {
    if (this.built) return;
    this.built = true;
    this.world = world;
    if (this.assetsOk && this.pack) this.buildTilemap();
    else this.buildShapes(world);
    this.ambience = new Ambience(this, world);
    this.ambience.weather = this.weather;
    const cam = this.cameras.main;
    cam.setBounds(0, 0, world.width * TS, world.height * TS);
    cam.centerOn((world.width * TS) / 2, (world.height * TS) / 2);
    this.setupMinimap(world);
    if (this.pendingAgents.length) this.updateAgents(this.pendingAgents);
  }

  setWeather(weather: Weather) {
    this.weather = weather;
    if (this.ambience) this.ambience.weather = weather;
  }

  setSelected(id: string | null) {
    this.selectedId = id;
    for (const [agentId, v] of this.views) v.setSelected(agentId === id);
  }

  /** Seguir con la cámara a un agente (null = cámara libre). */
  setFollow(id: string | null) {
    this.followId = id;
    const cam = this.cameras.main;
    const target = id ? this.views.get(id) : undefined;
    this.following = Boolean(target);
    if (target) cam.startFollow(target.container, true, 0.15, 0.15);
    else cam.stopFollow();
  }

  setMinimapVisible(visible: boolean) {
    this.minimap?.setVisible(visible);
  }

  /** Efecto visual de memoria sobre un agente. */
  memoryEffect(agentId: string, kind: string) {
    this.views.get(agentId)?.playEffect(kind);
  }

  updateAgents(agents: AgentState[]) {
    if (!this.world) {
      this.pendingAgents = agents;
      return;
    }
    for (const agent of agents) {
      const view = this.views.get(agent.id) ?? this.createView(agent);
      view.setState(agent);
    }
    if (this.followId && !this.following) this.setFollow(this.followId);
  }

  override update(_time: number, delta: number) {
    if (!this.world) return;
    const now = this.gameTime();
    const realSeconds = this.time.now / 1000;
    const dtSeconds = delta / 1000;
    for (const v of this.views.values()) {
      const p = positionAt(v.state, now);
      v.container.setPosition(Math.round(p.x * TS + TS / 2), Math.round(p.y * TS + TS));
      v.container.setDepth(10 + p.y / this.world.height);
      v.update(p, { thinking: this.isThinking(v.state.id), realSeconds, dtSeconds });
    }
    this.updateRoofs(now);
    this.ambience?.update(now, dtSeconds);
  }

  // --- Construcción -----------------------------------------------------------------------

  private buildTilemap() {
    const tmj = this.cache.json.get("tmj");
    this.cache.tilemap.add("town", { format: Phaser.Tilemaps.Formats.TILED_JSON, data: tmj });
    const map = this.make.tilemap({ key: "town" });
    const tilesets = this.pack!.tilesets.map((t) => map.addTilesetImage(t.name, t.name)).filter(
      (t): t is Phaser.Tilemaps.Tileset => t !== null,
    );
    const depth: Record<string, number> = {
      ground: 0,
      paths: 1,
      buildings: 2,
      decor: 3,
      roofs: 20,
    };
    for (const name of Object.keys(depth)) {
      const layer = map.createLayer(name, tilesets, 0, 0) as Phaser.Tilemaps.TilemapLayer | null;
      if (!layer) continue;
      layer.setDepth(depth[name]!);
      if (name === "roofs") this.roofs = layer;
    }
  }

  private buildShapes(world: World) {
    const colors: Record<string, number> = {
      home: 0x7aa5d6,
      cafe: 0xc9a46b,
      park: 0x7fbf7f,
      shop: 0xb59ad6,
      other: 0xcccccc,
    };
    const g = this.add.graphics();
    g.fillStyle(0x9ccc65).fillRect(0, 0, world.width * TS, world.height * TS);
    for (const place of world.places) {
      const { x, y, w, h } = place.area;
      g.fillStyle(colors[place.kind] ?? 0xcccccc, 0.9).fillRect(x * TS, y * TS, w * TS, h * TS);
      this.add
        .text(x * TS + 4, y * TS + 2, place.name, {
          fontFamily: PIXEL_FONT,
          fontSize: "10px",
          color: "#1d1d1d",
        })
        .setResolution(4);
    }
    g.fillStyle(0x3b3b3b, 0.85);
    world.collision.forEach((c, i) => {
      if (c) g.fillRect((i % world.width) * TS, Math.floor(i / world.width) * TS, TS, TS);
    });
  }

  private createView(agent: AgentState): AgentView {
    const key = this.pack ? characterFor(this.pack, agent.id, agent.appearance.sheet) : null;
    const sheet = this.assetsOk && key ? (this.pack!.characters[key] ?? null) : null;
    const texture = sheet && key ? this.textureFor(agent, key) : "pixel";
    const view = new AgentView(this, agent, sheet, texture, (id) => this.onSelect(id));
    this.views.set(agent.id, view);
    if (agent.id === this.selectedId) view.setSelected(true);
    return view;
  }

  /** Textura del personaje; si la hoja es recoloreable, crea una copia con los colores del agente. */
  private textureFor(agent: AgentState, key: string): string {
    const base = `char:${key}`;
    const sheet = this.pack!.characters[key]!;
    if (!sheet.recolor || !sheet.markers) return base;
    const own = `${base}:${agent.id}`;
    if (this.textures.exists(own)) return own;
    const src = this.textures.get(base).getSourceImage() as HTMLImageElement;
    const canvas = document.createElement("canvas");
    canvas.width = src.width;
    canvas.height = src.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return base;
    ctx.drawImage(src, 0, 0);
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    recolorPixels(img.data, sheet.markers, agent.appearance);
    ctx.putImageData(img, 0, 0);
    this.textures.addSpriteSheet(own, canvas as unknown as HTMLImageElement, {
      frameWidth: sheet.frameWidth,
      frameHeight: sheet.frameHeight,
    });
    return own;
  }

  // --- Tejados, cámara y minimapa -------------------------------------------------------------

  private updateRoofs(now: number) {
    if (!this.roofs || !this.world) return;
    const pointer = this.input.activePointer;
    const worldPoint = pointer.positionToCamera(this.cameras.main) as Phaser.Math.Vector2;
    const px = worldPoint.x / TS;
    const py = worldPoint.y / TS;
    const hidden = new Set<string>();
    this.ambience?.setHiddenPlaces(hidden);
    for (const place of this.world.places) {
      if (!place.indoor) continue;
      const { x, y, w, h } = place.area;
      const contains = (tx: number, ty: number) => tx >= x && tx < x + w && ty >= y && ty < y + h;
      const occupied = [...this.views.values()].some((v) => {
        const p = positionAt(v.state, now);
        return contains(p.x, p.y);
      });
      const target = occupied || contains(px, py) ? ROOF_HIDDEN_ALPHA : 1;
      if (target < 0.5) hidden.add(place.id);
      const current = this.roofAlpha.get(place.id) ?? 1;
      const next = current + (target - current) * 0.15;
      if (Math.abs(next - current) < 0.002) continue;
      this.roofAlpha.set(place.id, next);
      for (const tile of this.roofs.getTilesWithin(x, y, w, h) ?? []) tile.setAlpha(next);
    }
  }

  private setupCamera() {
    const cam = this.cameras.main;
    cam.setZoom(2);
    cam.setRoundPixels(true);
    this.input.on(
      Phaser.Input.Events.POINTER_WHEEL,
      (_p: Phaser.Input.Pointer, _o: unknown, _dx: number, dy: number) => {
        const zoom = Phaser.Math.Clamp(cam.zoom + (dy > 0 ? -1 : 1), ZOOM_MIN, ZOOM_MAX);
        cam.setZoom(Math.round(zoom));
      },
    );
    this.input.on(Phaser.Input.Events.POINTER_MOVE, (p: Phaser.Input.Pointer) => {
      if (!p.isDown) return;
      if (this.followId) {
        this.setFollow(null);
        this.onFollowChange(null);
      }
      cam.scrollX -= (p.x - p.prevPosition.x) / cam.zoom;
      cam.scrollY -= (p.y - p.prevPosition.y) / cam.zoom;
    });
  }

  private setupMinimap(world: World) {
    const w = world.width * TS;
    const h = world.height * TS;
    const zoom = MINIMAP_WIDTH / w;
    const mm = this.cameras.add(8, 8, MINIMAP_WIDTH, Math.round(h * zoom), false, "minimap");
    mm.setZoom(zoom)
      .setBounds(0, 0, w, h)
      .centerOn(w / 2, h / 2);
    mm.setBackgroundColor(0x1d2330);
    // El minimapa no necesita lluvia ni bocadillos legibles: solo el pueblo y los agentes.
    this.minimap = mm;
  }
}
