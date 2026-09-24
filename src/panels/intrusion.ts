import { GamePanel, PanelContext } from "./base";
import { COLORS, rand, randInt, clamp, pick, chance } from "../utils";
import { SerializedPanelState } from "../multiplayer/types";

interface Bot {
  gx: number;
  gy: number;
  hp: number;
  maxHp: number;
  speed: number;
  type: "bot" | "spy";
}

interface Tower {
  gx: number;
  gy: number;
  cooldown: number;
}

const GRID_W = 8;
const GRID_H = 5;

export class IntrusionPanel extends GamePanel {
  id = "intrusion";
  title = "INTRUSION GRID";
  icon = "🏰";

  private bots: Bot[] = [];
  private towers: Tower[] = [];
  private spawnTimer = 0;
  private score = 0;
  private cellW = 0;
  private cellH = 0;

  update(ctx: PanelContext): void {
    if (this.state !== "active") return;
    const { w, h, dt, difficulty, input } = ctx;
    const contentH = h - 32;
    this.cellW = w / GRID_W;
    this.cellH = contentH / GRID_H;

    // Place tower on click
    if (input.consumeClick()) {
      const localX = input.mouseX - ctx.x;
      const localY = input.mouseY - ctx.y - 30;
      const gx = clamp(Math.floor(localX / this.cellW), 0, GRID_W - 1);
      const gy = clamp(Math.floor(localY / this.cellH), 0, GRID_H - 1);

      // Don't place on existing tower
      const exists = this.towers.some((t) => t.gx === gx && t.gy === gy);
      // Don't place on leftmost column (entry) or rightmost (exit)
      if (!exists && gx > 0 && gx < GRID_W - 1) {
        this.towers.push({ gx, gy, cooldown: 0 });
        ctx.audio.click();
      }
    }

    // Spawn bots
    this.spawnTimer -= dt;
    const spawnRate = Math.max(0.8, 2.5 - difficulty * 0.12);
    if (this.spawnTimer <= 0) {
      this.spawnTimer = spawnRate;
      const gy = randInt(0, GRID_H - 1);
      const isSpy = chance(0.2 + difficulty * 0.02);
      this.bots.push({
        gx: 0,
        gy,
        hp: isSpy ? 1 : 2 + Math.floor(difficulty / 4),
        maxHp: isSpy ? 1 : 2 + Math.floor(difficulty / 4),
        speed: (isSpy ? 1.5 : 1.0) * (0.8 + difficulty * 0.05),
        type: isSpy ? "spy" : "bot",
      });
    }

    // Move bots
    for (const bot of this.bots) {
      bot.gx += bot.speed * dt;
    }

    // Towers shoot
    for (const tower of this.towers) {
      tower.cooldown -= dt;
      if (tower.cooldown <= 0) {
        // Find nearest bot within range
        let nearest: Bot | null = null;
        let minDist = Infinity;
        for (const bot of this.bots) {
          const d = Math.abs(bot.gx - tower.gx) + Math.abs(bot.gy - tower.gy);
          if (d < 2.5 && d < minDist) {
            minDist = d;
            nearest = bot;
          }
        }
        if (nearest) {
          nearest.hp--;
          tower.cooldown = 0.5;
          ctx.audio.shoot();
          if (nearest.hp <= 0) {
            this.score++;
            this.heal(1);
          }
        }
      }
    }

    // Remove dead bots and escaped bots
    this.bots = this.bots.filter((b) => {
      if (b.hp <= 0) return false;
      if (b.gx >= GRID_W - 0.5) {
        const dmg = b.type === "spy" ? 20 : 12;
        this.damage(dmg);
        ctx.audio.damage();
        return false;
      }
      return true;
    });
  }

