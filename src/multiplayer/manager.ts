import { NetworkManager } from "./network";
import {
  GameMessage,
  LobbyStateData,
  PlayerInfo,
  PlayerCount,
  PanelId,
  SerializedGameState,
  SerializedPanelState,
  PanelInputState,
} from "./types";
import {
  assignPanels,
  generateRoomCode,
  ALL_PANELS,
  PANEL_NAMES,
  PANEL_ICONS,
  getPlayerName,
  getPlayerColor,
  AssignmentResult,
} from "./assignments";

type LobbyCallback = (state: LobbyStateData) => void;
type GameStateCallback = (state: SerializedGameState, panels: Record<PanelId, SerializedPanelState>) => void;
type DisconnectCallback = (playerId: string, playerName: string) => void;

export class MultiplayerManager {
  private net: NetworkManager;
  private lobbyState: LobbyStateData | null = null;
  private isHost: boolean;
  private lobbyCallback: LobbyCallback | null = null;
  private gameStateCallback: GameStateCallback | null = null;
  private disconnectCallback: DisconnectCallback | null = null;
  private myPanelIds: PanelId[] = [];
  private playerNames: Map<string, string> = new Map();

  constructor(net: NetworkManager, isHost: boolean) {
    this.net = net;
    this.isHost = isHost;

    this.net.onMessage((msg) => this.handleMessage(msg));
    this.net.onPresence((peers) => this.handlePresence(peers));
  }

  onLobbyUpdate(cb: LobbyCallback): void {
    this.lobbyCallback = cb;
  }

  onGameStateUpdate(cb: GameStateCallback): void {
    this.gameStateCallback = cb;
  }

  onDisconnect(cb: DisconnectCallback): void {
    this.disconnectCallback = cb;
  }

  private handleMessage(msg: GameMessage): void {
    switch (msg.type) {
      case "lobby":
        if (!this.isHost) {
          this.lobbyState = msg.state;
          this.myPanelIds = msg.state.assignments
            ? Object.entries(msg.state.assignments)
                .filter(([, pid]) => pid === this.net.id)
                .map(([panelId]) => panelId as PanelId)
            : [];
          if (this.lobbyCallback) this.lobbyCallback(msg.state);
        }
        break;

      case "state":
        if (!this.isHost) {
          if (this.gameStateCallback) {
            this.gameStateCallback(msg.gameState, msg.panelStates);
          }
        }
        break;

      case "input":
        if (this.isHost && this.lobbyState?.state === "playing") {
          this.handleRemoteInput(msg);
        }
        break;

      case "disconnect":
        if (this.disconnectCallback) {
          const name = this.playerNames.get(msg.playerId) || getPlayerName(0);
          this.disconnectCallback(msg.playerId, name);
        }
        if (this.isHost && this.lobbyState) {
          const player = this.lobbyState.players.find((p) => p.id === msg.playerId);
          if (player) {
            player.connected = false;
            this.broadcastLobby();
          }
        }
        break;

      case "reconnect":
        if (this.isHost && this.lobbyState) {
          const player = this.lobbyState.players.find((p) => p.id === msg.playerId);
          if (player) {
            player.connected = true;
            this.broadcastLobby();
          }
        }
        break;
    }
  }

  private remoteInputs: Map<string, PanelInputState> = new Map();

  private handleRemoteInput(msg: { playerId: string; panelId: PanelId; input: PanelInputState }): void {
    const key = `${msg.playerId}:${msg.panelId}`;
    this.remoteInputs.set(key, msg.input);
  }

  getRemoteInput(playerId: string, panelId: PanelId): PanelInputState | null {
    const key = `${playerId}:${panelId}`;
    const input = this.remoteInputs.get(key);
    if (input) {
      this.remoteInputs.delete(key);
      return input;
    }
    return null;
  }

  private handlePresence(peers: Record<string, { id: string; name: string; ready: boolean }>): void {
    if (!this.isHost) return;
    if (!this.lobbyState) {
      this.lobbyState = {
        roomCode: this.net.getRoomCode() || "",
        hostId: this.net.id,
        playerCount: 4,
        players: [],
        state: "lobby",
        assignments: {} as Record<PanelId, string | null>,
      };
    }

    const peerList = Object.values(peers);
    const newPlayers: PlayerInfo[] = [];

    for (const peer of peerList) {
      this.playerNames.set(peer.id, peer.name);
      let existing = this.lobbyState.players.find((p) => p.id === peer.id);
      if (!existing) {
        existing = {
          id: peer.id,
          name: peer.name,
          ready: peer.ready,
          connected: true,
          isHost: peer.id === this.net.id,
          isModerator: false,
          assignedPanels: [],
        };
        this.lobbyState.players.push(existing);
        newPlayers.push(existing);
      } else {
        existing.ready = peer.ready;
        existing.connected = true;
      }
    }

    for (const player of this.lobbyState.players) {
      if (!peers[player.id]) {
        player.connected = false;
      }
    }

    this.lobbyState.players.sort((a, b) => (a.isHost ? -1 : 1) - (b.isHost ? -1 : 1));

    this.broadcastLobby();
  }

