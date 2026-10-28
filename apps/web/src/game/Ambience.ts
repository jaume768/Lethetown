import { ambientAt, type Weather, type World } from "@lethetown/shared";
import Phaser from "phaser";

const TS = 16;
const RAIN_DROPS = 260;

/** Ciclo día/noche (velo multiplicativo), luces de ventanas y farolas, y lluvia. */
export class Ambience {
  private readonly veil: Phaser.GameObjects.Rectangle;
  private readonly glows: Phaser.GameObjects.Image[] = [];
  private readonly rain: Phaser.GameObjects.Graphics;
  private readonly drops: { x: number; y: number; v: number }[] = [];
  weather: Weather = "sunny";

  constructor(
    private readonly scene: Phaser.Scene,
    world: World,
  ) {
    const w = world.width * TS;
    const h = world.height * TS;
    this.veil = scene.add
      .rectangle(0, 0, w, h, 0xffffff, 0)
      .setOrigin(0)
      .setDepth(30)
      .setBlendMode(Phaser.BlendModes.MULTIPLY);
    for (const p of world.windows) {
      this.glows.push(
        scene.add
          .image(p.x * TS + TS / 2, p.y * TS + TS / 2, "glow-window")
          .setBlendMode(Phaser.BlendModes.ADD),
      );
    }
    for (const p of world.lights) {
      // La luz sale de la cabeza de la farola (3 baldosas por encima de su base).
      this.glows.push(
        scene.add
          .image(p.x * TS + TS / 2, (p.y - 3) * TS + 6, "glow-lamp")
          .setBlendMode(Phaser.BlendModes.ADD),
      );
    }
    for (const g of this.glows) g.setDepth(31).setAlpha(0);
    this.rain = scene.add.graphics().setDepth(32).setScrollFactor(0);
    for (let i = 0; i < RAIN_DROPS; i++) {
      this.drops.push({ x: Math.random(), y: Math.random(), v: 0.6 + Math.random() * 0.6 });
    }
  }

  update(gameMinutes: number, dtSeconds: number) {
    const a = ambientAt(gameMinutes, this.weather);
    this.veil.setFillStyle(a.tint, a.alpha);
    for (const g of this.glows) g.setAlpha(a.lights);
    this.drawRain(dtSeconds);
  }

  private drawRain(dt: number) {
    this.rain.clear();
    if (this.weather !== "rain") return;
    const { width, height } = this.scene.scale;
    this.rain.lineStyle(1, 0xb8d4ff, 0.55);
    for (const d of this.drops) {
      d.y += d.v * dt * 1.2;
      d.x -= d.v * dt * 0.15;
      if (d.y > 1) {
        d.y -= 1;
        d.x = Math.random();
      }
      if (d.x < 0) d.x += 1;
      const x = Math.round(d.x * width);
      const y = Math.round(d.y * height);
      this.rain.lineBetween(x, y, x - 2, y + 7);
    }
  }
}
