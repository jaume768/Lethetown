import type { AgentState, World } from "@lethetown/shared";
import Phaser from "phaser";

const AGENT_COLORS = [0xff7043, 0x42a5f5, 0xab47bc, 0x66bb6a, 0xffca28];
const RADIUS = 14;

interface AgentSprite {
  container: Phaser.GameObjects.Container;
  circle: Phaser.GameObjects.Arc;
  bubble: Phaser.GameObjects.Text;
}

/** Mapa mínimo: rectángulos por lugar y círculos por agente con nombre y bocadillo. */
export class TownScene extends Phaser.Scene {
  private sprites = new Map<string, AgentSprite>();
  private world: World | null = null;
  private selectedId: string | null = null;
  onSelect: (id: string) => void = () => {};
  onReady: () => void = () => {};
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
    for (const place of world.places) {
      const { x, y, w, h } = place.rect;
      this.add
        .rectangle(x, y, w, h, Phaser.Display.Color.HexStringToColor(place.color).color, 0.85)
        .setOrigin(0)
        .setStrokeStyle(2, 0x2b2b2b);
      this.add.text(x + 8, y + 6, place.name, {
        fontSize: "14px",
        color: "#1d1d1d",
        fontStyle: "bold",
      });
    }
  }

  setSelected(id: string | null) {
    this.selectedId = id;
    for (const [agentId, s] of this.sprites) {
      s.circle.setStrokeStyle(agentId === id ? 4 : 2, agentId === id ? 0xffffff : 0x1d1d1d);
    }
  }

  updateAgents(agents: AgentState[]) {
    if (!this.world) return;
    const byPlace = new Map<string, number>();
    agents.forEach((agent, i) => {
      const sprite = this.sprites.get(agent.id) ?? this.createSprite(agent, i);
      const slot = byPlace.get(agent.locationId) ?? 0;
      byPlace.set(agent.locationId, slot + 1);
      const target = this.positionFor(agent, slot);
      this.tweens.add({ targets: sprite.container, x: target.x, y: target.y, duration: 400 });
      const text = agent.lastUtterance ? `💬 ${agent.lastUtterance}` : agent.action;
      sprite.bubble.setText(text);
    });
  }

  private positionFor(agent: AgentState, slot: number) {
    const place = this.world!.places.find((p) => p.id === agent.locationId);
    if (!place) return { x: 0, y: 0 };
    const { x, y, w, h } = place.rect;
    const home = { x: x + 40 + (slot % 3) * 60, y: y + h / 2 + 10 + Math.floor(slot / 3) * 40 };
    const dest = agent.targetId ? this.world!.places.find((p) => p.id === agent.targetId) : null;
    if (!dest) return { x: Math.min(home.x, x + w - RADIUS), y: home.y };
    const d = dest.rect;
    // De camino: a medio trayecto entre el centro del origen y el del destino.
    return { x: (x + w / 2 + d.x + d.w / 2) / 2, y: (y + h / 2 + d.y + d.h / 2) / 2 };
  }

  private createSprite(agent: AgentState, index: number): AgentSprite {
    const circle = this.add
      .circle(0, 0, RADIUS, AGENT_COLORS[index % AGENT_COLORS.length])
      .setStrokeStyle(2, 0x1d1d1d);
    const name = this.add
      .text(0, RADIUS + 4, agent.name.split(" ")[0] ?? agent.name, {
        fontSize: "12px",
        color: "#111",
      })
      .setOrigin(0.5, 0);
    const bubble = this.add
      .text(0, -RADIUS - 6, "", {
        fontSize: "11px",
        color: "#111",
        backgroundColor: "#ffffffdd",
        padding: { x: 4, y: 2 },
        wordWrap: { width: 160 },
      })
      .setOrigin(0.5, 1);
    const container = this.add.container(0, 0, [circle, name, bubble]).setDepth(10);
    circle.setInteractive({ useHandCursor: true }).on("pointerdown", () => this.onSelect(agent.id));
    const sprite = { container, circle, bubble };
    this.sprites.set(agent.id, sprite);
    if (agent.id === this.selectedId) this.setSelected(agent.id);
    return sprite;
  }
}