  draw(ctx: PanelContext): void {
    this.drawShell(ctx, () => {
      const { w, h } = ctx;
      const c = ctx.canvas;
      const contentH = h - 32;

      // Grid
      c.strokeStyle = "rgba(34, 211, 238, 0.08)";
      c.lineWidth = 1;
      for (let i = 0; i <= GRID_W; i++) {
        c.beginPath();
        c.moveTo(i * this.cellW, 0);
        c.lineTo(i * this.cellW, contentH);
        c.stroke();
      }
      for (let j = 0; j <= GRID_H; j++) {
        c.beginPath();
        c.moveTo(0, j * this.cellH);
        c.lineTo(w, j * this.cellH);
        c.stroke();
      }

      // Entry zone
      c.fillStyle = "rgba(244, 63, 94, 0.08)";
      c.fillRect(0, 0, this.cellW, contentH);
      // Exit zone
      c.fillStyle = "rgba(52, 211, 153, 0.08)";
      c.fillRect((GRID_W - 1) * this.cellW, 0, this.cellW, contentH);

      // Towers
      for (const t of this.towers) {
        const tx = t.gx * this.cellW + this.cellW / 2;
        const ty = t.gy * this.cellH + this.cellH / 2;
        c.fillStyle = COLORS.primary;
        c.beginPath();
        c.arc(tx, ty, Math.min(this.cellW, this.cellH) * 0.3, 0, Math.PI * 2);
        c.fill();
        c.strokeStyle = COLORS.white;
        c.lineWidth = 1;
        c.stroke();

        // Range indicator when ready
        if (t.cooldown <= 0) {
          c.strokeStyle = "rgba(34, 211, 238, 0.15)";
          c.lineWidth = 1;
          c.beginPath();
          c.arc(tx, ty, this.cellW * 2.5, 0, Math.PI * 2);
          c.stroke();
        }
      }

      // Bots
      for (const bot of this.bots) {
        const bx = bot.gx * this.cellW + this.cellW / 2;
        const by = bot.gy * this.cellH + this.cellH / 2;
        const r = Math.min(this.cellW, this.cellH) * 0.25;

        c.fillStyle = bot.type === "spy" ? COLORS.warning : COLORS.danger;
        c.beginPath();
        c.arc(bx, by, r, 0, Math.PI * 2);
        c.fill();
        c.strokeStyle = "#fff";
        c.lineWidth = 1;
        c.globalAlpha = 0.3;
        c.stroke();
        c.globalAlpha = 1;

        // HP bar
        if (bot.hp < bot.maxHp) {
          const barW = this.cellW * 0.6;
          c.fillStyle = "rgba(0,0,0,0.5)";
          c.fillRect(bx - barW / 2, by - r - 6, barW, 3);
          c.fillStyle = COLORS.success;
          c.fillRect(bx - barW / 2, by - r - 6, barW * (bot.hp / bot.maxHp), 3);
        }
      }

      // Score
      c.font = "600 11px Rajdhani, sans-serif";
      c.textAlign = "right";
      c.textBaseline = "top";
      c.fillStyle = COLORS.gray;
      c.fillText(`Stopped: ${this.score}`, w - 10, 4);

      c.textAlign = "left";
      c.font = "500 10px Rajdhani, sans-serif";
      c.fillStyle = COLORS.gray;
      c.fillText("Click to place turret", 10, 4);
    });
  }

  drawPreview(ctx: PanelContext): void {
    this.draw(ctx);
  }

  serialize(): SerializedPanelState {
    return {
      id: "intrusion",
      state: this.state,
      health: this.health,
      maxHealth: this.maxHealth,
      data: {
        bots: this.bots,
        towers: this.towers,
        spawnTimer: this.spawnTimer,
        score: this.score,
        cellW: this.cellW,
        cellH: this.cellH,
      },
    };
  }

  deserialize(state: SerializedPanelState): void {
    this.state = state.state;
    this.health = state.health;
    this.maxHealth = state.maxHealth;
    const d = state.data;
    this.bots = (d.bots as Bot[]) || [];
    this.towers = (d.towers as Tower[]) || [];
    this.spawnTimer = (d.spawnTimer as number) || 0;
    this.score = (d.score as number) || 0;
    this.cellW = (d.cellW as number) || 0;
    this.cellH = (d.cellH as number) || 0;
  }
}
