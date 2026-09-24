export type GameMode = "solo" | "multiplayer";
export type PlayerCount = 2 | 3 | 4;
export type PanelId = "firewall" | "router" | "decoder" | "intrusion";

export type LobbyState = "lobby" | "assignments" | "playing" | "gameover";

export interface PlayerInfo {
  id: string;
  name: string;
  ready: boolean;
  connected: boolean;
  isHost: boolean;
  isModerator: boolean;
  assignedPanels: PanelId[];
}

export interface LobbyStateData {
  roomCode: string;
  hostId: string;
  playerCount: PlayerCount;
  players: PlayerInfo[];
  state: LobbyState;
  assignments: Record<PanelId, string | null>;
}

export interface PanelInputState {
  mouseX: number;
  mouseY: number;
  clicked: boolean;
  keys: string[];
}

export type InputUpdate = {
  type: "input";
  playerId: string;
  panelId: PanelId;
  input: PanelInputState;
};

export type LobbyUpdate = {
  type: "lobby";
  state: LobbyStateData;
};

export type StateSync = {
  type: "state";
  gameState: SerializedGameState;
  panelStates: Record<PanelId, SerializedPanelState>;
  timestamp: number;
};

export type DisconnectMsg = {
  type: "disconnect";
  playerId: string;
};

export type ReconnectMsg = {
  type: "reconnect";
  playerId: string;
};

export type GameMessage = InputUpdate | LobbyUpdate | StateSync | DisconnectMsg | ReconnectMsg;

export interface SerializedPanelState {
  id: PanelId;
  state: "active" | "crashed";
  health: number;
  maxHealth: number;
  data: Record<string, unknown>;
}

export interface SerializedGameState {
  state: "menu" | "playing" | "gameover";
  score: number;
  wave: number;
  waveTimer: number;
  waveDuration: number;
  lives: number;
  difficulty: number;
  combo: number;
  comboTimer: number;
  gameTime: number;
  floatingTexts: { x: number; y: number; text: string; color: string; life: number; vy: number }[];
}
