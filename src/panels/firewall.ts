import { GamePanel, PanelContext } from "./base";
import { COLORS, rand, randInt, clamp } from "../utils";

interface Threat {
  x: number;
  y: number;
  vx: number;
  vy: number;
  type: "virus" | "trojan" | "worm";
  size: number;
  hp: number;
  hit: boolean;
}

export class FirewallPanel extends GamePanel {
  id = "firewall";
  title = "FIREWALL";
  icon = "🛡";

  private threats: Threat[] = [];
  private spawnTimer = 0;
  private particles: { x: number; y: number; vx: number; vy: number; life: number; color: string }[] = [];
  private mouseX = 0;
  private mouseY = 0;
  private score = 0;

  update(ctx: PanelContext): void {
    if (this.state !== "active") return;
    const { w, h, dt, difficulty } = ctx;

    this.mouseX = ctx.input.mouseX - ctx.x;
    this.mouseY = ctx.input.mouseY - ctx.y - 30;

    this.spawnTimer -= dt;
    const spawnRate = Math.max(0.4, 2.0 - difficulty * 0.15);
    if (this.spawnTimer <= 0) {
      this.spawnTimer = spawnRate;
      const types: Threat["type"][] = ["virus", "trojan", "worm"];
      this.threats.push({
        x: rand(30, w - 30),
        y: -20,
        vx: rand(-20, 20),
        vy: rand(30, 60) + difficulty * 5,
        type: pick(types),
        size: rand(14, 22),
        hp: 1,
        hit: false,
      });
    }

    for (const t of this.threats) {
      t.x += t.vx * dt;
      t.y += t.vy * dt;
      if (t.x < t.size || t.x > w - t.size) t.vx *= -1;
    }

    // Click to destroy
    if (ctx.input.consumeClick()) {
      for (const t of this.threats) {
        if (!t.hit && Math.hypot(t.x - this.mouseX, t.y - this.mouseY) < t.size + 5) {
          t.hit = true;
          t.hp = 0;
          this.score++;
          ctx.audio.hit();
          this.spawnParticles(t.x, t.y, COLORS.danger);
        }
      }
    }

    // Remove dead / escaped
    this.threats = this.threats.filter((t) => {
      if (t.hit) return false;
      if (t.y > h - 32) {
        this.damage(15);
        ctx.audio.damage();
        return false;
      }
      return true;
    });

    this.updateParticles(dt);
  }

  private spawnParticles(x: number, y: number, color: string): void {
    for (let i = 0; i < 8; i++) {
      this.particles.push({
        x, y,
        vx: rand(-100, 100),
        vy: rand(-100, 100),
        life: 0.5,
        color,
      });
    }
  }

  private updateParticles(dt: number): void {
    for (const p of this.particles) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
      p.vx *= 0.95;
      p.vy *= 0.95;
    }
    this.particles = this.particles.filter((p) => p.life > 0);
  }

  draw(ctx: PanelContext): void {
    this.drawShell(ctx, () => {
      const { w, h } = ctx;
      const c = ctx.canvas;

      // Grid background
      c.strokeStyle = "rgba(34, 211, 238, 0.05)";
      c.lineWidth = 1;
      for (let gx = 0; gx < w; gx += 30) {
        c.beginPath(); c.moveTo(gx, 0); c.lineTo(gx, h - 32); c.stroke();
      }
      for (let gy = 0; gy < h - 32; gy += 30) {
        c.beginPath(); c.moveTo(0, gy); c.lineTo(w, gy); c.stroke();
      }

      // Bottom defense line
      c.strokeStyle = COLORS.primary;
      c.lineWidth = 2;
      c.setLineDash([8, 4]);
      c.beginPath();
      c.moveTo(0, h - 36);
      c.lineTo(w, h - 36);
      c.stroke();
      c.setLineDash([]);

      // Threats
      for (const t of this.threats) {
        c.fillStyle = COLORS.danger;
        c.beginPath();
        c.arc(t.x, t.y, t.size, 0, Math.PI * 2);
        c.fill();
        c.strokeStyle = COLORS.dangerDim;
        c.lineWidth = 2;
        c.stroke();

        c.font = "700 10px Rajdhani, sans-serif";
        c.textAlign = "center";
        c.textBaseline = "middle";
        c.fillStyle = "#fff";
        c.fillText(t.type === "virus" ? "V" : t.type === "trojan" ? "T" : "W", t.x, t.y);
      }

      // Particles
      for (const p of this.particles) {
        c.globalAlpha = p.life * 2;
        c.fillStyle = p.color;
        c.fillRect(p.x - 2, p.y - 2, 4, 4);
      }
      c.globalAlpha = 1;

      // Crosshair
      if (this.mouseX > 0 && this.mouseX < w && this.mouseY > 0 && this.mouseY < h - 32) {
        c.strokeStyle = COLORS.primary;
        c.lineWidth = 1;
        c.globalAlpha = 0.5;
        c.beginPath();
        c.arc(this.mouseX, this.mouseY, 16, 0, Math.PI * 2);
        c.stroke();
        c.globalAlpha = 1;
      }

      // Score
      c.font = "600 11px Rajdhani, sans-serif";
      c.textAlign = "right";
      c.textBaseline = "top";
      c.fillStyle = COLORS.gray;
      c.fillText(`Blocked: ${this.score}`, w - 10, 4);
    });
  }

  drawPreview(ctx: PanelContext): void {
    this.draw(ctx);
  }
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}
