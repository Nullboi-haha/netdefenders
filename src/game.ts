import { Input } from "./input";
import { Audio } from "./audio";
import { COLORS, clamp, rand, roundRect, formatTime } from "./utils";
import { GamePanel, PanelContext } from "./panels/base";
import { FirewallPanel } from "./panels/firewall";
import { RouterPanel } from "./panels/router";
import { DecoderPanel } from "./panels/decoder";
import { IntrusionPanel } from "./panels/intrusion";

type GameState = "menu" | "playing" | "gameover" | "howto";

interface FloatingText {
  x: number;
  y: number;
  text: string;
  color: string;
  life: number;
  vy: number;
}

export class Game {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private input: Input;
  private audio: Audio;

  private state: GameState = "menu";
  private lastTime = 0;
  private gameTime = 0;

  private score = 0;
  private wave = 1;
  private waveTimer = 0;
  private waveDuration = 20;
  private lives = 3;
  private difficulty = 1;
  private combo = 0;
  private comboTimer = 0;

  private panels: GamePanel[] = [];
  private floatingTexts: FloatingText[] = [];

  private menuHover = -1;
  private gameoverHover = -1;

  private stars: { x: number; y: number; z: number; size: number }[] = [];

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d")!;
    this.input = new Input(canvas);
    this.audio = new Audio();
    this.resize();
    window.addEventListener("resize", () => this.resize());
    this.initStars();
  }

  private resize(): void {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.min(window.innerWidth, 1200);
    const h = Math.min(window.innerHeight, 800);
    this.canvas.width = w * dpr;
    this.canvas.height = h * dpr;
    this.canvas.style.width = w + "px";
    this.canvas.style.height = h + "px";
    this.ctx.scale(dpr, dpr);
    this.layoutPanels();
  }

  private get viewW(): number {
    return this.canvas.width / (window.devicePixelRatio || 1);
  }
  private get viewH(): number {
    return this.canvas.height / (window.devicePixelRatio || 1);
  }

  private initStars(): void {
    this.stars = [];
    for (let i = 0; i < 80; i++) {
      this.stars.push({
        x: rand(0, 1200),
        y: rand(0, 800),
        z: rand(0.3, 1),
        size: rand(0.5, 2),
      });
    }
  }

  private layoutPanels(): void {
    if (this.panels.length === 0) return;
    const vw = this.viewW;
    const vh = this.viewH;
    const hudH = 60;
    const margin = 12;
    const gap = 10;

    const cols = 2;
    const rows = 2;
    const panelW = (vw - margin * 2 - gap * (cols - 1)) / cols;
    const panelH = (vh - hudH - margin * 2 - gap * (rows - 1)) / rows;

    for (let i = 0; i < this.panels.length; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      this.panels[i]["_layout"] = {
        x: margin + col * (panelW + gap),
        y: hudH + margin + row * (panelH + gap),
        w: panelW,
        h: panelH,
      };
    }
  }

  private startGame(): void {
    this.score = 0;
    this.wave = 1;
    this.waveTimer = this.waveDuration;
    this.lives = 3;
    this.difficulty = 1;
    this.combo = 0;
    this.comboTimer = 0;
    this.gameTime = 0;
    this.floatingTexts = [];

    this.panels = [
      new FirewallPanel(),
      new RouterPanel(),
      new DecoderPanel(),
      new IntrusionPanel(),
    ];
    this.layoutPanels();
    this.state = "playing";
    this.audio.waveStart();
  }

  private get alivePanels(): GamePanel[] {
    return this.panels.filter((p) => p.state === "active");
  }

  private get crashedCount(): number {
    return this.panels.filter((p) => p.state === "crashed").length;
  }

  update(dt: number): void {
    this.gameTime += dt;
    this.input.resetFrame();

    if (this.state === "menu") {
      this.updateStars(dt);
      this.updateMenu();
      return;
    }

    if (this.state === "howto") {
      this.updateStars(dt);
      if (this.input.isAnyDown("escape", "enter", " ")) {
        this.state = "menu";
        this.audio.click();
      }
      return;
    }

    if (this.state === "gameover") {
      this.updateStars(dt);
      this.updateGameOver();
      return;
    }

    if (this.state !== "playing") return;

    this.updateStars(dt);

    // Wave timer
    this.waveTimer -= dt;
    if (this.waveTimer <= 0) {
      this.wave++;
      this.waveTimer = this.waveDuration;
      this.difficulty = 1 + (this.wave - 1) * 0.5;
      this.audio.waveStart();
      this.addFloatingText(this.viewW / 2, this.viewH / 2, `WAVE ${this.wave}`, COLORS.accent, 2);
      // Revive one crashed panel at wave start
      const crashed = this.panels.find((p) => p.state === "crashed");
      if (crashed) {
        crashed.state = "active";
        crashed.health = 40;
      }
    }

    // Combo timer
    if (this.comboTimer > 0) {
      this.comboTimer -= dt;
      if (this.comboTimer <= 0) this.combo = 0;
    }

    // Update panels
    for (const panel of this.panels) {
      if (panel.state !== "active") continue;
      const layout = panel["_layout"];
      const ctx: PanelContext = {
        x: layout.x,
        y: layout.y,
        w: layout.w,
        h: layout.h,
        dt,
        input: this.input,
        audio: this.audio,
        difficulty: this.difficulty,
        time: this.gameTime,
      };
      const prevHealth = panel.health;
      panel.update(ctx);

      // Score from healing
      if (panel.health > prevHealth) {
        const healed = panel.health - prevHealth;
        this.score += Math.round(healed * 5 * (1 + this.combo * 0.1));
        this.combo++;
        this.comboTimer = 2;
      }

      // Check if panel just crashed
      if (panel.state === "crashed" && prevHealth > 0) {
        this.lives--;
        this.combo = 0;
        this.addFloatingText(layout.x + layout.w / 2, layout.y + layout.h / 2, "PANEL DOWN!", COLORS.danger, 1.5);
        this.audio.gameOver();
        if (this.lives <= 0) {
          this.state = "gameover";
        }
      }
    }

    // Passive score from surviving
    this.score += Math.round(dt * 2 * this.alivePanels.length);

    // Floating texts
    for (const ft of this.floatingTexts) {
      ft.y += ft.vy * dt;
      ft.life -= dt;
    }
    this.floatingTexts = this.floatingTexts.filter((ft) => ft.life > 0);
  }

  private updateStars(dt: number): void {
    for (const s of this.stars) {
      s.y += s.z * 20 * dt;
      if (s.y > 800) {
        s.y = 0;
        s.x = rand(0, 1200);
      }
    }
  }

  private addFloatingText(x: number, y: number, text: string, color: string, life: number): void {
    this.floatingTexts.push({ x, y, text, color, life, vy: -40 });
  }

  private updateMenu(): void {
    const vw = this.viewW;
    const vh = this.viewH;
    const btnW = 260;
    const btnH = 52;
    const cx = vw / 2;
    const cy = vh / 2;

    const buttons = [
      { label: "START GAME", y: cy + 30 },
      { label: "HOW TO PLAY", y: cy + 30 + btnH + 12 },
    ];

    this.menuHover = -1;
    const mx = this.input.mouseX;
    const my = this.input.mouseY;

    for (let i = 0; i < buttons.length; i++) {
      const bx = cx - btnW / 2;
      const by = buttons[i].y;
      if (mx >= bx && mx <= bx + btnW && my >= by && my <= by + btnH) {
        this.menuHover = i;
        if (this.input.consumeClick()) {
          this.audio.click();
          if (i === 0) this.startGame();
          else this.state = "howto";
        }
      }
    }

    if (this.input.isAnyDown("enter", " ")) {
      this.audio.click();
      this.startGame();
    }
  }

  private updateGameOver(): void {
    const vw = this.viewW;
    const vh = this.viewH;
    const btnW = 260;
    const btnH = 52;
    const cx = vw / 2;
    const cy = vh / 2 + 80;

    const buttons = [
      { label: "PLAY AGAIN", y: cy },
      { label: "MAIN MENU", y: cy + btnH + 12 },
    ];

    this.gameoverHover = -1;
    const mx = this.input.mouseX;
    const my = this.input.mouseY;

    for (let i = 0; i < buttons.length; i++) {
      const bx = cx - btnW / 2;
      const by = buttons[i].y;
      if (mx >= bx && mx <= bx + btnW && my >= by && my <= by + btnH) {
        this.gameoverHover = i;
        if (this.input.consumeClick()) {
          this.audio.click();
          if (i === 0) this.startGame();
          else this.state = "menu";
        }
      }
    }

    if (this.input.isAnyDown("enter", " ")) {
      this.audio.click();
      this.startGame();
    }
    if (this.input.isAnyDown("escape")) {
      this.audio.click();
      this.state = "menu";
    }
  }

  render(): void {
    const ctx = this.ctx;
    const vw = this.viewW;
    const vh = this.viewH;

    // Background
    const grad = ctx.createLinearGradient(0, 0, 0, vh);
    grad.addColorStop(0, COLORS.bgGrad1);
    grad.addColorStop(1, COLORS.bgGrad2);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, vw, vh);

    // Stars
    for (const s of this.stars) {
      ctx.fillStyle = `rgba(34, 211, 238, ${s.z * 0.4})`;
      ctx.fillRect(s.x, s.y, s.size, s.size);
    }

    if (this.state === "menu") {
      this.renderMenu();
    } else if (this.state === "howto") {
      this.renderHowTo();
    } else if (this.state === "gameover") {
      this.renderPanels();
      this.renderHUD();
      this.renderGameOver();
    } else {
      this.renderPanels();
      this.renderHUD();
    }

    // Floating texts
    for (const ft of this.floatingTexts) {
      ctx.globalAlpha = clamp(ft.life, 0, 1);
      ctx.font = "900 28px Orbitron, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = ft.color;
      ctx.fillText(ft.text, ft.x, ft.y);
      ctx.globalAlpha = 1;
    }
  }

  private renderMenu(): void {
    const ctx = this.ctx;
    const vw = this.viewW;
    const vh = this.viewH;
    const cx = vw / 2;

    // Title
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    // Glow effect
    ctx.shadowColor = COLORS.primary;
    ctx.shadowBlur = 20;
    ctx.font = "900 52px Orbitron, sans-serif";
    ctx.fillStyle = COLORS.primary;
    ctx.fillText("NETDEFENDERS", cx, vh / 2 - 80);
    ctx.shadowBlur = 0;

    ctx.font = "700 28px Orbitron, sans-serif";
    ctx.fillStyle = COLORS.accent;
    ctx.fillText("M U L T I T A S K E R", cx, vh / 2 - 40);

    ctx.font = "500 16px Rajdhani, sans-serif";
    ctx.fillStyle = COLORS.gray;
    ctx.fillText("Defend your network across four fronts — simultaneously.", cx, vh / 2 - 5);

    // Buttons
    const btnW = 260;
    const btnH = 52;
    const labels = ["START GAME", "HOW TO PLAY"];
    for (let i = 0; i < labels.length; i++) {
      const bx = cx - btnW / 2;
      const by = vh / 2 + 30 + i * (btnH + 12);
      const hover = this.menuHover === i;

      ctx.fillStyle = hover ? "rgba(34, 211, 238, 0.15)" : "rgba(15, 23, 42, 0.8)";
      roundRect(ctx, bx, by, btnW, btnH, 8);
      ctx.fill();
      ctx.strokeStyle = hover ? COLORS.primary : COLORS.primaryDim;
      ctx.lineWidth = hover ? 2 : 1;
      ctx.stroke();

      ctx.font = "700 20px Orbitron, sans-serif";
      ctx.fillStyle = hover ? COLORS.primary : COLORS.white;
      ctx.fillText(labels[i], cx, by + btnH / 2);
    }

    // Footer
    ctx.font = "500 13px Rajdhani, sans-serif";
    ctx.fillStyle = COLORS.gray;
    ctx.fillText("Click or press SPACE to start", cx, vh - 40);
  }

  private renderHowTo(): void {
    const ctx = this.ctx;
    const vw = this.viewW;
    const vh = this.viewH;
    const cx = vw / 2;

    ctx.textAlign = "center";
    ctx.textBaseline = "top";

    ctx.font = "900 36px Orbitron, sans-serif";
    ctx.fillStyle = COLORS.primary;
    ctx.fillText("HOW TO PLAY", cx, 40);

    const lines = [
      { icon: "🛡", title: "FIREWALL", desc: "Click incoming threats to destroy them before they breach the bottom line." },
      { icon: "📡", title: "PACKET ROUTER", desc: "Guide packets to the matching colored port. Click lanes or press 1-4." },
      { icon: "🔑", title: "DECRYPTOR", desc: "Type the letters shown on each threat to decrypt it before it expires." },
      { icon: "🏰", title: "INTRUSION GRID", desc: "Click cells to place turrets that auto-fire on incoming bots." },
    ];

    let y = 110;
    for (const line of lines) {
      ctx.textAlign = "left";
      ctx.font = "700 20px Orbitron, sans-serif";
      ctx.fillStyle = COLORS.accent;
      ctx.fillText(`${line.icon}  ${line.title}`, cx - 280, y);
      ctx.font = "500 16px Rajdhani, sans-serif";
      ctx.fillStyle = COLORS.white;
      ctx.fillText(line.desc, cx - 280, y + 26);
      y += 70;
    }

    ctx.textAlign = "center";
    ctx.font = "500 14px Rajdhani, sans-serif";
    ctx.fillStyle = COLORS.gray;
    ctx.fillText("Keep all panels alive. Each crashed panel costs a life.", cx, y + 10);
    ctx.fillText("Survive waves to increase difficulty. Last as long as you can!", cx, y + 30);

    ctx.font = "600 16px Rajdhani, sans-serif";
    ctx.fillStyle = COLORS.primary;
    ctx.fillText("Press ESC or ENTER to return", cx, vh - 50);
  }

  private renderPanels(): void {
    for (const panel of this.panels) {
      const layout = panel["_layout"];
      if (!layout) continue;
      const ctx: PanelContext = {
        x: layout.x,
        y: layout.y,
        w: layout.w,
        h: layout.h,
        dt: 0,
        input: this.input,
        audio: this.audio,
        difficulty: this.difficulty,
        time: this.gameTime,
      };
      panel.draw(ctx);
    }
  }

  private renderHUD(): void {
    const ctx = this.ctx;
    const vw = this.viewW;

    // HUD bar
    ctx.fillStyle = "rgba(13, 19, 33, 0.95)";
    ctx.fillRect(0, 0, vw, 60);
    ctx.strokeStyle = COLORS.primaryDim;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, 60);
    ctx.lineTo(vw, 60);
    ctx.stroke();

    ctx.textAlign = "left";
    ctx.textBaseline = "middle";

    // Score
    ctx.font = "700 12px Rajdhani, sans-serif";
    ctx.fillStyle = COLORS.gray;
    ctx.fillText("SCORE", 20, 18);
    ctx.font = "900 24px Orbitron, sans-serif";
    ctx.fillStyle = COLORS.primary;
    ctx.fillText(this.score.toString().padStart(6, "0"), 20, 40);

    // Wave
    ctx.font = "700 12px Rajdhani, sans-serif";
    ctx.fillStyle = COLORS.gray;
    ctx.fillText("WAVE", 160, 18);
    ctx.font = "900 24px Orbitron, sans-serif";
    ctx.fillStyle = COLORS.accent;
    ctx.fillText(this.wave.toString(), 160, 40);

    // Wave timer bar
    const barX = 220;
    const barW = 120;
    ctx.fillStyle = "rgba(0,0,0,0.3)";
    ctx.fillRect(barX, 32, barW, 8);
    ctx.fillStyle = COLORS.accent;
    ctx.fillRect(barX, 32, barW * (this.waveTimer / this.waveDuration), 8);
    ctx.strokeStyle = COLORS.grayDim;
    ctx.lineWidth = 1;
    ctx.strokeRect(barX, 32, barW, 8);
    ctx.font = "500 11px Rajdhani, sans-serif";
    ctx.fillStyle = COLORS.gray;
    ctx.fillText("NEXT WAVE", barX, 18);

    // Lives
    ctx.font = "700 12px Rajdhani, sans-serif";
    ctx.fillStyle = COLORS.gray;
    ctx.fillText("LIVES", 370, 18);
    for (let i = 0; i < 3; i++) {
      const lx = 370 + i * 22;
      ctx.fillStyle = i < this.lives ? COLORS.danger : COLORS.grayDim;
      ctx.beginPath();
      ctx.arc(lx + 8, 40, 7, 0, Math.PI * 2);
      ctx.fill();
    }

    // Combo
    if (this.combo > 1) {
      ctx.font = "700 12px Rajdhani, sans-serif";
      ctx.fillStyle = COLORS.gray;
      ctx.fillText("COMBO", 460, 18);
      ctx.font = "900 24px Orbitron, sans-serif";
      ctx.fillStyle = COLORS.warning;
      ctx.fillText(`x${this.combo}`, 460, 40);
    }

    // Panel status
    ctx.textAlign = "right";
    ctx.font = "700 12px Rajdhani, sans-serif";
    ctx.fillStyle = COLORS.gray;
    ctx.fillText("PANELS", vw - 90, 18);
    for (let i = 0; i < this.panels.length; i++) {
      const p = this.panels[i];
      const px = vw - 80 + i * 18;
      ctx.fillStyle = p.state === "active" ? COLORS.success : COLORS.danger;
      ctx.beginPath();
      ctx.arc(px, 40, 6, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private renderGameOver(): void {
    const ctx = this.ctx;
    const vw = this.viewW;
    const vh = this.viewH;
    const cx = vw / 2;

    // Overlay
    ctx.fillStyle = "rgba(7, 10, 18, 0.85)";
    ctx.fillRect(0, 0, vw, vh);

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    ctx.shadowColor = COLORS.danger;
    ctx.shadowBlur = 20;
    ctx.font = "900 56px Orbitron, sans-serif";
    ctx.fillStyle = COLORS.danger;
    ctx.fillText("GAME OVER", cx, vh / 2 - 100);
    ctx.shadowBlur = 0;

    ctx.font = "700 16px Rajdhani, sans-serif";
    ctx.fillStyle = COLORS.gray;
    ctx.fillText("Your network has been compromised.", cx, vh / 2 - 55);

    ctx.font = "700 14px Rajdhani, sans-serif";
    ctx.fillStyle = COLORS.gray;
    ctx.fillText("FINAL SCORE", cx, vh / 2 - 15);
    ctx.font = "900 48px Orbitron, sans-serif";
    ctx.fillStyle = COLORS.primary;
    ctx.fillText(this.score.toString().padStart(6, "0"), cx, vh / 2 + 20);

    ctx.font = "600 16px Rajdhani, sans-serif";
    ctx.fillStyle = COLORS.accent;
    ctx.fillText(`Reached Wave ${this.wave}`, cx, vh / 2 + 55);

    // Buttons
    const btnW = 260;
    const btnH = 52;
    const labels = ["PLAY AGAIN", "MAIN MENU"];
    for (let i = 0; i < labels.length; i++) {
      const bx = cx - btnW / 2;
      const by = vh / 2 + 80 + i * (btnH + 12);
      const hover = this.gameoverHover === i;

      ctx.fillStyle = hover ? "rgba(34, 211, 238, 0.15)" : "rgba(15, 23, 42, 0.8)";
      roundRect(ctx, bx, by, btnW, btnH, 8);
      ctx.fill();
      ctx.strokeStyle = hover ? COLORS.primary : COLORS.primaryDim;
      ctx.lineWidth = hover ? 2 : 1;
      ctx.stroke();

      ctx.font = "700 20px Orbitron, sans-serif";
      ctx.fillStyle = hover ? COLORS.primary : COLORS.white;
      ctx.fillText(labels[i], cx, by + btnH / 2);
    }
  }

  loop(timestamp: number): void {
    const dt = Math.min(0.05, (timestamp - this.lastTime) / 1000) || 0;
    this.lastTime = timestamp;

    this.update(dt);
    this.render();

    requestAnimationFrame((t) => this.loop(t));
  }

  start(): void {
    requestAnimationFrame((t) => {
      this.lastTime = t;
      this.loop(t);
    });
  }
}
