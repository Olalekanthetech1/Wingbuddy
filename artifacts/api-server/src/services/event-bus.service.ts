import { EventEmitter } from "node:events";
import type { Response } from "express";
import { logger } from "../lib/logger";

export interface SyncEventPayload {
  type: "chat_chunk" | "chat_message" | "task_update" | "reminder_alert" | "telegram_paired" | "system_status" | "media_job_update";
  userId?: number;
  telegramUserId?: number | string;
  data: any;
  timestamp: string;
}

class EventBusService extends EventEmitter {
  private activeConnections: Map<string, Set<Response>> = new Map();

  constructor() {
    super();
    this.setMaxListeners(200);
  }

  private getUserKey(userId?: number, telegramUserId?: number | string): string[] {
    const keys: string[] = [];
    if (userId) keys.push(`user:${userId}`);
    if (telegramUserId) keys.push(`tg:${telegramUserId}`);
    return keys;
  }

  public registerClient(userKey: string, res: Response): () => void {
    if (!this.activeConnections.has(userKey)) {
      this.activeConnections.set(userKey, new Set());
    }
    const clientSet = this.activeConnections.get(userKey)!;
    clientSet.add(res);

    // Send keepalive / welcome event
    res.write(`event: connected\ndata: ${JSON.stringify({ status: "connected", timestamp: new Date().toISOString() })}\n\n`);

    const cleanup = () => {
      clientSet.delete(res);
      if (clientSet.size === 0) {
        this.activeConnections.delete(userKey);
      }
    };

    res.on("close", cleanup);
    res.on("finish", cleanup);
    return cleanup;
  }

  public emitUserEvent(payload: Omit<SyncEventPayload, "timestamp">): void {
    const fullPayload: SyncEventPayload = {
      ...payload,
      timestamp: new Date().toISOString(),
    };

    const keys = this.getUserKey(payload.userId, payload.telegramUserId);
    const eventString = `event: ${fullPayload.type}\ndata: ${JSON.stringify(fullPayload)}\n\n`;

    const notifiedClients = new Set<Response>();
    for (const key of keys) {
      const clients = this.activeConnections.get(key);
      if (clients) {
        for (const client of clients) {
          if (!notifiedClients.has(client) && !client.writableEnded) {
            try {
              client.write(eventString);
              notifiedClients.add(client);
            } catch (err) {
              logger.warn({ error: err }, "Failed to write SSE event to client");
            }
          }
        }
      }
    }

    // Also emit internally
    this.emit("user_event", fullPayload);
  }

  public publish(event: { type: string; payload?: any; userId?: number; telegramUserId?: number | string; [key: string]: any }): void {
    if (event.type) {
      this.emit(event.type, event.payload ?? event);
    }
    const tgId = event.payload?.telegramUserId ?? event.telegramUserId;
    const uId = event.payload?.webUserId ?? event.userId;
    this.emitUserEvent({
      type: "system_status",
      userId: uId,
      telegramUserId: tgId,
      data: event,
    });
  }

  public emitBroadcast(type: string, data: any): void {
    const eventString = `event: ${type}\ndata: ${JSON.stringify({ type, data, timestamp: new Date().toISOString() })}\n\n`;
    for (const clients of this.activeConnections.values()) {
      for (const client of clients) {
        if (!client.writableEnded) {
          try {
            client.write(eventString);
          } catch {}
        }
      }
    }
  }
}

export const eventBusService = new EventBusService();
