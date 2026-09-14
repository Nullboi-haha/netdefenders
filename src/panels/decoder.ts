import { GamePanel, PanelContext } from "./base";
import { COLORS, rand, pick, chance } from "../utils";

const KEYS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

interface DecryptJob {
  sequence: string;
  typed: number;
  y: number;
  speed: number;
  expired: boolean;
}

export class DecoderPanel extends GamePanel {
  id = "decoder";
  title = "DECRYPTOR";
  icon = "🔑";

  private jobs: DecryptJob[] = [];
  private spawnTimer = 0;
  private score = 0;
  private lastKey = "";
  private keyFlash = 0;

  update(ctx: PanelContext): void {
    if (this.state !== "active") return;
    const { w, h, dt, difficulty, input } = ctx;

    this.spawnTimer -= dt;
    const spawnRate = Math.max(1.0, 2.5 - difficulty * 0.12);
    if (this.spawnTimer <= 0) {
      this.spawnTimer = spawnRate;
      const len = Math.min(6, 3 + Math.floor(difficulty / 3));
      let seq = "";
      for (let i = 0; i < len; i++) seq += pick(KEYS.split(""));
      this.jobs.push({
        sequence: seq,
        typed: 0,
        y: -10,
        speed: rand(15, 25) + difficulty * 2,
        expired: false,
      });
    }

    for (const job of this.jobs) {
      job.y += job.speed * dt;
      if (job.y > h - 50 && !job.expired) {
        job.expired = true;
        this.damage(15);
        ctx.audio.damage();
      }
    }

    // Capture key presses
    for (let i = 0; i < KEYS.length; i++) {
      const k = KEYS[i].toLowerCase();
      if (input.isDown(k) && k !== this.lastKey) {
        this.lastKey = k;
        this.keyFlash = 1;
        let matched = false;
        for (const job of this.jobs) {
          if (job.expired) continue;
          const expected = job.sequence[job.typed].toLowerCase();
          if (k === expected) {
            job.typed++;
            matched = true;
            ctx.audio.alert();
            if (job.typed >= job.sequence.length) {
              job.expired = true;
              this.score++;
              this.heal(3);
              ctx.audio.score();
            }
            break;
          }
        }
        if (!matched) {
          // Wrong key — small penalty
          this.damage(2);
        }
      }
    }
    // Reset lastKey when key is released
    if (this.lastKey && !input.isDown(this.lastKey)) {
      this.lastKey = "";
    }

    if (this.keyFlash > 0) {
      this.keyFlash -= dt * 4;
      if (this.keyFlash < 0) this.keyFlash = 0;
    }

    this.jobs = this.jobs.filter((j) => !j.expired || j.y < h - 30);
  }

  draw(ctx: PanelContext): void {
    this.drawShell(ctx, () => {
      const { w, h } = ctx;
      const c = ctx as unknown as CanvasRenderingContext2D;
      const contentH = h - 32;

      // Key flash
      if (this.keyFlash > 0) {
        c.fillStyle = `rgba(34, 211, 238, ${this.keyFlash * 0.1})`;
        c.fillRect(0, 0, w, contentH);
      }

      // Jobs
      for (const job of this.jobs) {
        if (job.expired) continue;
        const jobY = job.y;
        const jobH = 36;
        const jobW = job.sequence.length * 16 + 20;
        const jobX = w / 2 - jobW / 2;

        // Background
        c.fillStyle = "rgba(15, 23, 42, 0.9)";
        c.strokeStyle = COLORS.primaryDim;
        c.lineWidth = 1;
        c.beginPath();
        c.roundRect(jobX, jobY, jobW, jobH, 6);
        c.fill();
        c.stroke();

        // Characters
        c.font = "700 16px Orbitron, monospace";
        c.textAlign = "center";
        c.textBaseline = "middle";
        for (let i = 0; i < job.sequence.length; i++) {
          const chX = jobX + 12 + i * 16;
          const chY = jobY + jobH / 2;
          if (i < job.typed) {
            c.fillStyle = COLORS.success;
            c.fillText(job.sequence[i], chX, chY);
          } else if (i === job.typed) {
            c.fillStyle = COLORS.accent;
            c.fillText(job.sequence[i], chX, chY);
            // Underline current
            c.strokeStyle = COLORS.accent;
            c.lineWidth = 2;
            c.beginPath();
            c.moveTo(chX - 6, chY + 10);
            c.lineTo(chX + 6, chY + 10);
            c.stroke();
          } else {
            c.fillStyle = COLORS.gray;
            c.fillText(job.sequence[i], chX, chY);
          }
        }
      }

      // Score
      c.font = "600 11px Rajdhani, sans-serif";
      c.textAlign = "right";
      c.textBaseline = "top";
      c.fillStyle = COLORS.gray;
      c.fillText(`Decrypted: ${this.score}`, w - 10, 4);

      c.textAlign = "left";
      c.font = "500 10px Rajdhani, sans-serif";
      c.fillStyle = COLORS.gray;
      c.fillText("Type letters to decrypt", 10, 4);
    });
  }

  drawPreview(ctx: PanelContext): void {
    this.draw(ctx);
  }
}
