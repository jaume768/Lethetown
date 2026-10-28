import {
  emoteFor,
  emoteForMemoryEffect,
  pickFrame,
  type AgentState,
  type CharacterSheet,
  type Emote,
} from "@lethetown/shared";
import Phaser from "phaser";
import { BUBBLE_CORNER, emoteKey } from "./pixelArt";

export const PIXEL_FONT = '"Pixelify Sans", monospace';
const OUTLINE_OFFSETS = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
] as const;
/** Caracteres por segundo (tiempo real) al escribir el bocadillo. */
const TYPE_SPEED = 45;
const BUBBLE_MAX_WIDTH = 110;

interface TransientEmote {
  emote: Emote;
  until: number;
}

/** Un personaje en el mapa: sprite animado, contorno de selección, emote, bocadillo y efectos. */
export class AgentView {
  readonly container: Phaser.GameObjects.Container;
  private readonly body: Phaser.GameObjects.Sprite;
  private readonly outline: Phaser.GameObjects.Sprite[];
  private readonly label: Phaser.GameObjects.Text;
  private readonly emote: Phaser.GameObjects.Image;
  private readonly bubble: Phaser.GameObjects.Container;
  private readonly bubbleBg: Phaser.GameObjects.NineSlice;
  private readonly bubbleText: Phaser.GameObjects.Text;
  private utterance: string | null = null;
  private typed = 0;
  private transient: TransientEmote | null = null;
  private selected = false;
  private hovered = false;
  state: AgentState;

  constructor(
    private readonly scene: Phaser.Scene,
    state: AgentState,
    private readonly sheet: CharacterSheet | null,
    texture: string,
    onSelect: (id: string) => void,
  ) {
    this.state = state;
    const makeBody = () => scene.add.sprite(0, 0, texture).setOrigin(0.5, 1);
    this.outline = OUTLINE_OFFSETS.map(([dx, dy]) =>
      makeBody()
        .setPosition(dx, dy)
        .setTint(0xffffff)
        .setTintMode(Phaser.TintModes.FILL)
        .setVisible(false),
    );
    this.body = makeBody();
    if (!sheet) {
      this.body
        .setDisplaySize(10, 18)
        .setTint(Phaser.Display.Color.HexStringToColor(state.appearance.shirt).color);
    }
    const height = sheet?.frameHeight ?? 18;
    this.label = scene.add
      .text(0, 2, state.name.split(" ")[0] ?? state.name, {
        fontFamily: PIXEL_FONT,
        fontSize: "8px",
        color: "#ffffff",
        stroke: "#1d1d2b",
        strokeThickness: 2,
      })
      .setOrigin(0.5, 0)
      .setResolution(4)
      .setVisible(false);
    this.emote = scene.add
      .image(0, -height + 4, emoteKey("dots"))
      .setOrigin(0.5, 1)
      .setVisible(false);

    this.bubbleBg = scene.add
      .nineslice(
        0,
        0,
        "bubble",
        undefined,
        20,
        12,
        BUBBLE_CORNER,
        BUBBLE_CORNER,
        BUBBLE_CORNER,
        BUBBLE_CORNER,
      )
      .setOrigin(0.5, 1);
    const tail = scene.add.image(0, 2, "bubble-tail").setOrigin(0.5, 1);
    this.bubbleText = scene.add
      .text(0, -3, "", {
        fontFamily: PIXEL_FONT,
        fontSize: "8px",
        color: "#1d1d2b",
        wordWrap: { width: BUBBLE_MAX_WIDTH, useAdvancedWrap: true },
        lineSpacing: -1,
      })
      .setOrigin(0.5, 1)
      .setResolution(4);
    this.bubble = scene.add
      .container(0, -height - 8, [this.bubbleBg, tail, this.bubbleText])
      .setVisible(false);

    this.container = scene.add.container(0, 0, [
      ...this.outline,
      this.body,
      this.label,
      this.emote,
      this.bubble,
    ]);
    this.body
      .setInteractive({ useHandCursor: true })
      .on("pointerdown", (p: Phaser.Input.Pointer) => {
        p.event.stopPropagation();
        onSelect(state.id);
      })
      .on("pointerover", () => this.setHover(true))
      .on("pointerout", () => this.setHover(false));
  }

