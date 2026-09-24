import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { GameMessage, LobbyStateData } from "./types";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || "";
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || "";

let client: SupabaseClient | null = null;

function getClient(): SupabaseClient {
  if (!client) {
    client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      realtime: { params: { eventsPerSecond: 30 } },
    });
  }
  return client;
}

type MessageHandler = (msg: GameMessage) => void;
type PresenceHandler = (peers: Record<string, { id: string; name: string; ready: boolean }>) => void;

export class NetworkManager {
  private channel: ReturnType<SupabaseClient["channel"]> | null = null;
  private roomCode: string | null = null;
  private playerId: string;
  private playerName: string;
  private msgHandler: MessageHandler | null = null;
  private presenceHandler: PresenceHandler | null = null;
  private connected = false;

  constructor(playerId: string, playerName: string) {
    this.playerId = playerId;
    this.playerName = playerName;
  }

  get id(): string {
    return this.playerId;
  }

  isConnected(): boolean {
    return this.connected;
  }

  onMessage(handler: MessageHandler): void {
    this.msgHandler = handler;
  }

  onPresence(handler: PresenceHandler): void {
    this.presenceHandler = handler;
  }

  async hostRoom(roomCode: string): Promise<void> {
    this.roomCode = roomCode;
    const sb = getClient();
    const channelName = `room-${roomCode}`;

    this.channel = sb.channel(channelName, {
      config: { presence: { key: this.playerId } },
    });

    this.channel
      .on("broadcast", { event: "game" }, (payload) => {
        if (this.msgHandler && payload.payload) {
          this.msgHandler(payload.payload as GameMessage);
        }
      })
      .on("presence", { event: "sync" }, () => {
        if (this.presenceHandler && this.channel) {
          const state = this.channel.presenceState();
          const peers: Record<string, { id: string; name: string; ready: boolean }> = {};
          for (const [key, meta] of Object.entries(state)) {
            const m = meta[0] as { id: string; name: string; ready: boolean };
            peers[key] = m;
          }
          this.presenceHandler(peers);
        }
      })
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          this.connected = true;
          await this.channel!.track({
            id: this.playerId,
            name: this.playerName,
            ready: false,
          });
        }
      });
  }

  async joinRoom(roomCode: string): Promise<void> {
    this.roomCode = roomCode;
    const sb = getClient();
    const channelName = `room-${roomCode}`;

    this.channel = sb.channel(channelName, {
      config: { presence: { key: this.playerId } },
    });

    this.channel
      .on("broadcast", { event: "game" }, (payload) => {
        if (this.msgHandler && payload.payload) {
          this.msgHandler(payload.payload as GameMessage);
        }
      })
      .on("presence", { event: "sync" }, () => {
        if (this.presenceHandler && this.channel) {
          const state = this.channel.presenceState();
          const peers: Record<string, { id: string; name: string; ready: boolean }> = {};
          for (const [key, meta] of Object.entries(state)) {
            const m = meta[0] as { id: string; name: string; ready: boolean };
            peers[key] = m;
          }
          this.presenceHandler(peers);
        }
      })
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          this.connected = true;
          await this.channel!.track({
            id: this.playerId,
            name: this.playerName,
            ready: false,
          });
        }
      });
  }

  send(msg: GameMessage): void {
    if (this.channel && this.connected) {
      this.channel.send({ type: "broadcast", event: "game", payload: msg });
    }
  }

  updatePresence(data: { ready: boolean }): void {
    if (this.channel && this.connected) {
      this.channel.track({
        id: this.playerId,
        name: this.playerName,
        ...data,
      });
    }
  }

  leave(): void {
    if (this.channel) {
      this.channel.unsubscribe();
      this.channel = null;
    }
    this.connected = false;
    this.roomCode = null;
  }

  getRoomCode(): string | null {
    return this.roomCode;
  }
}
