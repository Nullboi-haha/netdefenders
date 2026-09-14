import { COLORS, clamp, rand, randInt, pick, chance } from "../utils";
import { Input } from "../input";
import { Audio } from "../audio";

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

  protected drawFrame(ctx: PanelContext): void {
    const { x, y, w, h } = ctx;

    let sx = 0, sy = 0;
    if (this.shakeAmount > 0) {
      sx = rand(-this.shakeAmount, this.shakeAmount);
      sy = rand(-this.shakeAmount, this.shakeAmount);
      this.shakeAmount *= 0.85;
      if (this.shakeAmount < 0.1) this.shakeAmount = 0;
    }

    ctx.x += sx;
    ctx.y += sy;

    const c = ctx as unknown as { x: number; y: number; w: number; h: number };
    const px = c.x, py = c.y, pw = c.w, ph = c.h;

    const bg = ctx as unknown as CanvasRenderingContext2D;

    // We need the actual 2d context; panels receive it via ctx cast
  }

  protected drawShell(
    ctx: PanelContext,
    cb: () => void
  ): void {
    const { x, y, w, h } = ctx;

    let sx = 0, sy = 0;
    if (this.shakeAmount > 0) {
      sx = rand(-this.shakeAmount, this.shakeAmount);
      sy = rand(-this.shakeAmount, this.shakeAmount);
      this.shakeAmount *= 0.85;
      if (this.shakeAmount < 0.1) this.shakeAmount = 0;
    }

    // Panel background
    ctx.fillStyle = "rgba(13, 19, 33, 0.9)";
    ctx.fillRect(x + sx, y + sy, w, h);

    // Panel border
    const borderColor = this.state === "crashed"
      ? COLORS.danger
      : this.integrityFlash > 0
        ? COLORS.danger
        : COLORS.primaryDim;
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = 2;
    ctx.strokeRect(x + sx, y + sy, w, h);

    if (this.integrityFlash > 0) {
      ctx.fillStyle = `rgba(244, 63, 94, ${this.integrityFlash * 0.15})`;
      ctx.fillRect(x + sx, y + sy, w, h);
      this.integrityFlash -= ctx.dt * 3;
      if (this.integrityFlash < 0) this.integrityFlash = 0;
    }

    // Title bar
    ctx.fillStyle = "rgba(34, 211, 238, 0.08)";
    ctx.fillRect(x + sx, y + sy, w, 28);

    ctx.font = "600 14px Rajdhani, sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillStyle = this.state === "crashed" ? COLORS.danger : COLORS.primary;
    ctx.fillText(`${this.icon}  ${this.title}`, x + sx + 10, y + sy + 14);

    // Health bar
    const barW = 80;
    const barX = x + sx + w - barW - 10;
    const barY = y + sy + 10;
    ctx.fillStyle = "rgba(0,0,0,0.4)";
    ctx.fillRect(barX, barY, barW, 8);
    const hp = this.health / this.maxHealth;
    ctx.fillStyle = hp > 0.6 ? COLORS.success : hp > 0.3 ? COLORS.warning : COLORS.danger;
    ctx.fillRect(barX, barY, barW * hp, 8);
    ctx.strokeStyle = COLORS.grayDim;
    ctx.lineWidth = 1;
    ctx.strokeRect(barX, barY, barW, 8);

    // Content area clip
    ctx.save();
    ctx.beginPath();
    ctx.rect(x + sx + 1, y + sy + 30, w - 2, h - 32);
    ctx.clip();

    // Translate for content
    ctx.translate(x + sx, y + sy + 30);

    if (this.state === "crashed") {
      ctx.fillStyle = "rgba(244, 63, 94, 0.1)";
      ctx.fillRect(0, 0, w, h - 32);
      ctx.font = "900 24px Orbitron, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = COLORS.danger;
      ctx.fillText("SYSTEM COMPROMISED", w / 2, (h - 32) / 2);
      ctx.font = "500 12px Rajdhani, sans-serif";
      ctx.fillStyle = COLORS.gray;
      ctx.fillText("Panel offline — focus others!", w / 2, (h - 32) / 2 + 22);
    } else {
      cb();
    }

    ctx.restore();
  }
}
