import { COLORS, rand } from "../utils";
import { Input } from "../input";
import { Audio } from "../audio";
import { SerializedPanelState } from "../multiplayer/types";

export type PanelState = "active" | "crashed";

export interface PanelContext {
  x: number;
  y: number;
  w: number;
  h: number;
  dt: number;
  input: Input;
  audio: Audio;
  difficulty: number;
  time: number;
  canvas: CanvasRenderingContext2D;
}

export abstract class GamePanel {
  abstract id: string;
  abstract title: string;
  abstract icon: string;
  state: PanelState = "active";
  health: number = 100;
  maxHealth: number = 100;
  protected integrityFlash = 0;
  protected shakeAmount = 0;

  abstract update(ctx: PanelContext): void;
  abstract draw(ctx: PanelContext): void;
  abstract drawPreview(ctx: PanelContext): void;
  abstract serialize(): SerializedPanelState;
  abstract deserialize(state: SerializedPanelState): void;

  damage(amount: number): void {
    this.health = Math.max(0, this.health - amount);
    this.integrityFlash = 1;
    this.shakeAmount = 8;
    if (this.health <= 0) {
      this.state = "crashed";
    }
  }

  heal(amount: number): void {
    this.health = Math.min(this.maxHealth, this.health + amount);
  }

  protected drawShell(
    ctx: PanelContext,
    cb: () => void
  ): void {
    const c = ctx.canvas;
    const { x, y, w, h } = ctx;

    let sx = 0, sy = 0;
    if (this.shakeAmount > 0) {
      sx = rand(-this.shakeAmount, this.shakeAmount);
      sy = rand(-this.shakeAmount, this.shakeAmount);
      this.shakeAmount *= 0.85;
      if (this.shakeAmount < 0.1) this.shakeAmount = 0;
    }

    // Panel background
    c.fillStyle = "rgba(13, 19, 33, 0.9)";
    c.fillRect(x + sx, y + sy, w, h);

    // Panel border
    const borderColor = this.state === "crashed"
      ? COLORS.danger
      : this.integrityFlash > 0
        ? COLORS.danger
        : COLORS.primaryDim;
    c.strokeStyle = borderColor;
    c.lineWidth = 2;
    c.strokeRect(x + sx, y + sy, w, h);

    if (this.integrityFlash > 0) {
      c.fillStyle = `rgba(244, 63, 94, ${this.integrityFlash * 0.15})`;
      c.fillRect(x + sx, y + sy, w, h);
      this.integrityFlash -= ctx.dt * 3;
      if (this.integrityFlash < 0) this.integrityFlash = 0;
    }

    // Title bar
    c.fillStyle = "rgba(34, 211, 238, 0.08)";
    c.fillRect(x + sx, y + sy, w, 28);

    c.font = "600 14px Rajdhani, sans-serif";
    c.textAlign = "left";
    c.textBaseline = "middle";
    c.fillStyle = this.state === "crashed" ? COLORS.danger : COLORS.primary;
    c.fillText(`${this.icon}  ${this.title}`, x + sx + 10, y + sy + 14);

    // Health bar
    const barW = 80;
    const barX = x + sx + w - barW - 10;
    const barY = y + sy + 10;
    c.fillStyle = "rgba(0,0,0,0.4)";
    c.fillRect(barX, barY, barW, 8);
    const hp = this.health / this.maxHealth;
    c.fillStyle = hp > 0.6 ? COLORS.success : hp > 0.3 ? COLORS.warning : COLORS.danger;
    c.fillRect(barX, barY, barW * hp, 8);
    c.strokeStyle = COLORS.grayDim;
    c.lineWidth = 1;
    c.strokeRect(barX, barY, barW, 8);

    // Content area clip
    c.save();
    c.beginPath();
    c.rect(x + sx + 1, y + sy + 30, w - 2, h - 32);
    c.clip();

    // Translate for content
    c.translate(x + sx, y + sy + 30);

    if (this.state === "crashed") {
      c.fillStyle = "rgba(244, 63, 94, 0.1)";
      c.fillRect(0, 0, w, h - 32);
      c.font = "900 24px Orbitron, sans-serif";
      c.textAlign = "center";
      c.textBaseline = "middle";
      c.fillStyle = COLORS.danger;
      c.fillText("SYSTEM COMPROMISED", w / 2, (h - 32) / 2);
      c.font = "500 12px Rajdhani, sans-serif";
      c.fillStyle = COLORS.gray;
      c.fillText("Panel offline — focus others!", w / 2, (h - 32) / 2 + 22);
    } else {
      cb();
    }

    c.restore();
  }
}
