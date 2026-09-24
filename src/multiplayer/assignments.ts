import { PanelId, PlayerCount } from "./types";

export const ALL_PANELS: PanelId[] = ["firewall", "router", "decoder", "intrusion"];

export const PANEL_NAMES: Record<PanelId, string> = {
  firewall: "FIREWALL",
  router: "PACKET ROUTER",
  decoder: "DECRYPTOR",
  intrusion: "INTRUSION GRID",
};

export const PANEL_ICONS: Record<PanelId, string> = {
  firewall: "🛡",
  router: "📡",
  decoder: "🔑",
  intrusion: "🏰",
};

const PLAYER_COLORS = ["#22d3ee", "#34d399", "#f59e0b", "#f43f5e"];

export function getPlayerColor(index: number): string {
  return PLAYER_COLORS[index % PLAYER_COLORS.length];
}

export function getPlayerName(index: number): string {
  return `PLAYER ${index + 1}`;
}

function shuffle<T>(arr: T[]): T[] {
  const result = [...arr];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export interface AssignmentResult {
  assignments: Record<PanelId, string | null>;
  playerPanels: Record<string, PanelId[]>;
}

export function assignPanels(
  playerIds: string[],
  playerCount: PlayerCount
): AssignmentResult {
  const shuffledPanels = shuffle(ALL_PANELS);
  const assignments: Record<PanelId, string | null> = {} as Record<PanelId, string | null>;
  const playerPanels: Record<string, PanelId[]> = {};

  for (const pid of playerIds) {
    playerPanels[pid] = [];
  }

  if (playerCount === 4) {
    for (let i = 0; i < 4; i++) {
      const panel = shuffledPanels[i];
      const playerId = playerIds[i];
      assignments[panel] = playerId;
      playerPanels[playerId].push(panel);
    }
  } else if (playerCount === 3) {
    for (let i = 0; i < 3; i++) {
      const panel = shuffledPanels[i];
      const playerId = playerIds[i];
      assignments[panel] = playerId;
      playerPanels[playerId].push(panel);
    }
    const fourthPanel = shuffledPanels[3];
    const moderatorId = playerIds[3];
    assignments[fourthPanel] = moderatorId;
    playerPanels[moderatorId].push(fourthPanel);
  } else if (playerCount === 2) {
    for (let i = 0; i < 4; i++) {
      const panel = shuffledPanels[i];
      const playerId = playerIds[i % 2];
      assignments[panel] = playerId;
      playerPanels[playerId].push(panel);
    }
  }

  return { assignments, playerPanels };
}

export function generateRoomCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 4; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}
