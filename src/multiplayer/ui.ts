import { COLORS, roundRect } from "../utils";
import { MultiplayerManager } from "./manager";
import { PlayerCount, PanelId, LobbyStateData } from "./types";
import { PANEL_NAMES, PANEL_ICONS, getPlayerColor, getPlayerName } from "./assignments";

export type MenuMode = "solo" | "multiplayer-menu" | "lobby-host" | "lobby-join" | "lobby" | "assignments" | "howto";

export interface MenuState {
  mode: MenuMode;
  selectedPlayerCount: PlayerCount;
  roomCodeInput: string;
  errorMessage: string;
  lobby: LobbyStateData | null;
  hoveredButton: number;
  countdown: number;
}

export function createInitialMenuState(): MenuState {
  return {
    mode: "solo",
    selectedPlayerCount: 4,
    roomCodeInput: "",
    errorMessage: "",
    lobby: null,
    hoveredButton: -1,
    countdown: 0,
  };
}

interface MenuButton {
  label: string;
  y: number;
  action: () => void;
}

export class MultiplayerUI {
  private ctx: CanvasRenderingContext2D;
  private menuState: MenuState;
  private mpManager: MultiplayerManager | null;
  private mouseX: number;
  private mouseY: number;
  private clicked: boolean;

  constructor(ctx: CanvasRenderingContext2D) {
    this.ctx = ctx;
    this.menuState = createInitialMenuState();
    this.mpManager = null;
    this.mouseX = 0;
    this.mouseY = 0;
    this.clicked = false;
  }

  setManager(mgr: MultiplayerManager | null): void {
    this.mpManager = mgr;
  }

  getMenuState(): MenuState {
    return this.menuState;
  }

  setMenuMode(mode: MenuMode): void {
    this.menuState.mode = mode;
  }

  setMouse(x: number, y: number, clicked: boolean): void {
    this.mouseX = x;
    this.mouseY = y;
    this.clicked = clicked;
  }

  resetClick(): void {
    this.clicked = false;
  }

  updateLobby(state: LobbyStateData): void {
    this.menuState.lobby = state;
    if (state.state === "assignments" && this.menuState.mode === "lobby") {
      this.menuState.mode = "assignments";
      this.menuState.countdown = 5;
    }
  }

  update(dt: number): void {
    if (this.menuState.mode === "assignments" && this.menuState.countdown > 0) {
      this.menuState.countdown -= dt;
      if (this.menuState.countdown <= 0 && this.mpManager?.isHostRole()) {
        this.mpManager.beginPlaying();
      }
    }
  }

  private drawButton(
    cx: number,
    y: number,
    w: number,
    h: number,
    label: string,
    hovered: boolean,
    color?: string
  ): boolean {
    const ctx = this.ctx;
    const bx = cx - w / 2;

    ctx.fillStyle = hovered
      ? `rgba(34, 211, 238, 0.15)`
      : "rgba(15, 23, 42, 0.8)";
    roundRect(ctx, bx, y, w, h, 8);
    ctx.fill();
    ctx.strokeStyle = hovered ? (color || COLORS.primary) : COLORS.primaryDim;
    ctx.lineWidth = hovered ? 2 : 1;
    ctx.stroke();

    ctx.font = "700 20px Orbitron, sans-serif";
    ctx.fillStyle = hovered ? (color || COLORS.primary) : COLORS.white;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, cx, y + h / 2);

