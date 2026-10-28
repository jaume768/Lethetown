import { ambientAt, type Weather, type World } from "@lethetown/shared";
import Phaser from "phaser";

const TS = 16;
const RAIN_DROPS = 260;

/** Ciclo día/noche (velo multiplicativo), luces de ventanas y farolas, y lluvia. */
export class Ambience {
  private readonly veil: Phaser.GameObjects.Rectangle;
  private readonly glows: Phaser.GameObjects.Image[] = [];
  /** Lugar al que pertenece cada ventana. */
  private readonly windowPlace = new Map<Phaser.GameObjects.Image, string>();
  private hiddenPlaces = new Set<string>();
  private readonly rain: Phaser.GameObjects.Graphics;
  private readonly drops: { x: number; y: number; v: number }[] = [];
  weather: Weather = "sunny";

  constructor(
    private readonly scene: Phaser.Scene,
    world: World,
    /** prefers-reduced-motion: luz por tramos de media hora y lluvia quieta. */
    private readonly reducedMotion = false,
  ) {
    const w = world.width * TS;
    const h = world.height * TS;
    this.veil = scene.add
      .rectangle(0, 0, w, h, 0xffffff, 0)
      .setOrigin(0)
      .setDepth(30)
      .setBlendMode(Phaser.BlendModes.MULTIPLY);
    for (const p of world.windows) {
      const glow = scene.add
        .image(p.x * TS + TS / 2, p.y * TS + TS / 2, "glow-window")
        .setBlendMode(Phaser.BlendModes.ADD);
      const place = world.places.find(
        (pl) =>
          p.x >= pl.area.x &&
          p.x < pl.area.x + pl.area.w &&
          p.y >= pl.area.y &&
          p.y < pl.area.y + pl.area.h,
      );
      if (place) this.windowPlace.set(glow, place.id);
      this.glows.push(glow);
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

  /** Lugares con el tejado oculto: sus ventanas, vistas desde dentro, no brillan. */
  setHiddenPlaces(ids: Set<string>) {
    this.hiddenPlaces = ids;
  }

  update(gameMinutes: number, dtSeconds: number) {
    const minutes = this.reducedMotion ? Math.floor(gameMinutes / 30) * 30 : gameMinutes;
    const a = ambientAt(minutes, this.weather);
    this.veil.setFillStyle(a.tint, a.alpha);
    for (const g of this.glows) {
      const place = this.windowPlace.get(g);
      g.setAlpha(place && this.hiddenPlaces.has(place) ? 0 : a.lights);
    }
    this.drawRain(this.reducedMotion ? 0 : dtSeconds);
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