  setSelected(selected: boolean) {
    this.selected = selected;
    for (const o of this.outline) o.setVisible(selected);
    this.label.setVisible(this.selected || this.hovered);
  }

  private setHover(hovered: boolean) {
    this.hovered = hovered;
    this.label.setVisible(this.selected || this.hovered);
  }

  /** Recibe un estado nuevo del servidor. */
  setState(state: AgentState) {
    this.state = state;
    if (state.lastUtterance !== this.utterance) {
      this.utterance = state.lastUtterance;
      this.typed = 0;
    }
  }

  /** Efecto visual de memoria. */
  playEffect(kind: string) {
    const emote = emoteForMemoryEffect(kind);
    const now = this.scene.time.now;
    if (emote) this.transient = { emote, until: now + (kind === "recall" ? 700 : 1800) };
    if (kind === "recall") this.flash();
    if (kind === "forget" || kind === "archive") this.dissolve(kind === "forget" ? 10 : 5);
  }

  /** Destello: el cuerpo se pone blanco un instante. */
  private flash() {
    this.body.setTintMode(Phaser.TintModes.FILL).setTint(0xfff3b0);
    this.scene.time.delayedCall(140, () => {
      this.body.setTintMode(Phaser.TintModes.MULTIPLY).clearTint();
    });
  }

  /** Partículas que suben y se desvanecen (un recuerdo cruzando el umbral de olvido). */
  private dissolve(n: number) {
    const top = -(this.sheet?.frameHeight ?? 18) + 6;
    for (let i = 0; i < n; i++) {
      const p = this.scene.add
        .image(Phaser.Math.Between(-5, 5), top + Phaser.Math.Between(0, 6), "pixel")
        .setTint(i % 2 ? 0xc9cfdd : 0x9aa0b0)
        .setAlpha(0.9);
      this.container.add(p);
      this.scene.tweens.add({
        targets: p,
        x: p.x + Phaser.Math.Between(-10, 10),
        y: p.y - Phaser.Math.Between(10, 22),
        alpha: 0,
        duration: Phaser.Math.Between(900, 1500),
        onComplete: () => p.destroy(),
      });
    }
  }

  /** Cada frame: animación, emote y bocadillo. */
  update(
    pos: { x: number; y: number; facing: AgentState["facing"]; moving: boolean; distance: number },
    opts: { thinking: boolean; realSeconds: number; dtSeconds: number },
  ) {
    if (this.sheet) {
      const choice = pickFrame(this.sheet, {
        moving: pos.moving,
        distance: pos.distance,
        facing: pos.facing,
        activityKind: this.state.activityKind,
        realSeconds: opts.realSeconds,
      });
      for (const spr of [this.body, ...this.outline]) {
        spr.setFrame(choice.frame);
        spr.setAngle(choice.lying ? -90 : 0);
      }
    }

    // Emote: uno breve (efecto de memoria) tiene prioridad sobre el persistente.
    const now = this.scene.time.now;
    if (this.transient && this.transient.until < now) this.transient = null;
    const emote = this.transient?.emote ?? emoteFor(this.state, { thinking: opts.thinking });
    const showEmote = Boolean(emote) && !this.utterance;
    this.emote.setVisible(showEmote);
    if (showEmote && emote) {
      const key =
        emote === "dots"
          ? `${emoteKey("dots")}${1 + (Math.floor(opts.realSeconds * 3) % 3)}`
          : emoteKey(emote);
      this.emote.setTexture(key);
      this.emote.y =
        -(this.sheet?.frameHeight ?? 18) + 4 + Math.round(Math.sin(opts.realSeconds * 4));
    }

    // Bocadillo con texto que aparece letra a letra.
    if (!this.utterance) {
      this.bubble.setVisible(false);
      return;
    }
    if (this.typed < this.utterance.length) {
      this.typed = Math.min(this.utterance.length, this.typed + opts.dtSeconds * TYPE_SPEED);
      this.bubbleText.setText(this.utterance.slice(0, Math.ceil(this.typed)));
      const w = Math.max(16, Math.ceil(this.bubbleText.width) + 8);
      const h = Math.max(12, Math.ceil(this.bubbleText.height) + 5);
      this.bubbleBg.setSize(w, h);
    }
    this.bubble.setVisible(true);
  }

  destroy() {
    this.container.destroy();
  }
}
