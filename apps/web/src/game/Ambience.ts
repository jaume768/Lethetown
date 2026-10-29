import { WEATHER_LOOK, ambientAt, type Weather, type World } from "@lethetown/shared";
import Phaser from "phaser";

const TS = 16;
/** Máximo de partículas de cualquier tiempo (la tormenta es la que más usa). */
const MAX_PARTICLES = 420;

/**
 * Ciclo día/noche (velo multiplicativo), luces de ventanas y farolas, y el tiempo: lluvia,
 * tormenta (con relámpagos), nieve, viento, niebla y calor (`WEATHER_LOOK` de shared).
 */
export class Ambience {
  private readonly veil: Phaser.GameObjects.Rectangle;
  private readonly glows: Phaser.GameObjects.Image[] = [];
  /** Lugar al que pertenece cada ventana. */
  private readonly windowPlace = new Map<Phaser.GameObjects.Image, string>();
  private hiddenPlaces = new Set<string>();
  private readonly rain: Phaser.GameObjects.Graphics;
  private readonly drops: { x: number; y: number; v: number; phase: number }[] = [];
  private readonly fog: Phaser.GameObjects.Rectangle;
  private readonly flash: Phaser.GameObjects.Rectangle;
  private flashAlpha = 0;
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
    this.fog = scene.add.rectangle(0, 0, w, h, 0xe6e9ef, 0).setOrigin(0).setDepth(33);
    this.rain = scene.add.graphics().setDepth(32).setScrollFactor(0);
    this.flash = scene.add
      .rectangle(0, 0, w, h, 0xffffff, 0)
      .setOrigin(0)
      .setDepth(34)
      .setBlendMode(Phaser.BlendModes.ADD);
    // Efecto puramente visual: aquí sí vale Math.random().
    for (let i = 0; i < MAX_PARTICLES; i++) {
      this.drops.push({
        x: Math.random(),
        y: Math.random(),
        v: 0.6 + Math.random() * 0.6,
        phase: Math.random() * Math.PI * 2,
      });
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
    const look = WEATHER_LOOK[this.weather];
    this.fog.setFillStyle(0xe6e9ef, look.fog);
    this.drawParticles(this.reducedMotion ? 0 : dtSeconds);
    this.drawFlash(this.reducedMotion ? 0 : dtSeconds, look.flashEvery);
  }

  /** Relámpagos: destellos al azar que se apagan solos (sin ellos con reduced-motion). */
  private drawFlash(dt: number, every: number) {
    if (every > 0 && dt > 0 && Math.random() < dt / every) this.flashAlpha = 0.55;
    this.flashAlpha = Math.max(0, this.flashAlpha - dt * 2.5);
    this.flash.setFillStyle(0xffffff, every > 0 ? this.flashAlpha : 0);
  }

  private drawParticles(dt: number) {
    this.rain.clear();
    const p = WEATHER_LOOK[this.weather].particles;
    if (p.kind === "none") return;
    const { width, height } = this.scene.scale;
    // Dirección de las rayas: la del movimiento (cae y deriva a la izquierda).
    const len = Math.hypot(p.fall, p.drift) || 1;
    const dx = (-p.drift / len) * p.size;
    const dy = (p.fall / len) * p.size;
    if (p.kind === "streak") this.rain.lineStyle(1, p.color, p.alpha);
    else this.rain.fillStyle(p.color, p.alpha);
    for (const d of this.drops.slice(0, p.count)) {
      d.y += d.v * dt * p.fall;
      d.x -= d.v * dt * p.drift;
      if (d.y > 1) {
        d.y -= 1;
        d.x = Math.random();
      }
      if (d.x < 0) d.x += 1;
      const x = Math.round(d.x * width);
      const y = Math.round(d.y * height);
      if (p.kind === "streak") {
        this.rain.lineBetween(x, y, x + dx, y + dy);
      } else {
        // Copos: se mecen a los lados.
        d.phase += dt * 2;
        const sway = Math.round(Math.sin(d.phase) * 3);
        this.rain.fillRect(x + sway, y, p.size, p.size);
      }
    }
  }
}
