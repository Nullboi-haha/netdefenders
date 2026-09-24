import { Input } from "./input";
import { Audio } from "./audio";
import { COLORS, clamp, rand, roundRect, formatTime } from "./utils";
import { GamePanel, PanelContext } from "./panels/base";
import { FirewallPanel } from "./panels/firewall";
import { RouterPanel } from "./panels/router";
import { DecoderPanel } from "./panels/decoder";
import { IntrusionPanel } from "./panels/intrusion";
import {
  SerializedGameState,
  SerializedPanelState,
  PanelId,
  PanelInputState,
  PlayerCount,
  LobbyStateData,
} from "./multiplayer/types";
import { MultiplayerManager } from "./multiplayer/manager";
import { MultiplayerUI, MenuMode } from "./multiplayer/ui";
import { MultiplayerInput } from "./multiplayer/mp-input";
import { NetworkManager } from "./multiplayer/network";
import { ALL_PANELS, PANEL_NAMES, PANEL_ICONS, getPlayerColor, getPlayerName } from "./multiplayer/assignments";
import { HelperBot, createHelperBot, BotAction } from "./panels/helperbot";

type GameState = "menu" | "playing" | "gameover" | "howto";

interface FloatingText {
  x: number;
  y: number;
  text: string;
  color: string;
  life: number;
  vy: number;
}

