import { EventEmitter } from "node:events";
import pg from "pg";
import { chatDatabaseService } from "./chat.service";

export interface ReminderCdcEvent {
  action: "INSERT" | "UPDATE" | "DELETE";
  id: number;
  telegramUserId: number;
  chatId: number;
  isCompleted?: boolean;
  dueAt?: string | Date;
  prompt?: string;
  source?: "database_trigger" | "pulse_stream" | "manual_dispatch";
}

export interface UserCdcEvent {
  action: "INSERT" | "UPDATE" | "DELETE";
  id?: number;
  telegramUserId: number;
  personality?: string;
  mode?: string;
  source?: "database_trigger" | "pulse_stream" | "manual_dispatch";
}

/**
 * Service providing Real-Time Database Change Data Capture (CDC) and live event distribution.
 * Compatible with Prisma Pulse and PostgreSQL LISTEN/NOTIFY streams.
 *
 * Use Cases:
 * 1. External dashboards or background workers update/complete reminders -> bot scheduler cancels/adjusts instantly.
 * 2. External admin updates user personality/mode -> bot L1 cache is invalidated across all worker instances.
 */
export class ChangeDataCaptureService extends EventEmitter {
  private listenerClient: pg.Client | null = null;
  private isListening = false;
  private reconnectTimer?: NodeJS.Timeout;
  private connectionString?: string;

  constructor() {
    super();
    this.setMaxListeners(50);
  }

  /**
   * Initializes the real-time CDC listener using PostgreSQL LISTEN/NOTIFY or Pulse stream.
   */
  async start(connectionString?: string): Promise<void> {
    this.connectionString =
      connectionString || process.env.DATABASE_URL || process.env.PRISMA_ACCELERATE_URL;

    if (!this.connectionString) {
      console.warn("[CDC] No DATABASE_URL provided for real-time change data capture.");
      return;
    }

    if (this.isListening) return;

    try {
      this.listenerClient = new pg.Client({
        connectionString: this.connectionString,
      });

      await this.listenerClient.connect();
      this.isListening = true;

      // Listen to CDC channels
      await this.listenerClient.query("LISTEN reminders_cdc");
      await this.listenerClient.query("LISTEN users_cdc");

      this.listenerClient.on("notification", (msg) => {
        try {
          if (!msg.payload) return;
          const payload = JSON.parse(msg.payload);

          if (msg.channel === "reminders_cdc") {
            const event: ReminderCdcEvent = {
              action: payload.action,
              id: Number(payload.id),
              telegramUserId: Number(payload.telegramUserId),
              chatId: Number(payload.chatId),
              isCompleted: payload.isCompleted,
              dueAt: payload.dueAt ? new Date(payload.dueAt) : undefined,
              prompt: payload.prompt,
              source: "database_trigger",
            };

            this.emit("reminder:change", event);
            if (event.action === "INSERT") this.emit("reminder:created", event);
            if (event.action === "UPDATE") {
              if (event.isCompleted) {
                this.emit("reminder:completed", event);
              } else {
                this.emit("reminder:updated", event);
              }
            }
            if (event.action === "DELETE") this.emit("reminder:cancelled", event);
          } else if (msg.channel === "users_cdc") {
            const event: UserCdcEvent = {
              action: payload.action,
              id: payload.id ? Number(payload.id) : undefined,
              telegramUserId: Number(payload.telegramUserId),
              personality: payload.personality,
              mode: payload.mode,
              source: "database_trigger",
            };

            // Invalidate local L1 cache automatically
            chatDatabaseService.invalidateUserCache(event.telegramUserId);
            this.emit("user:change", event);
            this.emit("user:updated", event);
          }
        } catch (err) {
          console.error("[CDC] Error parsing incoming CDC notification payload:", err);
        }
      });

      this.listenerClient.on("error", (err) => {
        console.error("[CDC] Real-time listener connection error:", err);
        this.reconnect();
      });

      this.listenerClient.on("end", () => {
        if (this.isListening) {
          this.reconnect();
        }
      });
    } catch (err) {
      console.warn("[CDC] Could not establish dedicated LISTEN connection (will retry or use event fallback):", err);
      this.reconnect();
    }
  }

  private reconnect(): void {
    this.isListening = false;
    if (this.listenerClient) {
      try {
        this.listenerClient.end().catch(() => {});
      } catch {}
      this.listenerClient = null;
    }

    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      void this.start(this.connectionString);
    }, 10_000);
  }

  /**
   * Gracefully shuts down the CDC connection.
   */
  async stop(): Promise<void> {
    this.isListening = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    if (this.listenerClient) {
      await this.listenerClient.end().catch(() => {});
      this.listenerClient = null;
    }
  }

  /**
   * Dispatches a manual or simulated CDC event across all subscribers.
   */
  dispatchReminderEvent(event: ReminderCdcEvent): void {
    this.emit("reminder:change", event);
    if (event.action === "INSERT") this.emit("reminder:created", event);
    if (event.action === "UPDATE") {
      if (event.isCompleted) {
        this.emit("reminder:completed", event);
      } else {
        this.emit("reminder:updated", event);
      }
    }
    if (event.action === "DELETE") this.emit("reminder:cancelled", event);
  }

  /**
   * Dispatches a manual or simulated user CDC event across all subscribers.
   */
  dispatchUserEvent(event: UserCdcEvent): void {
    chatDatabaseService.invalidateUserCache(event.telegramUserId);
    this.emit("user:change", event);
    this.emit("user:updated", event);
  }
}

export const cdcService = new ChangeDataCaptureService();
