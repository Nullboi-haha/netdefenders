import { GamePanel, PanelContext } from "./base";
import { COLORS, rand, clamp } from "../utils";
import { SerializedPanelState } from "../multiplayer/types";

interface Packet {
  x: number;
  y: number;
  color: string;
  targetLane: number;
  lane: number;
  speed: number;
  size: number;
  counted: boolean;
}

const LANES = 4;
const LANE_COLORS = ["#22d3ee", "#34d399", "#f59e0b", "#f43f5e"];

export class RouterPanel extends GamePanel {
  id = "router";
  title = "PACKET ROUTER";
  icon = "📡";

  private packets: Packet[] = [];
  private spawnTimer = 0;
  private selectedLane = 0;
  private score = 0;

  update(ctx: PanelContext): void {
    if (this.state !== "active") return;
    const { w, h, dt, difficulty, input } = ctx;

    // Keyboard lane selection
    if (input.isAnyDown("1")) this.selectedLane = 0;
    if (input.isAnyDown("2")) this.selectedLane = 1;
    if (input.isAnyDown("3")) this.selectedLane = 2;
    if (input.isAnyDown("4")) this.selectedLane = 3;

    // Click lane selection
    const localMouseX = input.mouseX - ctx.x;
    const localMouseY = input.mouseY - ctx.y - 30;
    if (input.consumeClick() && localMouseY > 0 && localMouseY < h - 32) {
      const laneW = w / LANES;
      const lane = clamp(Math.floor(localMouseX / laneW), 0, LANES - 1);
      this.selectedLane = lane;
    }

    this.spawnTimer -= dt;
    const spawnRate = Math.max(0.6, 1.8 - difficulty * 0.1);
    if (this.spawnTimer <= 0) {
      this.spawnTimer = spawnRate;
      const targetLane = Math.floor(rand(0, LANES));
      this.packets.push({
        x: w / 2,
        y: 20,
        color: LANE_COLORS[targetLane],
        targetLane,
        lane: 1,
        speed: rand(40, 70) + difficulty * 4,
        size: 10,
        counted: false,
      });
    }

    const laneW = w / LANES;
    for (const p of this.packets) {
      // Move down
      p.y += p.speed * dt;
      // Steer toward selected lane
      const targetX = this.selectedLane * laneW + laneW / 2;
      p.x = clamp(p.x + (targetX - p.x) * dt * 4, laneW * 0.1, w - laneW * 0.1);
      p.lane = this.selectedLane;
    }

    // Check packets at bottom
    for (const p of this.packets) {
      if (!p.counted && p.y > h - 52) {
        p.counted = true;
        if (p.lane === p.targetLane) {
          this.score++;
          ctx.audio.score();
          this.heal(2);
        } else {
          this.damage(12);
          ctx.audio.damage();
        }
      }
    }

    this.packets = this.packets.filter((p) => p.y < h - 30);
  }

  draw(ctx: PanelContext): void {
    this.drawShell(ctx, () => {
      const { w, h } = ctx;
      const c = ctx.canvas;
      const contentH = h - 32;
      const laneW = w / LANES;

      // Lane backgrounds
      for (let i = 0; i < LANES; i++) {
        c.fillStyle = i === this.selectedLane
          ? `${LANE_COLORS[i]}22`
          : "rgba(255,255,255,0.02)";
        c.fillRect(i * laneW, 0, laneW, contentH);

        // Lane divider
        if (i > 0) {
          c.strokeStyle = "rgba(100, 116, 139, 0.2)";
          c.lineWidth = 1;
          c.beginPath();
          c.moveTo(i * laneW, 0);
          c.lineTo(i * laneW, contentH);
          c.stroke();
        }

        // Target zone at bottom
        c.fillStyle = LANE_COLORS[i];
        c.globalAlpha = 0.15;
        c.fillRect(i * laneW + 2, contentH - 20, laneW - 4, 18);
        c.globalAlpha = 1;
        c.strokeStyle = LANE_COLORS[i];
        c.lineWidth = i === this.selectedLane ? 3 : 1;
        c.strokeRect(i * laneW + 2, contentH - 20, laneW - 4, 18);

        c.font = "700 11px Rajdhani, sans-serif";
        c.textAlign = "center";
        c.textBaseline = "middle";
        c.fillStyle = LANE_COLORS[i];
        c.fillText(`P${i + 1}`, i * laneW + laneW / 2, contentH - 11);
      }

      // Packets
      for (const p of this.packets) {
        c.fillStyle = p.color;
        c.beginPath();
        c.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        c.fill();
        c.strokeStyle = "#fff";
        c.lineWidth = 1;
        c.globalAlpha = 0.4;
        c.stroke();
        c.globalAlpha = 1;

        // Target indicator
        const tx = p.targetLane * laneW + laneW / 2;
        c.strokeStyle = p.color;
        c.globalAlpha = 0.3;
        c.lineWidth = 1;
        c.setLineDash([3, 3]);
        c.beginPath();
        c.moveTo(p.x, p.y);
        c.lineTo(tx, contentH - 20);
        c.stroke();
        c.setLineDash([]);
        c.globalAlpha = 1;
      }

      // Score
      c.font = "600 11px Rajdhani, sans-serif";
      c.textAlign = "right";
      c.textBaseline = "top";
      c.fillStyle = COLORS.gray;
      c.fillText(`Routed: ${this.score}`, w - 10, 4);

      c.textAlign = "left";
      c.fillStyle = COLORS.gray;
      c.font = "500 10px Rajdhani, sans-serif";
      c.fillText("Click lane or press 1-4", 10, 4);
    });
  }

  drawPreview(ctx: PanelContext): void {
    this.draw(ctx);
  }

  serialize(): SerializedPanelState {
    return {
      id: "router",
      state: this.state,
      health: this.health,
      maxHealth: this.maxHealth,
      data: {
        packets: this.packets,
        spawnTimer: this.spawnTimer,
        selectedLane: this.selectedLane,
        score: this.score,
      },
    };
  }

  deserialize(state: SerializedPanelState): void {
    this.state = state.state;
    this.health = state.health;
    this.maxHealth = state.maxHealth;
    const d = state.data;
    this.packets = (d.packets as Packet[]) || [];
    this.spawnTimer = (d.spawnTimer as number) || 0;
    this.selectedLane = (d.selectedLane as number) || 0;
    this.score = (d.score as number) || 0;
  }
}
