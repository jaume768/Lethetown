import { positionAt, type AgentState, type World } from "@lethetown/shared";
import Phaser from "phaser";

const AGENT_COLORS = [0xff7043, 0x42a5f5, 0xab47bc, 0x66bb6a, 0xffca28];
const PLACE_COLORS: Record<string, number> = {
  home: 0x7aa5d6,
  cafe: 0xc9a46b,
  park: 0x7fbf7f,
  shop: 0xb59ad6,
  other: 0xcccccc,
};

interface AgentSprite {
  container: Phaser.GameObjects.Container;
  circle: Phaser.GameObjects.Arc;
  bubble: Phaser.GameObjects.Text;
  state: AgentState;
}

/**
 * Mapa provisional (formas simples sobre la geometría del .tmj) hasta tener el tilemap pixel art.
 * La posición de cada agente se interpola cada frame con `positionAt` y el reloj estimado.
 */
export class TownScene extends Phaser.Scene {
  private sprites = new Map<string, AgentSprite>();
  private world: World | null = null;
  private selectedId: string | null = null;
  onSelect: (id: string) => void = () => {};
  onReady: () => void = () => {};
  /** Devuelve el tiempo de juego estimado ahora. */
  gameTime: () => number = () => 0;
  ready = false;

  constructor() {
    super("town");
  }

  create() {
    this.ready = true;
    this.onReady();
  }

  setWorld(world: World) {
    if (this.world) return;
    this.world = world;
    const ts = world.tileSize;
    const g = this.add.graphics();
    g.fillStyle(0x9ccc65).fillRect(0, 0, world.width * ts, world.height * ts);
    for (const place of world.places) {
      const { x, y, w, h } = place.area;
      g.fillStyle(PLACE_COLORS[place.kind] ?? 0xcccccc, 0.9).fillRect(
        x * ts,
        y * ts,
        w * ts,
        h * ts,
      );
      this.add.text(x * ts + 4, y * ts + 2, place.name, { fontSize: "10px", color: "#1d1d1d" });
    }
    g.fillStyle(0x3b3b3b, 0.85);
    world.collision.forEach((c, i) => {
      if (c) g.fillRect((i % world.width) * ts, Math.floor(i / world.width) * ts, ts, ts);
    });
    g.fillStyle(0xffffff, 0.8);
    for (const place of world.places) {
      for (const o of place.objects) g.fillRect(o.tile.x * ts + 5, o.tile.y * ts + 5, 6, 6);
    }
    this.cameras.main.setBounds(0, 0, world.width * ts, world.height * ts);
  }

  setSelected(id: string | null) {
    this.selectedId = id;
    for (const [agentId, s] of this.sprites) {
      s.circle.setStrokeStyle(agentId === id ? 3 : 1, agentId === id ? 0xffffff : 0x1d1d1d);
    }
  }

  updateAgents(agents: AgentState[]) {
    if (!this.world) return;
    agents.forEach((agent, i) => {
      const sprite = this.sprites.get(agent.id) ?? this.createSprite(agent, i);
      sprite.state = agent;
      sprite.bubble.setText(agent.lastUtterance ? `💬 ${agent.lastUtterance}` : agent.action);
    });
  }

  override update() {
    if (!this.world) return;
    const ts = this.world.tileSize;
    const now = this.gameTime();
    for (const s of this.sprites.values()) {
      const p = positionAt(s.state, now);
      s.container.setPosition(Math.round(p.x * ts + ts / 2), Math.round(p.y * ts + ts / 2));
    }
  }

  private createSprite(agent: AgentState, index: number): AgentSprite {
    const circle = this.add
      .circle(0, 0, 6, AGENT_COLORS[index % AGENT_COLORS.length])
      .setStrokeStyle(1, 0x1d1d1d);
    const name = this.add
      .text(0, 8, agent.name.split(" ")[0] ?? agent.name, { fontSize: "9px", color: "#111" })
      .setOrigin(0.5, 0);
    const bubble = this.add
      .text(0, -9, "", {
        fontSize: "8px",
        color: "#111",
        backgroundColor: "#ffffffdd",
        padding: { x: 2, y: 1 },
        wordWrap: { width: 120 },
      })
      .setOrigin(0.5, 1);
    const container = this.add.container(0, 0, [circle, name, bubble]).setDepth(10);
    circle.setInteractive({ useHandCursor: true }).on("pointerdown", () => this.onSelect(agent.id));
    const sprite = { container, circle, bubble, state: agent };
    this.sprites.set(agent.id, sprite);
    if (agent.id === this.selectedId) this.setSelected(agent.id);
    return sprite;
  }
}