    return this.clicked &&
      this.mouseX >= bx && this.mouseX <= bx + w &&
      this.mouseY >= y && this.mouseY <= y + h;
  }

  private drawSmallButton(
    cx: number,
    y: number,
    w: number,
    h: number,
    label: string,
    hovered: boolean,
    color?: string
  ): boolean {
    const ctx = this.ctx;
    const bx = cx - w / 2;

    ctx.fillStyle = hovered
      ? `rgba(34, 211, 238, 0.15)`
      : "rgba(15, 23, 42, 0.8)";
    roundRect(ctx, bx, y, w, h, 6);
    ctx.fill();
    ctx.strokeStyle = hovered ? (color || COLORS.primary) : COLORS.primaryDim;
    ctx.lineWidth = hovered ? 2 : 1;
    ctx.stroke();

    ctx.font = "600 16px Rajdhani, sans-serif";
    ctx.fillStyle = hovered ? (color || COLORS.primary) : COLORS.white;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, cx, y + h / 2);

    return this.clicked &&
      this.mouseX >= bx && this.mouseX <= bx + w &&
      this.mouseY >= y && this.mouseY <= y + h;
  }

  renderMain(): void {
    const ctx = this.ctx;
    const vw = (ctx.canvas.width / (window.devicePixelRatio || 1));
    const vh = (ctx.canvas.height / (window.devicePixelRatio || 1));
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
    const baseY = vh / 2 + 30;
    const buttons: MenuButton[] = [
      { label: "SOLO", y: baseY, action: () => { this.menuState.mode = "solo"; } },
      { label: "MULTIPLAYER", y: baseY + btnH + 12, action: () => { this.menuState.mode = "multiplayer-menu"; } },
      { label: "HOW TO PLAY", y: baseY + (btnH + 12) * 2, action: () => { this.menuState.mode = "howto"; } },
    ];

    for (let i = 0; i < buttons.length; i++) {
      const hovered = this.isHovering(cx - btnW / 2, buttons[i].y, btnW, btnH);
      if (this.drawButton(cx, buttons[i].y, btnW, btnH, buttons[i].label, hovered)) {
        buttons[i].action();
      }
    }

    ctx.font = "500 13px Rajdhani, sans-serif";
    ctx.fillStyle = COLORS.gray;
    ctx.fillText("Click SOLO to play alone, or MULTIPLAYER to host/join a co-op game", cx, vh - 40);
  }

  renderMultiplayerMenu(): void {
    const ctx = this.ctx;
    const vw = (ctx.canvas.width / (window.devicePixelRatio || 1));
    const vh = (ctx.canvas.height / (window.devicePixelRatio || 1));
    const cx = vw / 2;

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    ctx.font = "900 36px Orbitron, sans-serif";
    ctx.fillStyle = COLORS.primary;
    ctx.fillText("MULTIPLAYER", cx, 100);

    ctx.font = "500 16px Rajdhani, sans-serif";
    ctx.fillStyle = COLORS.gray;
    ctx.fillText("Choose how to play with friends", cx, 130);

    const btnW = 260;
    const btnH = 52;
    const baseY = vh / 2 - 40;

    const buttons: MenuButton[] = [
      { label: "HOST GAME", y: baseY, action: () => { this.menuState.mode = "lobby-host"; } },
      { label: "JOIN GAME", y: baseY + btnH + 12, action: () => { this.menuState.mode = "lobby-join"; } },
      { label: "BACK", y: baseY + (btnH + 12) * 2, action: () => { this.menuState.mode = "solo"; } },
    ];

    for (let i = 0; i < buttons.length; i++) {
      const hovered = this.isHovering(cx - btnW / 2, buttons[i].y, btnW, btnH);
      if (this.drawButton(cx, buttons[i].y, btnW, btnH, buttons[i].label, hovered, i === 2 ? COLORS.gray : undefined)) {
        buttons[i].action();
      }
    }
  }

  renderHostSetup(): void {
    const ctx = this.ctx;
    const vw = (ctx.canvas.width / (window.devicePixelRatio || 1));
    const vh = (ctx.canvas.height / (window.devicePixelRatio || 1));
    const cx = vw / 2;

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    ctx.font = "900 36px Orbitron, sans-serif";
    ctx.fillStyle = COLORS.primary;
    ctx.fillText("HOST GAME", cx, 80);

    ctx.font = "600 18px Rajdhani, sans-serif";
    ctx.fillStyle = COLORS.white;
    ctx.fillText("Select number of players:", cx, 140);

    const counts: PlayerCount[] = [2, 3, 4];
    const btnW = 80;
    const btnH = 80;
    const gap = 20;
    const totalW = counts.length * btnW + (counts.length - 1) * gap;
    const startX = cx - totalW / 2;

    for (let i = 0; i < counts.length; i++) {
      const bx = startX + i * (btnW + gap);
      const by = 170;
      const count = counts[i];
      const selected = this.menuState.selectedPlayerCount === count;
      const hovered = this.isHovering(bx, by, btnW, btnH);

      ctx.fillStyle = selected
        ? "rgba(34, 211, 238, 0.2)"
        : hovered
          ? "rgba(34, 211, 238, 0.1)"
          : "rgba(15, 23, 42, 0.8)";
      roundRect(ctx, bx, by, btnW, btnH, 10);
      ctx.fill();
      ctx.strokeStyle = selected ? COLORS.primary : COLORS.primaryDim;
      ctx.lineWidth = selected ? 3 : 1;
      ctx.stroke();

      ctx.font = "900 36px Orbitron, sans-serif";
      ctx.fillStyle = selected ? COLORS.primary : COLORS.white;
      ctx.fillText(`${count}`, bx + btnW / 2, by + btnH / 2 - 8);
      ctx.font = "500 11px Rajdhani, sans-serif";
      ctx.fillStyle = COLORS.gray;
      ctx.fillText("PLAYERS", bx + btnW / 2, by + btnH / 2 + 18);

      if (this.clicked && this.mouseX >= bx && this.mouseX <= bx + btnW && this.mouseY >= by && this.mouseY <= by + btnH) {
        this.menuState.selectedPlayerCount = count;
      }
    }

    ctx.font = "500 14px Rajdhani, sans-serif";
    ctx.fillStyle = COLORS.gray;
    const desc = this.menuState.selectedPlayerCount === 2
      ? "2 players — each controls 2 panels + helper bot"
      : this.menuState.selectedPlayerCount === 3
        ? "3 players — each controls 1 panel, player 4 is moderator"
        : "4 players — each controls 1 panel";
    ctx.fillText(desc, cx, 280);

    const startBtnW = 260;
    const startBtnH = 52;
    const startBy = 330;
    const startHovered = this.isHovering(cx - startBtnW / 2, startBy, startBtnW, startBtnH);
    if (this.drawButton(cx, startBy, startBtnW, startBtnH, "CREATE LOBBY", startHovered)) {
      this.onCreateLobby?.(this.menuState.selectedPlayerCount);
    }

    const backBy = startBy + startBtnH + 12;
    if (this.drawButton(cx, backBy, startBtnW, startBtnH, "BACK", this.isHovering(cx - startBtnW / 2, backBy, startBtnW, startBtnH), COLORS.gray)) {
      this.menuState.mode = "multiplayer-menu";
    }
  }

  renderJoinSetup(): void {
    const ctx = this.ctx;
    const vw = (ctx.canvas.width / (window.devicePixelRatio || 1));
    const vh = (ctx.canvas.height / (window.devicePixelRatio || 1));
    const cx = vw / 2;

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    ctx.font = "900 36px Orbitron, sans-serif";
    ctx.fillStyle = COLORS.primary;
    ctx.fillText("JOIN GAME", cx, 100);

    ctx.font = "600 18px Rajdhani, sans-serif";
    ctx.fillStyle = COLORS.white;
    ctx.fillText("Enter room code:", cx, 160);

    const inputW = 200;
    const inputH = 60;
    const inputX = cx - inputW / 2;
    const inputY = 190;

    ctx.fillStyle = "rgba(15, 23, 42, 0.9)";
    roundRect(ctx, inputX, inputY, inputW, inputH, 8);
    ctx.fill();
    ctx.strokeStyle = COLORS.primaryDim;
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.font = "900 32px Orbitron, sans-serif";
    ctx.fillStyle = COLORS.primary;
    ctx.textAlign = "center";
    ctx.fillText(this.menuState.roomCodeInput || "____", cx, inputY + inputH / 2);

    ctx.font = "500 12px Rajdhani, sans-serif";
    ctx.fillStyle = COLORS.gray;
    ctx.fillText("Type 4 characters on your keyboard", cx, inputY + inputH + 20);

    if (this.menuState.errorMessage) {
      ctx.font = "600 14px Rajdhani, sans-serif";
      ctx.fillStyle = COLORS.danger;
      ctx.fillText(this.menuState.errorMessage, cx, inputY + inputH + 45);
    }

    const joinBy = inputY + inputH + 80;
    if (this.drawButton(cx, joinBy, 260, 52, "JOIN", this.isHovering(cx - 130, joinBy, 260, 52))) {
      if (this.menuState.roomCodeInput.length === 4) {
        this.onJoinLobby?.(this.menuState.roomCodeInput.toUpperCase());
      } else {
        this.menuState.errorMessage = "Room code must be 4 characters";
      }
    }

    const backBy = joinBy + 64;
    if (this.drawButton(cx, backBy, 260, 52, "BACK", this.isHovering(cx - 130, backBy, 260, 52), COLORS.gray)) {
      this.menuState.mode = "multiplayer-menu";
      this.menuState.roomCodeInput = "";
      this.menuState.errorMessage = "";
    }
  }

  renderLobby(): void {
    const ctx = this.ctx;
    const vw = (ctx.canvas.width / (window.devicePixelRatio || 1));
    const vh = (ctx.canvas.height / (window.devicePixelRatio || 1));
    const cx = vw / 2;
    const lobby = this.menuState.lobby;

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    ctx.font = "900 36px Orbitron, sans-serif";
    ctx.fillStyle = COLORS.primary;
    ctx.fillText("GAME LOBBY", cx, 60);

    if (lobby) {
      ctx.font = "700 24px Orbitron, sans-serif";
      ctx.fillStyle = COLORS.accent;
      ctx.fillText(`Room: ${lobby.roomCode}`, cx, 100);

      ctx.font = "500 14px Rajdhani, sans-serif";
      ctx.fillStyle = COLORS.gray;
      ctx.fillText(`${lobby.playerCount}-Player Co-op`, cx, 125);
    }

    if (!lobby) {
      ctx.font = "500 16px Rajdhani, sans-serif";
      ctx.fillStyle = COLORS.gray;
      ctx.fillText("Waiting for lobby state...", cx, vh / 2);
      return;
    }

    const playerListY = 160;
    const playerRowH = 60;
    const playerRowW = 400;
    const playerRowX = cx - playerRowW / 2;

    ctx.font = "600 14px Rajdhani, sans-serif";
    ctx.fillStyle = COLORS.gray;
    ctx.textAlign = "left";
    ctx.fillText("PLAYERS", playerRowX, playerListY - 15);

    const connectedPlayers = lobby.players.filter((p) => p.connected);

    for (let i = 0; i < lobby.playerCount; i++) {
      const y = playerListY + i * playerRowH;
      const player = connectedPlayers[i];

      ctx.fillStyle = player
        ? "rgba(15, 23, 42, 0.8)"
        : "rgba(15, 23, 42, 0.3)";
      roundRect(ctx, playerRowX, y, playerRowW, playerRowH - 8, 8);
      ctx.fill();
      ctx.strokeStyle = player
        ? (player.ready ? COLORS.success : COLORS.primaryDim)
        : COLORS.grayDim;
      ctx.lineWidth = 1;
      ctx.stroke();

      if (player) {
        const color = getPlayerColor(i);
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(playerRowX + 20, y + (playerRowH - 8) / 2, 8, 0, Math.PI * 2);
        ctx.fill();

        ctx.font = "700 18px Rajdhani, sans-serif";
        ctx.fillStyle = COLORS.white;
        ctx.textAlign = "left";
        ctx.fillText(player.name, playerRowX + 38, y + (playerRowH - 8) / 2 - 6);

        ctx.font = "500 12px Rajdhani, sans-serif";
        ctx.fillStyle = player.ready ? COLORS.success : COLORS.gray;
        ctx.fillText(player.ready ? "READY" : "NOT READY", playerRowX + 38, y + (playerRowH - 8) / 2 + 10);

        if (player.isHost) {
          ctx.font = "600 11px Rajdhani, sans-serif";
          ctx.fillStyle = COLORS.accent;
          ctx.textAlign = "right";
          ctx.fillText("HOST", playerRowX + playerRowW - 12, y + (playerRowH - 8) / 2);
        }
      } else {
        ctx.font = "500 16px Rajdhani, sans-serif";
        ctx.fillStyle = COLORS.grayDim;
        ctx.textAlign = "center";
        ctx.fillText("Waiting for player...", playerRowX + playerRowW / 2, y + (playerRowH - 8) / 2);
      }
    }

    const readyBy = playerListY + lobby.playerCount * playerRowH + 20;
    const myInfo = lobby.players.find((p) => p.id === this.mpManager?.["net"]?.id);
    const isReady = myInfo?.ready || false;

    const allReady = connectedPlayers.length === lobby.playerCount && connectedPlayers.every((p) => p.ready);
    const isHost = this.mpManager?.isHostRole() || false;

    if (allReady && isHost) {
      if (this.drawButton(cx, readyBy, 260, 52, "START MATCH", this.isHovering(cx - 130, readyBy, 260, 52), COLORS.success)) {
        this.mpManager?.startMatch();
      }
    } else {
      const readyLabel = isReady ? "NOT READY" : "READY UP";
      const readyColor = isReady ? COLORS.warning : COLORS.success;
      if (this.drawButton(cx, readyBy, 260, 52, readyLabel, this.isHovering(cx - 130, readyBy, 260, 52), readyColor)) {
        this.mpManager?.setReady(!isReady);
      }
    }

    const leaveBy = readyBy + 64;
    if (this.drawButton(cx, leaveBy, 260, 44, "LEAVE", this.isHovering(cx - 130, leaveBy, 260, 44), COLORS.danger)) {
      this.onLeave?.();
    }

    ctx.font = "500 13px Rajdhani, sans-serif";
    ctx.fillStyle = COLORS.gray;
    ctx.textAlign = "center";
    ctx.fillText(`Connected: ${connectedPlayers.length}/${lobby.playerCount}`, cx, vh - 30);
  }

  renderAssignments(): void {
    const ctx = this.ctx;
    const vw = (ctx.canvas.width / (window.devicePixelRatio || 1));
    const vh = (ctx.canvas.height / (window.devicePixelRatio || 1));
    const cx = vw / 2;
    const lobby = this.menuState.lobby;

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    ctx.font = "900 36px Orbitron, sans-serif";
    ctx.fillStyle = COLORS.primary;
    ctx.fillText("PANEL ASSIGNMENTS", cx, 60);

    if (!lobby) return;

    const connectedPlayers = lobby.players.filter((p) => p.connected);
    const startY = 130;
    const rowH = 90;
    const rowW = 450;
    const rowX = cx - rowW / 2;

    for (let i = 0; i < connectedPlayers.length; i++) {
      const player = connectedPlayers[i];
      const y = startY + i * rowH;
      const color = getPlayerColor(i);

      ctx.fillStyle = "rgba(15, 23, 42, 0.85)";
      roundRect(ctx, rowX, y, rowW, rowH - 10, 10);
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(rowX + 25, y + (rowH - 10) / 2, 10, 0, Math.PI * 2);
      ctx.fill();

      ctx.font = "700 20px Rajdhani, sans-serif";
      ctx.fillStyle = color;
      ctx.textAlign = "left";
      ctx.fillText(player.name, rowX + 45, y + 22);

      if (player.isModerator) {
        ctx.font = "600 11px Rajdhani, sans-serif";
        ctx.fillStyle = COLORS.accent;
        ctx.fillText("MODERATOR", rowX + 45, y + 42);
      }

      const panels = player.assignedPanels;
      let panelX = rowX + 45;
      for (let j = 0; j < panels.length; j++) {
        const pid = panels[j];
        ctx.font = "600 16px Rajdhani, sans-serif";
        ctx.fillStyle = COLORS.white;
        ctx.textAlign = "left";
        ctx.fillText(`${PANEL_ICONS[pid]} ${PANEL_NAMES[pid]}`, panelX, y + 62);
        panelX += 200;
      }
    }

    if (this.menuState.countdown > 0) {
      ctx.font = "900 48px Orbitron, sans-serif";
      ctx.fillStyle = COLORS.accent;
      ctx.textAlign = "center";
      ctx.shadowColor = COLORS.accent;
      ctx.shadowBlur = 15;
      ctx.fillText(Math.ceil(this.menuState.countdown).toString(), cx, vh - 60);
      ctx.shadowBlur = 0;
    }
  }

  private isHovering(x: number, y: number, w: number, h: number): boolean {
    return this.mouseX >= x && this.mouseX <= x + w &&
      this.mouseY >= y && this.mouseY <= y + h;
  }

  handleKeyInput(key: string): void {
    if (this.menuState.mode === "lobby-join") {
      if (key === "backspace") {
        this.menuState.roomCodeInput = this.menuState.roomCodeInput.slice(0, -1);
      } else if (key === "escape") {
        this.menuState.mode = "multiplayer-menu";
        this.menuState.roomCodeInput = "";
        this.menuState.errorMessage = "";
      } else if (this.menuState.roomCodeInput.length < 4) {
        const upper = key.toUpperCase();
        if (/^[A-Z0-9]$/.test(upper)) {
          this.menuState.roomCodeInput += upper;
          this.menuState.errorMessage = "";
        }
      }
    }

    if (key === "escape") {
      if (this.menuState.mode === "multiplayer-menu" || this.menuState.mode === "lobby-host" || this.menuState.mode === "lobby-join") {
        this.menuState.mode = "solo";
      }
    }
  }

  onCreateLobby?: (playerCount: PlayerCount) => void;
  onJoinLobby?: (roomCode: string) => void;
  onLeave?: () => void;
}
