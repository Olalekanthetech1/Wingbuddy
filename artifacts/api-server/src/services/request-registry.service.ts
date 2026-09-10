import { createHash } from "node:crypto";
import { logger } from "../lib/logger";
import type { SemanticInteractionDecision } from "./semantic-interaction-cache.service";

export type RequestKind = "conversational" | "one_shot" | "durable" | "clarification" | "unknown";
export type RequestStatus = "received" | "classified" | "executing" | "completed" | "failed" | "waiting_for_user";

export interface RegisteredRequest {
  requestId: string;
  telegramUserId: number;
  chatId: number;
  messageId?: number;
  receivedAt: string;
  kind: RequestKind;
  status: RequestStatus;
  intent?: string;
  complexity?: SemanticInteractionDecision["complexity"];
  confidence?: number;
  taskRequired: boolean;
  toolRequired: boolean;
  mediaRequired: boolean;
  activeTaskContinuation: boolean;
  taskId?: number;
  graphId?: string;
  completedAt?: string;
  metadata?: Record<string, unknown>;
}

class RequestRegistryService {
  private readonly requests = new Map<string, RegisteredRequest>();
  private readonly maxEntries = 2000;

  register(input: {
    telegramUserId: number;
    chatId: number;
    messageId?: number;
    semantic?: SemanticInteractionDecision | null;
    mediaPresent?: boolean;
  }): RegisteredRequest {
    const requestId = this.makeRequestId(input.telegramUserId, input.chatId, input.messageId, Date.now());
    const semantic = input.semantic;
    const mediaPresent = Boolean(input.mediaPresent);
    const taskIntent = semantic?.taskIntent ?? "NO_TASK";
    const isTaskContinuation = taskIntent === "CONTINUE_TASK" || taskIntent === "PAUSE_TASK" || taskIntent === "COMPLETE_TASK" || taskIntent === "CANCEL_TASK" || taskIntent === "VIEW_TASKS";
    const isDurableTask = taskIntent === "NEW_TASK" || isTaskContinuation;
    const kind: RequestKind =
      semantic?.isGreeting || semantic?.intent === "greeting"
        ? "conversational"
        : isDurableTask
          ? "durable"
          : semantic?.intent === "image_generation" || semantic?.intent === "video_generation" || semantic?.intent === "search_grounding" || semantic?.intent === "deep_reasoning"
            ? "one_shot"
            : "unknown";

    const request: RegisteredRequest = {
      requestId,
      telegramUserId: input.telegramUserId,
      chatId: input.chatId,
      messageId: input.messageId,
      receivedAt: new Date().toISOString(),
      kind,
      status: "received",
      intent: semantic?.intent,
      complexity: semantic?.complexity,
      confidence: semantic?.confidence,
      taskRequired: isDurableTask,
      toolRequired: Boolean(semantic && (semantic.intent === "image_generation" || semantic.intent === "video_generation" || semantic.enableSearch || semantic.intent === "deep_reasoning")),
      mediaRequired: semantic?.intent === "image_generation" || semantic?.intent === "video_generation" || mediaPresent,
      activeTaskContinuation: isTaskContinuation,
    };

    this.requests.set(requestId, request);
    this.trim();
    logger.info({ requestId, telegramUserId: request.telegramUserId, chatId: request.chatId, messageId: request.messageId, kind: request.kind, intent: request.intent, complexity: request.complexity, confidence: request.confidence, taskRequired: request.taskRequired, toolRequired: request.toolRequired, mediaRequired: request.mediaRequired, activeTaskContinuation: request.activeTaskContinuation }, "TELEGRAM_REQUEST_REGISTERED");
    return request;
  }

  markClassified(requestId: string, patch: Partial<Pick<RegisteredRequest, "kind" | "intent" | "complexity" | "confidence" | "taskRequired" | "toolRequired" | "mediaRequired" | "activeTaskContinuation">>): RegisteredRequest | undefined {
    return this.update(requestId, { ...patch, status: "classified" });
  }

  markExecuting(requestId: string, patch: Partial<Pick<RegisteredRequest, "taskId" | "graphId">> = {}): RegisteredRequest | undefined {
    return this.update(requestId, { ...patch, status: "executing" });
  }

  markCompleted(requestId: string, metadata?: Record<string, unknown>): RegisteredRequest | undefined {
    return this.update(requestId, { status: "completed", completedAt: new Date().toISOString(), metadata: { ...(this.requests.get(requestId)?.metadata || {}), ...(metadata || {}) } });
  }

  markFailed(requestId: string, metadata?: Record<string, unknown>): RegisteredRequest | undefined {
    return this.update(requestId, { status: "failed", completedAt: new Date().toISOString(), metadata: { ...(this.requests.get(requestId)?.metadata || {}), ...(metadata || {}) } });
  }

  get(requestId: string): RegisteredRequest | undefined {
    return this.requests.get(requestId);
  }

  private update(requestId: string, patch: Partial<RegisteredRequest>): RegisteredRequest | undefined {
    const current = this.requests.get(requestId);
    if (!current) return undefined;
    const next = { ...current, ...patch };
    this.requests.set(requestId, next);
    return next;
  }

  private makeRequestId(telegramUserId: number, chatId: number, messageId: number | undefined, timestamp: number): string {
    const source = `${telegramUserId}:${chatId}:${messageId ?? "none"}:${timestamp}:${Math.random()}`;
    return `req_${createHash("sha256").update(source).digest("hex").slice(0, 20)}`;
  }

  private trim(): void {
    while (this.requests.size > this.maxEntries) {
      const firstKey = this.requests.keys().next().value as string | undefined;
      if (!firstKey) break;
      this.requests.delete(firstKey);
    }
  }
}

export const requestRegistryService = new RequestRegistryService();
