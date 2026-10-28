import {
  AssetManifest,
  activePack,
  characterFor,
  pickFrame,
  positionAt,
  type AgentState,
  type AssetPack,
  type World,
} from "@lethetown/shared";
import Phaser from "phaser";

const TS = 16;
const ZOOM_MIN = 1;
const ZOOM_MAX = 4;
/** Opacidad de un tejado con alguien dentro (o con el ratón encima). */
const ROOF_HIDDEN_ALPHA = 0;
const OUTLINE_OFFSETS = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
] as const;

interface AgentSprite {
  container: Phaser.GameObjects.Container;
  body: Phaser.GameObjects.Sprite;
  outline: Phaser.GameObjects.Sprite[];
  label: Phaser.GameObjects.Text;
  bubble: Phaser.GameObjects.Text;
  characterKey: string;
  state: AgentState;
}

/**
 * Pueblo en pixel art: tilemap del .tmj con los tilesets del manifest y personajes animados.
 * Si los assets no cargan (p. ej. falta la carpeta vendor), pinta formas simples con la misma geometría.
 */
export class TownScene extends Phaser.Scene {
  private sprites = new Map<string, AgentSprite>();
  private world: World | null = null;
  private pack: AssetPack | null = null;
  private roofs: Phaser.Tilemaps.TilemapLayer | null = null;
  private roofAlpha = new Map<string, number>();
  private selectedId: string | null = null;
  private followId: string | null = null;
  private following = false;
  /** Avisa a React cuando el usuario deja de seguir (arrastrando el mapa). */
  onFollowChange: (id: string | null) => void = () => {};
  private assetsOk = false;
  private built = false;
  private pendingAgents: AgentState[] = [];
  onSelect: (id: string) => void = () => {};
  onReady: () => void = () => {};
  /** Devuelve el tiempo de juego estimado ahora. */
  gameTime: () => number = () => 0;
  ready = false;

  constructor() {
    super("town");
  }

  preload() {
    this.load.json("manifest", "/assets/manifest.json");
    this.load.json("tmj", "/api/map");
  }

  create() {
    let pack: AssetPack | null = null;
    try {
      pack = activePack(AssetManifest.parse(this.cache.json.get("manifest"))).pack;
    } catch (error) {
      console.warn("Manifest de assets inválido; uso formas simples", error);
    }
    this.pack = pack;
    if (!pack) return this.finishLoading(false);

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
    this.load.once(Phaser.Loader.Events.COMPLETE, () => this.finishLoading(!failed));
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
    const cam = this.cameras.main;
    cam.setBounds(0, 0, world.width * TS, world.height * TS);
    cam.centerOn((world.width * TS) / 2, (world.height * TS) / 2);
    if (this.pendingAgents.length) this.updateAgents(this.pendingAgents);
  }

  setSelected(id: string | null) {
    this.selectedId = id;
    for (const [agentId, s] of this.sprites) {
      for (const o of s.outline) o.setVisible(agentId === id);
    }
  }

  /** Seguir con la cámara a un agente (null = cámara libre). */
  setFollow(id: string | null) {
    this.followId = id;
    const cam = this.cameras.main;
    const target = id ? this.sprites.get(id) : undefined;
    this.following = Boolean(target);
    if (target) cam.startFollow(target.container, true, 0.15, 0.15);
    else cam.stopFollow();
  }

  updateAgents(agents: AgentState[]) {
    if (!this.world) {
      this.pendingAgents = agents;
      return;
    }
    for (const agent of agents) {
      const sprite = this.sprites.get(agent.id) ?? this.createSprite(agent);
      sprite.state = agent;
      sprite.bubble.setText(agent.lastUtterance ?? "");
      sprite.bubble.setVisible(Boolean(agent.lastUtterance));
    }
    if (this.followId && !this.following) this.setFollow(this.followId);
  }

