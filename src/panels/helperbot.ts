import { GamePanel, PanelContext } from "./base";
import { PanelId } from "../multiplayer/types";

export type BotAction = {
  type: "click";
  x: number;
  y: number;
} | {
  type: "key";
  key: string;
} | {
  type: "lane";
  lane: number;
} | {
  type: "none";
};

export interface HelperBot {
  panelId: PanelId;
  actionInterval: number;
  actionTimer: number;
  lastAction: BotAction;
  think(ctx: PanelContext, panel: GamePanel): BotAction;
}

export class FirewallHelperBot implements HelperBot {
  panelId: PanelId = "firewall";
  actionInterval = 0.8;
  actionTimer = 0;
  lastAction: BotAction = { type: "none" };

  think(ctx: PanelContext, panel: GamePanel): BotAction {
    if (panel.state !== "active") return { type: "none" };
    const threats = (panel as unknown as { threats: { x: number; y: number; hit: boolean; size: number }[] }).threats;
    if (!threats || threats.length === 0) return { type: "none" };

    const active = threats.filter((t) => !t.hit);
    if (active.length === 0) return { type: "none" };

    const target = active.reduce((closest, t) => (t.y > closest.y ? t : closest), active[0]);
    return { type: "click", x: target.x, y: target.y };
  }
}

export class RouterHelperBot implements HelperBot {
  panelId: PanelId = "router";
  actionInterval = 1.2;
  actionTimer = 0;
  lastAction: BotAction = { type: "none" };

  think(ctx: PanelContext, panel: GamePanel): BotAction {
    if (panel.state !== "active") return { type: "none" };
    const packets = (panel as unknown as { packets: { targetLane: number; y: number; counted: boolean }[]; selectedLane: number }).packets;
    if (!packets || packets.length === 0) return { type: "none" };

    const active = packets.filter((p) => !p.counted);
    if (active.length === 0) return { type: "none" };

    const target = active.reduce((closest, p) => (p.y > closest.y ? p : closest), active[0]);
    return { type: "lane", lane: target.targetLane };
  }
}

export class DecoderHelperBot implements HelperBot {
  panelId: PanelId = "decoder";
  actionInterval = 1.5;
  actionTimer = 0;
  lastAction: BotAction = { type: "none" };

  think(ctx: PanelContext, panel: GamePanel): BotAction {
    if (panel.state !== "active") return { type: "none" };
    const jobs = (panel as unknown as { jobs: { sequence: string; typed: number; expired: boolean; y: number }[] }).jobs;
    if (!jobs || jobs.length === 0) return { type: "none" };

    const active = jobs.filter((j) => !j.expired);
    if (active.length === 0) return { type: "none" };

    const target = active.reduce((closest, j) => (j.y > closest.y ? j : closest), active[0]);
    if (target.typed >= target.sequence.length) return { type: "none" };
    return { type: "key", key: target.sequence[target.typed].toLowerCase() };
  }
}

export class IntrusionHelperBot implements HelperBot {
  panelId: PanelId = "intrusion";
  actionInterval = 2.0;
  actionTimer = 0;
  lastAction: BotAction = { type: "none" };
  private placedCount = 0;
  private maxTowers = 3;

  think(ctx: PanelContext, panel: GamePanel): BotAction {
    if (panel.state !== "active") return { type: "none" };
    const towers = (panel as unknown as { towers: { gx: number; gy: number }[] }).towers;
    if (!towers) return { type: "none" };

    if (towers.length >= this.maxTowers) return { type: "none" };

    const cellW = (panel as unknown as { cellW: number }).cellW || 1;
    const cellH = (panel as unknown as { cellH: number }).cellH || 1;

    const gx = 2 + Math.floor(Math.random() * 4);
    const gy = Math.floor(Math.random() * 5);
    const exists = towers.some((t) => t.gx === gx && t.gy === gy);
    if (exists) return { type: "none" };

    return { type: "click", x: gx * cellW + cellW / 2, y: gy * cellH + cellH / 2 };
  }
}

export function createHelperBot(panelId: PanelId): HelperBot {
  switch (panelId) {
    case "firewall": return new FirewallHelperBot();
    case "router": return new RouterHelperBot();
    case "decoder": return new DecoderHelperBot();
    case "intrusion": return new IntrusionHelperBot();
  }
}