type GameMode = "solo" | "host" | "client";

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
  private panelMap: Map<PanelId, GamePanel> = new Map();
  private floatingTexts: FloatingText[] = [];

  private menuHover = -1;
  private gameoverHover = -1;

  private stars: { x: number; y: number; z: number; size: number }[] = [];

  private mode: GameMode = "solo";
  private mpManager: MultiplayerManager | null = null;
  private mpUI: MultiplayerUI;
  private mpInputs: Map<PanelId, MultiplayerInput> = new Map();
  private helperBots: Map<PanelId, HelperBot> = new Map();
  private panelOwners: Map<PanelId, string> = new Map();
  private myPanels: Set<PanelId> = new Set();
  private stateSyncTimer = 0;
  private stateSyncInterval = 0.05;
  private disconnectedPlayers: { id: string; name: string; timer: number }[] = [];
  private moderatorControls = false;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d")!;
    this.input = new Input(canvas);
    this.audio = new Audio();
    this.mpUI = new MultiplayerUI(this.ctx);
    this.resize();
    window.addEventListener("resize", () => this.resize());
    this.initStars();
    this.setupKeyboardHandler();
  }

  private setupKeyboardHandler(): void {
    window.addEventListener("keydown", (e) => {
      const key = e.key.toLowerCase();
      if (this.state === "menu" && this.mode !== "solo") {
        this.mpUI.handleKeyInput(key);
      }
    });
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
    this.disconnectedPlayers = [];

    this.panels = [
      new FirewallPanel(),
      new RouterPanel(),
      new DecoderPanel(),
      new IntrusionPanel(),
    ];
    this.panelMap.clear();
    for (const p of this.panels) {
      this.panelMap.set(p.id as PanelId, p);
    }
    this.layoutPanels();
    this.state = "playing";
    this.audio.waveStart();
  }

  private startMultiplayerGame(): void {
    this.score = 0;
    this.wave = 1;
    this.waveTimer = this.waveDuration;
    this.lives = 3;
    this.difficulty = 1;
    this.combo = 0;
    this.comboTimer = 0;
    this.gameTime = 0;
    this.floatingTexts = [];
    this.disconnectedPlayers = [];

    this.panels = [
      new FirewallPanel(),
      new RouterPanel(),
      new DecoderPanel(),
      new IntrusionPanel(),
    ];
    this.panelMap.clear();
    for (const p of this.panels) {
      this.panelMap.set(p.id as PanelId, p);
    }
    this.layoutPanels();

    this.mpInputs.clear();
    this.helperBots.clear();

    if (this.mpManager) {
      const lobby = this.mpManager.getLobbyState();
      if (lobby) {
        this.panelOwners.clear();
        for (const [panelId, playerId] of Object.entries(lobby.assignments)) {
          if (playerId) {
            this.panelOwners.set(panelId as PanelId, playerId);
          }
        }

        this.myPanels = new Set(this.mpManager.getMyPanelIds());

        if (this.mode === "host") {
          for (const panelId of ALL_PANELS) {
            const ownerId = this.panelOwners.get(panelId);
            const myInfo = this.mpManager.getMyPlayerInfo();
            const isMine = ownerId === this.mpManager.getMyPlayerInfo()?.id;

            if (lobby.playerCount === 2 && isMine) {
              const bot = createHelperBot(panelId);
              this.helperBots.set(panelId, bot);
            }

            if (!isMine && ownerId) {
              const mpInput = new MultiplayerInput(this.canvas);
              mpInput.setRemoteActive(true);
              this.mpInputs.set(panelId, mpInput);
            }
          }
        }

        this.moderatorControls = this.mpManager.isModerator();
      }
    }

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

    if (this.state === "menu") {
      this.updateStars(dt);
      this.updateMenu(dt);
      this.input.resetFrame();
      return;
    }

    if (this.state === "howto") {
      this.updateStars(dt);
      if (this.input.isAnyDown("escape", "enter", " ")) {
        this.state = "menu";
        this.audio.click();
      }
      this.input.resetFrame();
      return;
    }

    if (this.state === "gameover") {
      this.updateStars(dt);
      this.updateGameOver();
      this.input.resetFrame();
      return;
    }

    if (this.state !== "playing") {
      this.input.resetFrame();
      return;
    }

    this.updateStars(dt);

    if (this.mode === "client") {
      this.updateClient(dt);
    } else {
      this.updateHostOrSolo(dt);
    }

    this.updateDisconnectedMessages(dt);

    this.input.resetFrame();
  }

  private updateMenu(dt: number): void {
    if (this.mode === "solo") {
      this.updateSoloMenu();
      return;
    }

    this.mpUI.setMouse(this.input.mouseX, this.input.mouseY, this.input.consumeClick());
    this.mpUI.update(dt);

    const menuMode = this.mpUI.getMenuState().mode;

    if (menuMode === "solo") {
      if (this.input.isAnyDown("escape")) {
        this.mode = "solo";
        this.state = "menu";
        this.input.resetFrame();
        return;
      }
      this.updateSoloMenu();
      return;
    }

    if (menuMode === "howto") {
      this.renderHowTo();
      if (this.input.isAnyDown("escape", "enter", " ")) {
        this.mpUI.setMenuMode("solo");
      }
      return;
    }

    if (menuMode === "multiplayer-menu") {
      this.mpUI.renderMultiplayerMenu();
      return;
    }

    if (menuMode === "lobby-host") {
      this.mpUI.renderHostSetup();
      return;
    }

    if (menuMode === "lobby-join") {
      this.mpUI.renderJoinSetup();
      return;
    }

    if (menuMode === "lobby" || menuMode === "assignments") {
      this.mpUI.renderLobby();
      if (menuMode === "assignments") {
        this.mpUI.renderAssignments();
      }
      return;
    }
  }

  private updateSoloMenu(): void {
    const vw = this.viewW;
    const vh = this.viewH;
    const btnW = 260;
    const btnH = 52;
    const cx = vw / 2;
    const cy = vh / 2;

    const buttons = [
      { label: "START GAME", y: cy + 30 },
      { label: "HOW TO PLAY", y: cy + 30 + btnH + 12 },
      { label: "MULTIPLAYER", y: cy + 30 + (btnH + 12) * 2 },
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
          else if (i === 1) this.state = "howto";
          else if (i === 2) {
            this.mode = "multiplayer";
            this.mpUI.setMenuMode("multiplayer-menu");
          }
        }
      }
    }

    if (this.input.isAnyDown("enter", " ")) {
      this.audio.click();
      this.startGame();
    }
  }

  private updateHostOrSolo(dt: number): void {
    this.waveTimer -= dt;
    if (this.waveTimer <= 0) {
      this.wave++;
      this.waveTimer = this.waveDuration;
      this.difficulty = 1 + (this.wave - 1) * 0.5;
      this.audio.waveStart();
      this.addFloatingText(this.viewW / 2, this.viewH / 2, `WAVE ${this.wave}`, COLORS.accent, 2);
      const crashed = this.panels.find((p) => p.state === "crashed");
      if (crashed) {
        crashed.state = "active";
        crashed.health = 40;
      }
    }

    if (this.comboTimer > 0) {
      this.comboTimer -= dt;
      if (this.comboTimer <= 0) this.combo = 0;
    }

    for (const panel of this.panels) {
      if (panel.state !== "active") continue;
      const layout = panel["_layout"];
      const panelId = panel.id as PanelId;

      let panelInput: Input = this.input;
      if (this.mode === "host") {
        const mpInput = this.mpInputs.get(panelId);
        if (mpInput) {
          const remoteInput = this.mpManager?.getRemoteInput(
            this.panelOwners.get(panelId) || "",
            panelId
          );
          if (remoteInput) {
            mpInput.setRemoteInput(
              remoteInput.mouseX + layout.x,
              remoteInput.mouseY + layout.y + 30,
              remoteInput.clicked,
              remoteInput.keys
            );
          }
          panelInput = mpInput;
        }

        const bot = this.helperBots.get(panelId);
        if (bot) {
          bot.actionTimer -= dt;
          if (bot.actionTimer <= 0) {
            const pctx: PanelContext = {
              x: layout.x, y: layout.y, w: layout.w, h: layout.h,
              dt: 0, input: panelInput, audio: this.audio,
              difficulty: this.difficulty, time: this.gameTime, canvas: this.ctx,
            };
            const action = bot.think(pctx, panel);
            bot.lastAction = action;
            bot.actionTimer = bot.actionInterval;
            this.applyBotAction(panelId, action, layout);
          }
        }
      }

      const pctx: PanelContext = {
        x: layout.x,
        y: layout.y,
        w: layout.w,
        h: layout.h,
        dt,
        input: panelInput,
        audio: this.audio,
        difficulty: this.difficulty,
        time: this.gameTime,
        canvas: this.ctx,
      };
      const prevHealth = panel.health;
      panel.update(pctx);

      if (panel.health > prevHealth) {
        const healed = panel.health - prevHealth;
        this.score += Math.round(healed * 5 * (1 + this.combo * 0.1));
        this.combo++;
        this.comboTimer = 2;
      }

      if (panel.state === "crashed" && prevHealth > 0) {
        this.lives--;
        this.combo = 0;
        this.addFloatingText(layout.x + layout.w / 2, layout.y + layout.h / 2, "PANEL DOWN!", COLORS.danger, 1.5);
        this.audio.gameOver();
        if (this.lives <= 0) {
          this.state = "gameover";
          if (this.mode === "host" && this.mpManager) {
            this.mpManager.endMatch();
          }
        }
      }
    }

    this.score += Math.round(dt * 2 * this.alivePanels.length);

    for (const ft of this.floatingTexts) {
      ft.y += ft.vy * dt;
      ft.life -= dt;
    }
    this.floatingTexts = this.floatingTexts.filter((ft) => ft.life > 0);

    if (this.mode === "host" && this.mpManager) {
      this.stateSyncTimer += dt;
      if (this.stateSyncTimer >= this.stateSyncInterval) {
        this.stateSyncTimer = 0;
        this.broadcastState();
      }
    }
  }

  private applyBotAction(panelId: PanelId, action: BotAction, layout: { x: number; y: number; w: number; h: number }): void {
    const mpInput = this.mpInputs.get(panelId);
    if (!mpInput) return;

    switch (action.type) {
      case "click": {
        const globalX = layout.x + action.x;
        const globalY = layout.y + 30 + action.y;
        mpInput.setRemoteInput(globalX, globalY, true, []);
        break;
      }
      case "key": {
        mpInput.setRemoteInput(0, 0, false, [action.key]);
        break;
      }
      case "lane": {
        mpInput.setRemoteInput(0, 0, false, [String(action.lane + 1)]);
        break;
      }
      case "none":
        break;
    }
  }

  private broadcastState(): void {
    if (!this.mpManager) return;
    const gameState: SerializedGameState = {
      state: this.state as "menu" | "playing" | "gameover",
      score: this.score,
      wave: this.wave,
      waveTimer: this.waveTimer,
      waveDuration: this.waveDuration,
      lives: this.lives,
      difficulty: this.difficulty,
      combo: this.combo,
      comboTimer: this.comboTimer,
      gameTime: this.gameTime,
      floatingTexts: this.floatingTexts,
    };
    const panelStates: Record<PanelId, SerializedPanelState> = {} as Record<PanelId, SerializedPanelState>;
    for (const panel of this.panels) {
      panelStates[panel.id as PanelId] = panel.serialize();
    }
    this.mpManager.sendState(gameState, panelStates);
  }

  private updateClient(dt: number): void {
    if (this.mpManager) {
      for (const panelId of this.myPanels) {
        const panel = this.panelMap.get(panelId);
        if (!panel) continue;
        const layout = panel["_layout"];
        if (!layout) continue;

        const input: PanelInputState = {
          mouseX: this.input.mouseX - layout.x,
          mouseY: this.input.mouseY - layout.y - 30,
          clicked: this.input.consumeClick(),
          keys: this.getCurrentKeys(),
        };
        this.mpManager.sendInput(panelId, input);
      }
    }

    for (const ft of this.floatingTexts) {
      ft.y += ft.vy * dt;
      ft.life -= dt;
    }
    this.floatingTexts = this.floatingTexts.filter((ft) => ft.life > 0);
  }

  private getCurrentKeys(): string[] {
    const keys: string[] = [];
    for (let i = 0; i < 26; i++) {
      const k = String.fromCharCode(97 + i);
      if (this.input.isDown(k)) keys.push(k);
    }
    for (let i = 0; i < 10; i++) {
      const k = String(i);
      if (this.input.isDown(k)) keys.push(k);
    }
    return keys;
  }

  applyRemoteState(gameState: SerializedGameState, panelStates: Record<PanelId, SerializedPanelState>): void {
    if (this.mode !== "client") return;
    this.score = gameState.score;
    this.wave = gameState.wave;
    this.waveTimer = gameState.waveTimer;
    this.waveDuration = gameState.waveDuration;
    this.lives = gameState.lives;
    this.difficulty = gameState.difficulty;
    this.combo = gameState.combo;
    this.comboTimer = gameState.comboTimer;
    this.gameTime = gameState.gameTime;
    this.floatingTexts = gameState.floatingTexts || [];

    if (gameState.state === "gameover" && this.state !== "gameover") {
      this.state = "gameover";
    }

    for (const panelId of ALL_PANELS) {
      const panel = this.panelMap.get(panelId);
      const state = panelStates[panelId];
      if (panel && state) {
        panel.deserialize(state);
      }
    }

    if (this.panels.length > 0) {
      this.layoutPanels();
    }
  }

  private updateDisconnectedMessages(dt: number): void {
    for (const dp of this.disconnectedPlayers) {
      dp.timer -= dt;
    }
    this.disconnectedPlayers = this.disconnectedPlayers.filter((dp) => dp.timer > 0);
  }

  render(): void {
    const ctx = this.ctx;
    const vw = this.viewW;
    const vh = this.viewH;

    const grad = ctx.createLinearGradient(0, 0, 0, vh);
    grad.addColorStop(0, COLORS.bgGrad1);
    grad.addColorStop(1, COLORS.bgGrad2);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, vw, vh);

    for (const s of this.stars) {
      ctx.fillStyle = `rgba(34, 211, 238, ${s.z * 0.4})`;
      ctx.fillRect(s.x, s.y, s.size, s.size);
    }

    if (this.state === "menu") {
      if (this.mode === "solo") {
        this.renderMenu();
      } else {
        const menuMode = this.mpUI.getMenuState().mode;
        if (menuMode === "solo") {
          this.renderMenu();
        } else if (menuMode === "howto") {
          this.renderHowTo();
        } else if (menuMode === "multiplayer-menu") {
          this.mpUI.renderMultiplayerMenu();
        } else if (menuMode === "lobby-host") {
          this.mpUI.renderHostSetup();
        } else if (menuMode === "lobby-join") {
          this.mpUI.renderJoinSetup();
        } else if (menuMode === "lobby") {
          this.mpUI.renderLobby();
        } else if (menuMode === "assignments") {
          this.mpUI.renderLobby();
          this.mpUI.renderAssignments();
        }
      }
    } else if (this.state === "howto") {
      this.renderHowTo();
    } else if (this.state === "gameover") {
      this.renderPanels();
      this.renderHUD();
      this.renderGameOver();
    } else {
      this.renderPanels();
      this.renderHUD();
      this.renderMultiplayerOverlay();
    }

    for (const ft of this.floatingTexts) {
      ctx.globalAlpha = clamp(ft.life, 0, 1);
      ctx.font = "900 28px Orbitron, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = ft.color;
      ctx.fillText(ft.text, ft.x, ft.y);
      ctx.globalAlpha = 1;
    }

    this.renderDisconnectedMessages();
  }

  private renderMenu(): void {
    const ctx = this.ctx;
    const vw = this.viewW;
    const vh = this.viewH;
    const cx = vw / 2;

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

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

    const btnW = 260;
    const btnH = 52;
    const labels = ["START GAME", "HOW TO PLAY", "MULTIPLAYER"];
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
      const panelId = panel.id as PanelId;

      let panelInput: Input = this.input;
      if (this.mode === "client") {
        const mpInput = this.mpInputs.get(panelId);
        if (mpInput) {
          panelInput = mpInput;
        }
      } else if (this.mode === "host") {
        const mpInput = this.mpInputs.get(panelId);
        if (mpInput) {
          panelInput = mpInput;
        }
      }

      const pctx: PanelContext = {
        x: layout.x,
        y: layout.y,
        w: layout.w,
        h: layout.h,
        dt: 0,
        input: panelInput,
        audio: this.audio,
        difficulty: this.difficulty,
        time: this.gameTime,
        canvas: this.ctx,
      };
      panel.draw(pctx);

      if (this.mode !== "solo" && this.panelOwners.size > 0) {
        this.drawPanelOwnerBadge(panelId, layout);
      }
    }
  }

  private drawPanelOwnerBadge(panelId: PanelId, layout: { x: number; y: number; w: number; h: number }): void {
    const ctx = this.ctx;
    const ownerId = this.panelOwners.get(panelId);
    if (!ownerId || !this.mpManager) return;

    const lobby = this.mpManager.getLobbyState();
    if (!lobby) return;
    const playerIdx = lobby.players.findIndex((p) => p.id === ownerId);
    if (playerIdx < 0) return;

    const color = getPlayerColor(playerIdx);
    const name = getPlayerName(playerIdx);
    const isMine = this.myPanels.has(panelId);

    const badgeW = 80;
    const badgeH = 16;
    const bx = layout.x + layout.w - badgeW - 10;
    const by = layout.y + 30 + 4;

    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.fillRect(bx, by, badgeW, badgeH);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.strokeRect(bx, by, badgeW, badgeH);

    ctx.font = "600 10px Rajdhani, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = color;
    ctx.fillText(isMine ? `${name} (YOU)` : name, bx + badgeW / 2, by + badgeH / 2);
  }

  private renderHUD(): void {
    const ctx = this.ctx;
    const vw = this.viewW;

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

    ctx.font = "700 12px Rajdhani, sans-serif";
    ctx.fillStyle = COLORS.gray;
    ctx.fillText("SCORE", 20, 18);
    ctx.font = "900 24px Orbitron, sans-serif";
    ctx.fillStyle = COLORS.primary;
    ctx.fillText(this.score.toString().padStart(6, "0"), 20, 40);

    ctx.font = "700 12px Rajdhani, sans-serif";
    ctx.fillStyle = COLORS.gray;
    ctx.fillText("WAVE", 160, 18);
    ctx.font = "900 24px Orbitron, sans-serif";
    ctx.fillStyle = COLORS.accent;
    ctx.fillText(this.wave.toString(), 160, 40);

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

    if (this.combo > 1) {
      ctx.font = "700 12px Rajdhani, sans-serif";
      ctx.fillStyle = COLORS.gray;
      ctx.fillText("COMBO", 460, 18);
      ctx.font = "900 24px Orbitron, sans-serif";
      ctx.fillStyle = COLORS.warning;
      ctx.fillText(`x${this.combo}`, 460, 40);
    }

    if (this.mode !== "solo" && this.mpManager) {
      this.renderMultiplayerHUD(vw);
    } else {
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
  }

  private renderMultiplayerHUD(vw: number): void {
    const ctx = this.ctx;
    if (!this.mpManager) return;
    const lobby = this.mpManager.getLobbyState();
    if (!lobby) return;

    const connectedPlayers = lobby.players.filter((p) => p.connected);
    let x = vw - 20;
    ctx.textAlign = "right";

    for (let i = connectedPlayers.length - 1; i >= 0; i--) {
      const player = connectedPlayers[i];
      const color = getPlayerColor(i);
      const panels = player.assignedPanels;

      const boxW = 90;
      const boxX = x - boxW;

      ctx.fillStyle = "rgba(15, 23, 42, 0.6)";
      ctx.fillRect(boxX, 8, boxW, 44);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.strokeRect(boxX, 8, boxW, 44);

      ctx.font = "600 10px Rajdhani, sans-serif";
      ctx.fillStyle = color;
      ctx.textAlign = "left";
      ctx.fillText(player.name, boxX + 6, 18);

      for (let j = 0; j < panels.length; j++) {
        const pid = panels[j];
        const panel = this.panelMap.get(pid);
        const dotX = boxX + 6 + j * 16;
        const dotY = 38;
        ctx.fillStyle = panel
          ? (panel.state === "active" ? COLORS.success : COLORS.danger)
          : COLORS.grayDim;
        ctx.beginPath();
        ctx.arc(dotX + 4, dotY, 5, 0, Math.PI * 2);
        ctx.fill();

        if (this.myPanels.has(pid)) {
          ctx.strokeStyle = color;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(dotX + 4, dotY, 8, 0, Math.PI * 2);
          ctx.stroke();
        }
      }

      if (player.isModerator) {
        ctx.font = "600 8px Rajdhani, sans-serif";
        ctx.fillStyle = COLORS.accent;
        ctx.textAlign = "right";
        ctx.fillText("MOD", boxX + boxW - 4, 48);
      }

      x = boxX - 6;
    }
  }

  private renderMultiplayerOverlay(): void {
    if (this.mode === "solo") return;
    const ctx = this.ctx;
    const vw = this.viewW;

    if (this.mode === "client") {
      ctx.font = "500 11px Rajdhani, sans-serif";
      ctx.fillStyle = COLORS.gray;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillText("Connected to host — controlling your assigned panel(s)", vw / 2, 65);
    }

    if (this.moderatorControls) {
      ctx.font = "600 11px Rajdhani, sans-serif";
      ctx.fillStyle = COLORS.accent;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillText("MODERATOR — you can see all panel status and help coordinate", vw / 2, 65);
    }
  }

  private renderDisconnectedMessages(): void {
    if (this.disconnectedPlayers.length === 0) return;
    const ctx = this.ctx;
    const vw = this.viewW;
    const vh = this.viewH;

    let y = vh / 2 - 40;
    for (const dp of this.disconnectedPlayers) {
      ctx.fillStyle = "rgba(244, 63, 94, 0.15)";
      ctx.fillRect(vw / 2 - 200, y, 400, 36);
      ctx.strokeStyle = COLORS.danger;
      ctx.lineWidth = 1;
      ctx.strokeRect(vw / 2 - 200, y, 400, 36);

      ctx.font = "700 16px Rajdhani, sans-serif";
      ctx.fillStyle = COLORS.danger;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(`${dp.name} DISCONNECTED`, vw / 2, y + 18);
      y += 44;
    }
  }

  private renderGameOver(): void {
    const ctx = this.ctx;
    const vw = this.viewW;
    const vh = this.viewH;
    const cx = vw / 2;

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
          if (i === 0) {
            if (this.mode === "host" && this.mpManager) {
              this.startMultiplayerGame();
            } else if (this.mode === "client") {
              this.state = "menu";
              this.mpUI.setMenuMode("lobby");
            } else {
              this.startGame();
            }
          } else {
            if (this.mode !== "solo" && this.mpManager) {
              this.mpManager.leave();
              this.mpManager = null;
              this.mode = "solo";
            }
            this.state = "menu";
          }
        }
      }
    }

    if (this.input.isAnyDown("enter", " ")) {
      this.audio.click();
      if (this.mode === "solo") this.startGame();
    }
    if (this.input.isAnyDown("escape")) {
      this.audio.click();
      if (this.mode !== "solo" && this.mpManager) {
        this.mpManager.leave();
        this.mpManager = null;
        this.mode = "solo";
      }
      this.state = "menu";
    }
  }

  private addFloatingText(x: number, y: number, text: string, color: string, life: number): void {
    this.floatingTexts.push({ x, y, text, color, life, vy: -40 });
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

  async hostMultiplayer(playerCount: PlayerCount): Promise<void> {
    const playerId = `p-${Math.random().toString(36).slice(2, 9)}`;
    const playerName = getPlayerName(0);
    const roomCode = MultiplayerManager.generateRoomCode();

    const net = new NetworkManager(playerId, playerName);
    await net.hostRoom(roomCode);

    this.mpManager = new MultiplayerManager(net, true);
    this.mpManager.setPlayerCount(playerCount);
    this.mpManager.onLobbyUpdate((state) => {
      this.mpUI.updateLobby(state);
      if (state.state === "playing" && this.state !== "playing") {
        this.mode = "host";
        this.startMultiplayerGame();
      } else if (state.state === "gameover" && this.state !== "gameover") {
        this.state = "gameover";
      }
    });
    this.mpManager.onGameStateUpdate((gs, panels) => {
      this.applyRemoteState(gs, panels);
    });
    this.mpManager.onDisconnect((pid, pname) => {
      this.disconnectedPlayers.push({ id: pid, name: pname, timer: 5 });
    });

    this.mpUI.setManager(this.mpManager);
    this.mpUI.onCreateLobby = undefined;
    this.mpUI.onJoinLobby = undefined;
    this.mpUI.onLeave = () => {
      this.mpManager?.leave();
      this.mpManager = null;
      this.mode = "solo";
      this.mpUI.setMenuMode("solo");
      this.mpUI.setManager(null);
    };

    this.mode = "host";
    this.mpUI.setMenuMode("lobby");
  }

  async joinMultiplayer(roomCode: string): Promise<void> {
    const playerId = `p-${Math.random().toString(36).slice(2, 9)}`;
    const playerName = getPlayerName(0);

    const net = new NetworkManager(playerId, playerName);
    await net.joinRoom(roomCode);

    this.mpManager = new MultiplayerManager(net, false);
    this.mpManager.onLobbyUpdate((state) => {
      this.mpUI.updateLobby(state);
      if (state.state === "playing" && this.state !== "playing") {
        this.mode = "client";
        this.startMultiplayerGame();
      } else if (state.state === "gameover" && this.state !== "gameover") {
        this.state = "gameover";
      }
    });
    this.mpManager.onGameStateUpdate((gs, panels) => {
      this.applyRemoteState(gs, panels);
    });
    this.mpManager.onDisconnect((pid, pname) => {
      this.disconnectedPlayers.push({ id: pid, name: pname, timer: 5 });
    });

    this.mpUI.setManager(this.mpManager);
    this.mpUI.onLeave = () => {
      this.mpManager?.leave();
      this.mpManager = null;
      this.mode = "solo";
      this.mpUI.setMenuMode("solo");
      this.mpUI.setManager(null);
    };

    this.mode = "client";
    this.mpUI.setMenuMode("lobby");
  }
}