  private broadcastLobby(): void {
    if (!this.lobbyState) return;
    this.net.send({ type: "lobby", state: this.lobbyState });
    if (this.lobbyCallback) this.lobbyCallback(this.lobbyState);
  }

  setPlayerCount(count: PlayerCount): void {
    if (!this.isHost || !this.lobbyState) return;
    this.lobbyState.playerCount = count;
    this.broadcastLobby();
  }

  setReady(ready: boolean): void {
    this.net.updatePresence({ ready });
    if (this.isHost && this.lobbyState) {
      const me = this.lobbyState.players.find((p) => p.id === this.net.id);
      if (me) {
        me.ready = ready;
        this.broadcastLobby();
      }
    }
  }

  startMatch(): void {
    if (!this.isHost || !this.lobbyState) return;
    const connectedPlayers = this.lobbyState.players.filter((p) => p.connected);
    if (connectedPlayers.length < 2) return;

    const playerIds = connectedPlayers.slice(0, this.lobbyState.playerCount).map((p) => p.id);
    const result = assignPanels(playerIds, this.lobbyState.playerCount);

    this.lobbyState.assignments = result.assignments;
    for (const player of this.lobbyState.players) {
      player.assignedPanels = result.playerPanels[player.id] || [];
      player.isModerator =
        this.lobbyState.playerCount === 3 && player.id === playerIds[3];
    }
    this.lobbyState.state = "assignments";
    this.broadcastLobby();
  }

  beginPlaying(): void {
    if (!this.isHost || !this.lobbyState) return;
    this.lobbyState.state = "playing";
    this.broadcastLobby();
  }

  endMatch(): void {
    if (!this.isHost || !this.lobbyState) return;
    this.lobbyState.state = "gameover";
    this.broadcastLobby();
  }

  sendState(gameState: SerializedGameState, panelStates: Record<PanelId, SerializedPanelState>): void {
    if (!this.isHost) return;
    this.net.send({ type: "state", gameState, panelStates, timestamp: Date.now() });
  }

  sendInput(panelId: PanelId, input: PanelInputState): void {
    if (this.isHost) return;
    this.net.send({ type: "input", playerId: this.net.id, panelId, input });
  }

  sendDisconnect(): void {
    this.net.send({ type: "disconnect", playerId: this.net.id });
  }

  sendReconnect(): void {
    this.net.send({ type: "reconnect", playerId: this.net.id });
  }

  getLobbyState(): LobbyStateData | null {
    return this.lobbyState;
  }

  getMyPanelIds(): PanelId[] {
    if (this.isHost && this.lobbyState) {
      const me = this.lobbyState.players.find((p) => p.id === this.net.id);
      return me?.assignedPanels || [];
    }
    return this.myPanelIds;
  }

  getMyPlayerInfo(): PlayerInfo | null {
    if (!this.lobbyState) return null;
    return this.lobbyState.players.find((p) => p.id === this.net.id) || null;
  }

  isHostRole(): boolean {
    return this.isHost;
  }

  isModerator(): boolean {
    const me = this.getMyPlayerInfo();
    return me?.isModerator || false;
  }

  getPlayerColor(playerId: string): string {
    if (!this.lobbyState) return getPlayerColor(0);
    const idx = this.lobbyState.players.findIndex((p) => p.id === playerId);
    return getPlayerColor(idx >= 0 ? idx : 0);
  }

  getPlayerName(playerId: string): string {
    return this.playerNames.get(playerId) || getPlayerName(0);
  }

  leave(): void {
    this.sendDisconnect();
    this.net.leave();
    this.lobbyState = null;
  }

  static getPanelName(panelId: PanelId): string {
    return PANEL_NAMES[panelId];
  }

  static getPanelIcon(panelId: PanelId): string {
    return PANEL_ICONS[panelId];
  }

  static getAllPanels(): PanelId[] {
    return ALL_PANELS;
  }

  static generateRoomCode(): string {
    return generateRoomCode();
  }
}