  override update() {
    if (!this.world) return;
    const now = this.gameTime();
    const realSeconds = this.time.now / 1000;
    for (const s of this.sprites.values()) {
      const p = positionAt(s.state, now);
      s.container.setPosition(Math.round(p.x * TS + TS / 2), Math.round(p.y * TS + TS));
      s.container.setDepth(10 + p.y / this.world.height);
      const sheet = this.pack?.characters[s.characterKey];
      if (this.assetsOk && sheet) {
        const choice = pickFrame(sheet, {
          moving: p.moving,
          distance: p.distance,
          facing: p.facing,
          activityKind: s.state.activityKind,
          realSeconds,
        });
        for (const spr of [s.body, ...s.outline]) {
          spr.setFrame(choice.frame);
          spr.setAngle(choice.lying ? -90 : 0);
        }
      }
    }
    this.updateRoofs();
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
      this.add.text(x * TS + 4, y * TS + 2, place.name, { fontSize: "10px", color: "#1d1d1d" });
    }
    g.fillStyle(0x3b3b3b, 0.85);
    world.collision.forEach((c, i) => {
      if (c) g.fillRect((i % world.width) * TS, Math.floor(i / world.width) * TS, TS, TS);
    });
  }

  private createSprite(agent: AgentState): AgentSprite {
    const characterKey = this.pack
      ? characterFor(this.pack, agent.id, agent.appearance.sheet)
      : "default";
    const texture = this.assetsOk ? `char:${characterKey}` : "__WHITE";
    const makeBody = () => this.add.sprite(0, 0, texture).setOrigin(0.5, 1);
    const outline = OUTLINE_OFFSETS.map(([dx, dy]) =>
      makeBody()
        .setPosition(dx, dy)
        .setTint(0xffffff)
        .setTintMode(Phaser.TintModes.FILL)
        .setVisible(false),
    );
    const body = makeBody();
    if (!this.assetsOk) {
      body
        .setDisplaySize(10, 18)
        .setTint(Phaser.Display.Color.HexStringToColor(agent.appearance.shirt).color);
    }
    const label = this.add
      .text(0, 2, agent.name.split(" ")[0] ?? agent.name, {
        fontFamily: "monospace",
        fontSize: "8px",
        color: "#ffffff",
        stroke: "#1d1d1d",
        strokeThickness: 2,
      })
      .setOrigin(0.5, 0)
      .setResolution(4);
    const bubble = this.add
      .text(0, -34, "", {
        fontFamily: "monospace",
        fontSize: "8px",
        color: "#111111",
        backgroundColor: "#ffffffee",
        padding: { x: 3, y: 2 },
        wordWrap: { width: 110 },
      })
      .setOrigin(0.5, 1)
      .setResolution(4)
      .setVisible(false);
    const container = this.add.container(0, 0, [...outline, body, label, bubble]);
    body.setInteractive({ useHandCursor: true }).on("pointerdown", () => this.onSelect(agent.id));
    const sprite: AgentSprite = {
      container,
      body,
      outline,
      label,
      bubble,
      characterKey,
      state: agent,
    };
    this.sprites.set(agent.id, sprite);
    if (agent.id === this.selectedId) this.setSelected(agent.id);
    return sprite;
  }

  // --- Tejados y cámara ---------------------------------------------------------------------

  private updateRoofs() {
    if (!this.roofs || !this.world) return;
    const pointer = this.input.activePointer;
    const worldPoint = pointer.positionToCamera(this.cameras.main) as Phaser.Math.Vector2;
    const px = worldPoint.x / TS;
    const py = worldPoint.y / TS;
    const now = this.gameTime();
    for (const place of this.world.places) {
      if (!place.indoor) continue;
      const { x, y, w, h } = place.area;
      const contains = (tx: number, ty: number) => tx >= x && tx < x + w && ty >= y && ty < y + h;
      const occupied = [...this.sprites.values()].some((s) => {
        const p = positionAt(s.state, now);
        return contains(p.x, p.y);
      });
      const target = occupied || contains(px, py) ? ROOF_HIDDEN_ALPHA : 1;
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
}
