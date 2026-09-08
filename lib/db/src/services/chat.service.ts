import { getPrisma, getPool, getDb, isPgVectorAvailable } from "../client";
import { agentTasksTable, agentTaskStepsTable, conversationSummariesTable, userMemoriesTable } from "../schema";
import { eq, and, desc, inArray } from "drizzle-orm";

export interface SaveMessageOptions {
  conversationId: number;
  role: "user" | "model" | "assistant" | "system";
  content: string;
  tokenCount?: number;
}

export interface FetchRecentMessagesOptions {
  conversationId: number;
  limit?: number;
}

export interface CreateSessionOptions {
  telegramUserId: number | bigint;
  chatId: number | bigint;
  title?: string;
  archiveExisting?: boolean;
}

export interface GetOrCreateSessionOptions {
  telegramUserId: number | bigint;
  chatId: number | bigint;
  title?: string;
}

export interface SaveMemoryOptions {
  telegramUserId: number | bigint;
  key: string;
  content: string;
  category?: "preference" | "fact" | "context" | "instruction" | "general" | string;
  type?: "user_preference" | "user_fact" | "workflow_preference" | "project_context" | "learning_context" | "interaction_preference" | "important_context" | string;
  structuredValue?: string;
  confidence?: "low" | "medium" | "high";
  importance?: "low" | "medium" | "high";
  status?: "active" | "archived" | "deleted";
  embedding?: number[];
  embeddingJson?: string;
  sourceSessionId?: number;
  sourceMessageId?: number;
  sourceConversationId?: number;
  expiresAt?: Date;
}

export interface ChatMessageRecord {
  id: number;
  conversationId: number;
  role: string;
  content: string;
  tokenCount: number | null;
  createdAt: Date;
}

export interface ChatSessionRecord {
  id: number;
  telegramUserId: number;
  chatId: number;
  title: string | null;
  summary: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface UserMemoryRecord {
  id: number;
  telegramUserId: number;
  key: string;
  content: string;
  category: string;
  type: string;
  structuredValue?: string | null;
  confidence: "low" | "medium" | "high" | string;
  importance: "low" | "medium" | "high" | string;
  status: "active" | "archived" | "deleted" | string;
  embeddingJson?: string | null;
  similarity?: number;
  sourceSessionId: number | null;
  sourceMessageId?: number | null;
  sourceConversationId?: number | null;
  expiresAt?: Date | null;
  lastAccessedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AgentTaskRecord {
  id: number;
  telegramUserId: number;
  conversationId: number | null;
  title: string;
  goal: string;
  taskType: string;
  status: "pending" | "active" | "paused" | "waiting" | "completed" | "failed" | "cancelled" | string;
  currentStep: number;
  contextJson?: string | null;
  metadataJson?: string | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date | null;
}

export interface AgentTaskStepRecord {
  id: number;
  taskId: number;
  stepOrder: number;
  title: string;
  description: string | null;
  status: "pending" | "running" | "completed" | "failed" | "skipped" | string;
  resultSummary: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ConversationSummaryRecord {
  id: number;
  telegramUserId: number;
  conversationId: number;
  summary: string;
  keyTakeawaysJson: string | null;
  artifactRefsJson: string | null;
  messageCountSummarized: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface ReminderRecord {
  id: number;
  telegramUserId: number;
  chatId: number;
  prompt: string;
  dueAt: Date;
  isCompleted: boolean;
  snoozeCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface UserFullContextRecord {
  id: number;
  telegramUserId: number;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
  personality: string;
  mode: string;
  createdAt: Date;
  updatedAt: Date;
  conversations: ChatSessionRecord[];
  memories: UserMemoryRecord[];
  reminders: ReminderRecord[];
}

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
  lastAccessedAt: number;
}

function computeCosineSimilarity(a: number[], b: number[]): number {
  if (!a || !b || a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const mag = Math.sqrt(normA) * Math.sqrt(normB);
  return mag === 0 ? 0 : dot / mag;
}

/**
 * Service providing PostgreSQL persistence for:
 * 1. Chat sessions & session lifecycle
 * 2. Message history & contextual dialog retrieval
 * 3. Long-term memory & episodic user knowledge with native pgvector & hybrid search
 * 4. High-concurrency self-tuning Adaptive L1 caching with dynamic TTL scaling
 */
export class ChatDatabaseService {
  private cache = new Map<string, CacheEntry<unknown>>();
  private userLastActive = new Map<string, number>();
  private userInvalidationHistory = new Map<string, number[]>();

  private get prisma() {
    return getPrisma();
  }

  /**
   * Dynamically computes the adaptive cache TTL for a specific key
   * purely based on user activity recency, write velocity, and container memory pressure.
   */
  public computeAdaptiveCacheTTL(key: string): number {
    const mem = process.memoryUsage();
    const memoryPressureRatio = mem.heapTotal > 0 ? mem.heapUsed / mem.heapTotal : 0.5;

    // Self-tuning baseline dynamically scaled from container memory health
    const baseTTL = memoryPressureRatio > 0.8 ? 15000 : 45000;

    // Extract user ID from cache key if available (e.g. "user:12345:...")
    const match = key.match(/^user:(\d+):/);
    if (match) {
      const uid = match[1];
      const now = Date.now();
      const lastActive = this.userLastActive.get(uid) || 0;
      const timeSinceActive = now - lastActive;

      // Check recent invalidations (writes in last 60 seconds)
      const invalidations = (this.userInvalidationHistory.get(uid) || []).filter(
        (t) => now - t < 60000,
      );
      this.userInvalidationHistory.set(uid, invalidations);

      // 1. If user is actively chatting (active in last 90s) with frequent updates, shorten TTL for immediate responsiveness
      if (timeSinceActive < 90000 || invalidations.length > 2) {
        return Math.max(5000, Math.floor(baseTTL * 0.3));
      }

      // 2. If user is idle (>10 minutes without writes), lengthen TTL to reduce DB roundtrips
      if (timeSinceActive > 600000 && invalidations.length === 0) {
        return Math.min(300000, Math.floor(baseTTL * 3));
      }
    }

    // Adaptive adjustment based on memory pressure
    if (memoryPressureRatio > 0.85) {
      return Math.max(5000, Math.floor(baseTTL * 0.5));
    }

    return baseTTL;
  }

  private getCached<T>(key: string): T | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return undefined;
    }
    entry.lastAccessedAt = Date.now();
    return entry.data as T;
  }

  private setCached<T>(key: string, data: T, customTtl?: number): void {
    const ttl = customTtl !== undefined ? customTtl : this.computeAdaptiveCacheTTL(key);

    // Memory-aware self-pruning: if cache exceeds dynamic size limit, prune expired or oldest LRU entries
    if (this.cache.size > 200) {
      this.pruneCache();
    }

    this.cache.set(key, {
      data,
      expiresAt: Date.now() + ttl,
      lastAccessedAt: Date.now(),
    });
  }

  private pruneCache(): void {
    const now = Date.now();
    for (const [k, v] of this.cache.entries()) {
      if (now > v.expiresAt) {
        this.cache.delete(k);
      }
    }

    // If still large, remove oldest 20% entries
    if (this.cache.size > 200) {
      const sorted = Array.from(this.cache.entries()).sort(
        (a, b) => a[1].lastAccessedAt - b[1].lastAccessedAt,
      );
      const toRemove = Math.floor(sorted.length * 0.2);
      for (let i = 0; i < toRemove; i++) {
        this.cache.delete(sorted[i][0]);
      }
    }
  }

  public invalidateUserCache(telegramUserId: number | bigint): void {
    const uid = String(telegramUserId);
    const now = Date.now();

    // Record invalidation velocity
    const history = this.userInvalidationHistory.get(uid) || [];
    history.push(now);
    this.userInvalidationHistory.set(uid, history.slice(-10));
    this.userLastActive.set(uid, now);

    for (const key of this.cache.keys()) {
      if (key.startsWith(`user:${uid}:`)) {
        this.cache.delete(key);
      }
    }
  }

  // ==========================================
  // SESSIONS & CONVERSATION LIFECYCLE
  // ==========================================

  /**
   * Creates a new chat session for a user and chat.
   * If archiveExisting is true (default: false), any existing active session is marked inactive.
   */
  async createSession(options: CreateSessionOptions): Promise<ChatSessionRecord> {
    const telegramUserId = BigInt(options.telegramUserId);
    const chatId = BigInt(options.chatId);

    // Ensure the user record exists
    await this.ensureUserExists(telegramUserId);

    if (options.archiveExisting) {
      await this.prisma.conversation.updateMany({
        where: { telegramUserId, chatId, isActive: true },
        data: { isActive: false, updatedAt: new Date() },
      });
    }

    const session = await this.prisma.conversation.create({
      data: {
        telegramUserId,
        chatId,
        title: options.title ?? null,
        isActive: true,
      },
    });

    return this.serializeSession(session);
  }

  /**
   * Retrieves the current active conversation session, or creates a new one if none exists.
   */
  async getOrCreateSession(options: GetOrCreateSessionOptions): Promise<ChatSessionRecord> {
    const telegramUserId = BigInt(options.telegramUserId);
    const chatId = BigInt(options.chatId);

    await this.ensureUserExists(telegramUserId);

    let session = await this.prisma.conversation.findFirst({
      where: {
        telegramUserId,
        chatId,
        isActive: true,
      },
      orderBy: { updatedAt: "desc" },
    });

    if (!session) {
      session = await this.prisma.conversation.create({
        data: {
          telegramUserId,
          chatId,
          title: options.title ?? null,
          isActive: true,
        },
      });
    }

    return this.serializeSession(session);
  }

  /**
   * Updates an existing session's metadata (e.g. title or episodic summary).
   */
  async updateSession(
    sessionId: number,
    data: { title?: string; summary?: string; isActive?: boolean },
  ): Promise<ChatSessionRecord> {
    const updated = await this.prisma.conversation.update({
      where: { id: sessionId },
      data: {
        ...data,
        updatedAt: new Date(),
      },
    });
    return this.serializeSession(updated);
  }

  /**
   * Closes an active chat session and optionally records a summary.
   */
  async endSession(sessionId: number, summary?: string): Promise<ChatSessionRecord> {
    return this.updateSession(sessionId, {
      isActive: false,
      ...(summary ? { summary } : {}),
    });
  }

  /**
   * Fetches recent conversation summaries for a user to provide episodic context.
   */
  async getRecentSessionSummaries(
    telegramUserId: number | bigint,
    limit = 3,
  ): Promise<Array<{ id: number; summary: string; updatedAt: Date }>> {
    const uid = BigInt(telegramUserId);
    const sessions = await this.prisma.conversation.findMany({
      where: {
        telegramUserId: uid,
        summary: { not: null },
      },
      orderBy: { updatedAt: "desc" },
      take: limit,
      select: {
        id: true,
        summary: true,
        updatedAt: true,
      },
    });

    return sessions
      .filter((s) => typeof s.summary === "string" && s.summary.trim().length > 0)
      .map((s) => ({
        id: s.id,
        summary: s.summary as string,
        updatedAt: s.updatedAt,
      }));
  }

  /**
   * Searches past dialogue messages across all conversations for a user.
   * Enables dense vector/hybrid RAG recall across long-term historical sessions.
   */
  async searchHistoricalDialogue(
    telegramUserId: number | bigint,
    query: string,
    excludeConversationId?: number,
    limit = 6,
  ): Promise<Array<{ role: string; content: string; createdAt: Date; conversationId: number }>> {
    const uid = BigInt(telegramUserId);
    const words = query
      .toLowerCase()
      .replace(/[^\w\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length >= 3);

    const conversations = await this.prisma.conversation.findMany({
      where: { telegramUserId: uid },
      select: { id: true },
    });
    const conversationIds = conversations
      .map((c) => c.id)
      .filter((id) => id !== excludeConversationId);

    if (conversationIds.length === 0) return [];

    const messages = await this.prisma.message.findMany({
      where: {
        conversationId: { in: conversationIds },
        ...(words.length > 0
          ? {
              OR: words.slice(0, 5).map((word) => ({
                content: { contains: word, mode: "insensitive" as const },
              })),
            }
          : {}),
      },
      orderBy: { createdAt: "desc" },
      take: limit * 2,
      select: {
        role: true,
        content: true,
        createdAt: true,
        conversationId: true,
      },
    });

    return messages.slice(0, limit);
  }

  // ==========================================
  // MESSAGE HISTORY & WORKING CONTEXT
  // ==========================================

  /**
   * Saves a user, model, or assistant message to the database and updates session activity.
   */
  async saveMessage(options: SaveMessageOptions): Promise<ChatMessageRecord> {
    const [savedMessage] = await this.prisma.$transaction([
      this.prisma.message.create({
        data: {
          conversationId: options.conversationId,
          role: options.role,
          content: options.content,
          tokenCount: options.tokenCount ?? null,
        },
      }),
      this.prisma.conversation.update({
        where: { id: options.conversationId },
        data: { updatedAt: new Date() },
      }),
    ]);

    return {
      id: savedMessage.id,
      conversationId: savedMessage.conversationId,
      role: savedMessage.role,
      content: savedMessage.content,
      tokenCount: savedMessage.tokenCount,
      createdAt: savedMessage.createdAt,
    };
  }

  /**
   * Fetches the most recent message history for a specific chat session,
   * sorted in chronological order (oldest to newest) suitable for LLM prompt context.
   */
  async fetchRecentMessages(
    options: FetchRecentMessagesOptions,
  ): Promise<ChatMessageRecord[]> {
    const limit = Math.max(1, Math.min(options.limit ?? 20, 100));

    const messages = await this.prisma.message.findMany({
      where: { conversationId: options.conversationId },
      orderBy: { createdAt: "desc" },
      take: limit,
    });

    // Reverse to chronological order (oldest -> newest) for model prompt context
    return messages.reverse().map((msg) => ({
      id: msg.id,
      conversationId: msg.conversationId,
      role: msg.role,
      content: msg.content,
      tokenCount: msg.tokenCount,
      createdAt: msg.createdAt,
    }));
  }

  /**
   * Clears all messages in a specific session.
   */
  async clearSessionMessages(conversationId: number): Promise<number> {
    const result = await this.prisma.message.deleteMany({
      where: { conversationId },
    });
    return result.count;
  }

  // ==========================================
  // LONG-TERM MEMORY (LTM)
  // ==========================================

  /**
   * Saves or updates a long-term memory fact, preference, or piece of knowledge for a user.
   * If the key already exists for this user, it updates the content and category.
   * Automatically stores dense vector embeddings and updates PostgreSQL pgvector vector(768) if enabled.
   */
  async saveMemory(options: SaveMemoryOptions): Promise<UserMemoryRecord> {
    const telegramUserId = BigInt(options.telegramUserId);
    const category = options.category ?? "general";
    const embeddingJson = Array.isArray(options.embedding) && options.embedding.length > 0
      ? JSON.stringify(options.embedding)
      : options.embeddingJson ?? null;

    await this.ensureUserExists(telegramUserId);

    const type = options.type ?? "user_fact";
    const confidence = options.confidence ?? "high";
    const importance = options.importance ?? "medium";
    const status = options.status ?? "active";
    const structuredValue = options.structuredValue ?? null;

    const memory = await this.prisma.userMemory.upsert({
      where: {
        telegramUserId_key: {
          telegramUserId,
          key: options.key,
        },
      },
      update: {
        content: options.content,
        category,
        type,
        confidence,
        importance,
        status,
        structuredValue,
        embeddingJson,
        sourceSessionId: options.sourceSessionId ?? null,
        updatedAt: new Date(),
      },
      create: {
        telegramUserId,
        key: options.key,
        content: options.content,
        category,
        type,
        confidence,
        importance,
        status,
        structuredValue,
        embeddingJson,
        sourceSessionId: options.sourceSessionId ?? null,
      },
    });

    // Native pgvector update when extension is active in PostgreSQL
    if (isPgVectorAvailable() && Array.isArray(options.embedding) && options.embedding.length > 0) {
      try {
        const vectorStr = `[${options.embedding.join(",")}]`;
        const pool = getPool();
        await pool.query(
          `UPDATE user_memories SET embedding = $1::vector WHERE id = $2`,
          [vectorStr, memory.id],
        );
      } catch {
        // Graceful fallback to embeddingJson
      }
    }

    this.invalidateUserCache(telegramUserId);
    return this.serializeMemory(memory);
  }

  /**
   * Dynamically computes adaptive similarity threshold based on query vector dimensionality,
   * vector norm/variance, and total user memory corpus size.
   */
  public computeAdaptiveMinSimilarity(queryVector: number[], totalMemories = 0): number {
    if (!queryVector || queryVector.length === 0) return 0.35;

    // High-dimensional embeddings (e.g. 768 or 1536) have tighter cosine distributions
    const baseSimilarity = queryVector.length >= 768 ? 0.38 : 0.42;

    // Adapt threshold based on corpus size to balance precision vs recall
    if (totalMemories > 50) {
      return Math.min(0.55, baseSimilarity + 0.10);
    } else if (totalMemories > 20) {
      return Math.min(0.50, baseSimilarity + 0.05);
    } else if (totalMemories < 5) {
      return Math.max(0.25, baseSimilarity - 0.10);
    }

    return baseSimilarity;
  }

  /**
   * Dynamically computes adaptive search result count limit based on user memory corpus size.
   */
  public computeAdaptiveSearchLimit(totalMemories = 0): number {
    if (totalMemories <= 0) return 5;
    // Scale limit adaptively between 3 and 12 depending on corpus size
    return Math.max(3, Math.min(12, Math.ceil(Math.log2(totalMemories + 1) * 2)));
  }

  /**
   * Dynamically derives adaptive confidence rating from vector similarity scores.
   */
  public computeAdaptiveConfidence(similarityScore: number): "low" | "medium" | "high" {
    if (similarityScore >= 0.75) return "high";
    if (similarityScore >= 0.55) return "medium";
    return "low";
  }

  /**
   * Searches user long-term memories using native PostgreSQL pgvector cosine distance (<=>)
   * or fast in-database/in-memory hybrid cosine scoring fallback.
   * Dynamically computes adaptive similarity threshold and adaptive limit when not explicitly provided.
   */
  async searchSimilarMemories(
    telegramUserId: number | bigint,
    queryVector: number[],
    limitOrOptions?: number | { limit?: number; minSimilarity?: number; category?: string },
    minSimilarityParam?: number,
  ): Promise<UserMemoryRecord[]> {
    const uid = BigInt(telegramUserId);

    let limit: number | undefined;
    let minSimilarity: number | undefined;
    let categoryFilter: string | undefined;

    if (typeof limitOrOptions === "object" && limitOrOptions !== null) {
      limit = limitOrOptions.limit;
      minSimilarity = limitOrOptions.minSimilarity;
      categoryFilter = limitOrOptions.category;
    } else if (typeof limitOrOptions === "number") {
      limit = limitOrOptions;
      minSimilarity = minSimilarityParam;
    }

    // Retrieve user memories for adaptive calculation
    const allMemories = await this.prisma.userMemory.findMany({
      where: {
        telegramUserId: uid,
        ...(categoryFilter ? { category: categoryFilter } : {}),
      },
      orderBy: { updatedAt: "desc" },
    });

    const adaptiveLimit = limit ?? this.computeAdaptiveSearchLimit(allMemories.length);
    const adaptiveMinSimilarity =
      minSimilarity ?? this.computeAdaptiveMinSimilarity(queryVector, allMemories.length);

    if (!queryVector || queryVector.length === 0) {
      return allMemories.slice(0, adaptiveLimit).map((m) => this.serializeMemory(m));
    }

    // 1. Attempt Native PostgreSQL pgvector cosine similarity search
    if (isPgVectorAvailable()) {
      try {
        const vectorStr = `[${queryVector.join(",")}]`;
        const pool = getPool();
        const res = await pool.query(
          `
          SELECT *, (1 - (embedding <=> $1::vector)) as similarity
          FROM user_memories
          WHERE telegram_user_id = $2 AND embedding IS NOT NULL
          ${categoryFilter ? "AND category = $4" : ""}
          ORDER BY embedding <=> $1::vector ASC
          LIMIT $3
          `,
          categoryFilter
            ? [vectorStr, uid.toString(), adaptiveLimit, categoryFilter]
            : [vectorStr, uid.toString(), adaptiveLimit],
        );

        if (res.rows && res.rows.length > 0) {
          const results = res.rows
            .map((row) => ({
              id: row.id,
              telegramUserId: Number(row.telegram_user_id),
              key: row.key,
              content: row.content,
              category: row.category || "general",
              type: row.type || row.category || "user_fact",
              structuredValue: row.structured_value || null,
              confidence:
                row.confidence ||
                this.computeAdaptiveConfidence(
                  typeof row.similarity === "number" ? row.similarity : parseFloat(row.similarity),
                ),
              importance: row.importance || "medium",
              status: row.status || "active",
              embeddingJson: row.embedding_json,
              similarity:
                typeof row.similarity === "number" ? row.similarity : parseFloat(row.similarity),
              sourceSessionId: row.source_session_id,
              sourceMessageId: row.source_message_id,
              sourceConversationId: row.source_conversation_id,
              expiresAt: row.expires_at,
              lastAccessedAt: row.last_accessed_at,
              createdAt: row.created_at,
              updatedAt: row.updated_at,
            }))
            .filter((m) => (m.similarity ?? 0) >= adaptiveMinSimilarity);

          if (results.length > 0) {
            return results;
          }
        }
      } catch {
        // Fallback to in-memory JSON embedding ranking
      }
    }

    // 2. Hybrid In-Memory Cosine Similarity ranking over stored embedding JSON
    const scored: Array<UserMemoryRecord & { similarity: number }> = [];

    for (const memory of allMemories) {
      const memRecord = this.serializeMemory(memory);
      if (memory.embeddingJson) {
        try {
          const storedVec = JSON.parse(memory.embeddingJson);
          if (Array.isArray(storedVec) && storedVec.length === queryVector.length) {
            const sim = computeCosineSimilarity(queryVector, storedVec);
            if (sim >= adaptiveMinSimilarity) {
              scored.push({ ...memRecord, similarity: sim });
            }
          }
        } catch {}
      }
    }

    scored.sort((a, b) => b.similarity - a.similarity);
    return scored.slice(0, adaptiveLimit);
  }

  /**
   * Retrieves all long-term memories for a specific user, optionally filtered by category.
   */
  async getUserMemories(
    telegramUserId: number | bigint,
    category?: string,
  ): Promise<UserMemoryRecord[]> {
    const uid = BigInt(telegramUserId);

    const memories = await this.prisma.userMemory.findMany({
      where: {
        telegramUserId: uid,
        ...(category ? { category } : {}),
      },
      orderBy: { updatedAt: "desc" },
    });

    return memories.map((m) => this.serializeMemory(m));
  }

  /**
   * Searches user long-term memories matching a specific keyword or phrase.
   */
  async searchMemories(
    telegramUserId: number | bigint,
    searchQuery: string,
  ): Promise<UserMemoryRecord[]> {
    const uid = BigInt(telegramUserId);
    const query = searchQuery.trim();

    if (!query) {
      return this.getUserMemories(uid);
    }

    const memories = await this.prisma.userMemory.findMany({
      where: {
        telegramUserId: uid,
        OR: [
          { key: { contains: query, mode: "insensitive" } },
          { content: { contains: query, mode: "insensitive" } },
          { category: { contains: query, mode: "insensitive" } },
        ],
      },
      orderBy: { updatedAt: "desc" },
    });

    return memories.map((m) => this.serializeMemory(m));
  }

  /**
   * Deletes a specific long-term memory by key or ID for a user.
   */
  async deleteMemory(telegramUserId: number | bigint, keyOrId: string | number): Promise<boolean> {
    const uid = BigInt(telegramUserId);
    try {
      if (typeof keyOrId === "number") {
        const deleted = await this.prisma.userMemory.deleteMany({
          where: {
            id: keyOrId,
            telegramUserId: uid,
          },
        });
        this.invalidateUserCache(telegramUserId);
        return deleted.count > 0;
      } else {
        const deleted = await this.prisma.userMemory.deleteMany({
          where: {
            telegramUserId: uid,
            key: keyOrId,
          },
        });
        this.invalidateUserCache(telegramUserId);
        return deleted.count > 0;
      }
    } catch {
      return false;
    }
  }

  /**
   * Clears all long-term memories for a user.
   */
  async clearUserMemories(telegramUserId: number | bigint): Promise<number> {
    const uid = BigInt(telegramUserId);
    const result = await this.prisma.userMemory.deleteMany({
      where: { telegramUserId: uid },
    });
    this.invalidateUserCache(telegramUserId);
    return result.count;
  }

  // ==========================================
  // UNIFIED RELATIONAL & EAGER QUERIES
  // ==========================================

  /**
   * Eagerly queries a user along with their active conversations, messages, long-term memories,
   * and scheduled reminders in a single nested relational round-trip.
   * Utilizes L1 cache for high burst concurrency protection.
   */
  async getUserWithFullContext(
    telegramUserId: number | bigint,
  ): Promise<UserFullContextRecord | null> {
    const uid = BigInt(telegramUserId);
    const cacheKey = `user:${uid}:full_context`;
    const cached = this.getCached<UserFullContextRecord>(cacheKey);
    if (cached) return cached;

    await this.ensureUserExists(uid);

    const user = await this.prisma.user.findUnique({
      where: { telegramUserId: uid },
      include: {
        conversations: {
          where: { isActive: true },
          orderBy: { updatedAt: "desc" },
        },
        memories: {
          orderBy: { updatedAt: "desc" },
        },
        reminders: {
          where: { isCompleted: false },
          orderBy: { dueAt: "asc" },
        },
      },
    });

    if (!user) return null;

    const fullContext: UserFullContextRecord = {
      id: user.id,
      telegramUserId: Number(user.telegramUserId),
      username: user.username,
      firstName: user.firstName,
      lastName: user.lastName,
      personality: user.personality,
      mode: user.mode,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      conversations: user.conversations.map((c) => this.serializeSession(c)),
      memories: user.memories.map((m) => this.serializeMemory(m)),
      reminders: user.reminders.map((r) => ({
        id: r.id,
        telegramUserId: Number(r.telegramUserId),
        chatId: Number(r.chatId),
        prompt: r.prompt,
        dueAt: r.dueAt,
        isCompleted: r.isCompleted,
        snoozeCount: r.snoozeCount,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      })),
    };

    this.setCached(cacheKey, fullContext);
    return fullContext;
  }

  /**
   * Performs an atomic cascading purge of all user data (conversations, messages, memories, reminders)
   * under full GDPR and user privacy controls.
   */
  async deleteUserCompletely(telegramUserId: number | bigint): Promise<boolean> {
    const uid = BigInt(telegramUserId);
    try {
      await this.prisma.user.delete({
        where: { telegramUserId: uid },
      });
      this.invalidateUserCache(telegramUserId);
      return true;
    } catch {
      return false;
    }
  }


  /**
   * Formats a list of long-term memories into an optimized prompt block
   * for injection into Gemini's system instructions.
   */
  formatMemoriesForPrompt(memories: UserMemoryRecord[]): string {
    if (!memories || memories.length === 0) return "";

    const lines = memories.map((m) => {
      const categoryTag = m.category && m.category !== "general" ? `[${m.category}] ` : "";
      return `- ${categoryTag}${m.key}: ${m.content}`;
    });

    return `\n\n[USER LONG-TERM MEMORY & KNOWN PREFERENCES]\n${lines.join("\n")}\nUse this long-term context seamlessly when relevant to personalize your responses.`;
  }

  /**
   * Formats a complete global context snapshot (user profile + durable memories + episodic summaries)
   * into a cohesive block for system instructions.
   */
  formatGlobalContextForPrompt(options: {
    userName?: string;
    personalityLabel?: string;
    modeLabel?: string;
    memories: UserMemoryRecord[];
    sessionSummaries: Array<{ summary: string; updatedAt: Date }>;
    semanticRecall?: Array<{ role: string; content: string }>;
  }): string {
    const sections: string[] = [];

    const profileParts: string[] = [];
    if (options.userName) profileParts.push(`Name: ${options.userName}`);
    if (options.personalityLabel) profileParts.push(`Tone: ${options.personalityLabel}`);
    if (options.modeLabel) profileParts.push(`Mode: ${options.modeLabel}`);
    if (profileParts.length > 0) {
      sections.push(`[USER IDENTITY & PROFILE]\n${profileParts.join("\n")}`);
    }

    if (options.memories && options.memories.length > 0) {
      const memoryLines = options.memories.map((m) => {
        const categoryTag = m.category && m.category !== "general" ? `[${m.category}] ` : "";
        return `- ${categoryTag}${m.key}: ${m.content}`;
      });
      sections.push(`[LONG-TERM MEMORY & STORED USER PREFERENCES]\n${memoryLines.join("\n")}`);
    }

    if (options.sessionSummaries && options.sessionSummaries.length > 0) {
      const summaryLines = options.sessionSummaries.map(
        (s, i) => `Session ${i + 1}: ${s.summary}`,
      );
      sections.push(`[RECENT EPISODIC CONVERSATION SUMMARIES]\n${summaryLines.join("\n")}`);
    }

    if (options.semanticRecall && options.semanticRecall.length > 0) {
      const recallLines = options.semanticRecall.map(
        (item) => `- ${item.role === "user" ? "User previously stated" : "Assistant previously answered"}: "${item.content.trim()}"`,
      );
      sections.push(`[SEMANTICALLY RECALLED PAST CONTEXT (VECTOR / HYBRID RAG)]\n${recallLines.join("\n")}`);
    }

    if (sections.length === 0) return "";

    return `\n\n${sections.join("\n\n")}\n\nInstructions regarding user context:\n- This is persistent background context regarding this user. Use it naturally to personalize answers without repeating this prompt block to the user.`;
  }

  // ==========================================
  // AGENT TASKS & TASK STEPS PERSISTENCE
  // ==========================================

  async createTask(options: {
    telegramUserId: number | bigint;
    conversationId?: number;
    title: string;
    goal: string;
    taskType?: string;
    status?: string;
    contextJson?: string;
    metadataJson?: string;
  }): Promise<AgentTaskRecord> {
    const telegramUserIdNum = Number(options.telegramUserId);
    await this.ensureUserExists(BigInt(options.telegramUserId));

    const db = getDb();
    const [inserted] = await db
      .insert(agentTasksTable)
      .values({
        telegramUserId: telegramUserIdNum,
        conversationId: options.conversationId ?? null,
        title: options.title,
        goal: options.goal,
        taskType: options.taskType ?? "general",
        status: options.status ?? "active",
        currentStep: 1,
        contextJson: options.contextJson ?? null,
        metadataJson: options.metadataJson ?? null,
      })
      .returning();

    this.invalidateUserCache(telegramUserIdNum);
    return this.serializeTask(inserted);
  }

  async updateTask(
    taskId: number,
    data: {
      status?: string;
      currentStep?: number;
      goal?: string;
      title?: string;
      contextJson?: string;
      metadataJson?: string;
      completedAt?: Date | null;
    },
  ): Promise<AgentTaskRecord | null> {
    const db = getDb();
    const updateData: Record<string, unknown> = {
      updatedAt: new Date(),
    };

    if (data.status !== undefined) updateData.status = data.status;
    if (data.currentStep !== undefined) updateData.currentStep = data.currentStep;
    if (data.goal !== undefined) updateData.goal = data.goal;
    if (data.title !== undefined) updateData.title = data.title;
    if (data.contextJson !== undefined) updateData.contextJson = data.contextJson;
    if (data.metadataJson !== undefined) updateData.metadataJson = data.metadataJson;
    if (data.completedAt !== undefined) updateData.completedAt = data.completedAt;

    const [updated] = await db
      .update(agentTasksTable)
      .set(updateData)
      .where(eq(agentTasksTable.id, taskId))
      .returning();

    if (updated) {
      this.invalidateUserCache(updated.telegramUserId);
      return this.serializeTask(updated);
    }
    return null;
  }

  async getActiveTasksForUser(telegramUserId: number | bigint): Promise<AgentTaskRecord[]> {
    const uidNum = Number(telegramUserId);
    const db = getDb();
    const rows = await db
      .select()
      .from(agentTasksTable)
      .where(
        and(
          eq(agentTasksTable.telegramUserId, uidNum),
          inArray(agentTasksTable.status, ["pending", "active", "waiting", "paused"]),
        ),
      )
      .orderBy(desc(agentTasksTable.updatedAt));

    return rows.map((r) => this.serializeTask(r));
  }

  async getTaskById(taskId: number): Promise<AgentTaskRecord | null> {
    const db = getDb();
    const rows = await db
      .select()
      .from(agentTasksTable)
      .where(eq(agentTasksTable.id, taskId))
      .limit(1);

    if (rows[0]) return this.serializeTask(rows[0]);
    return null;
  }

  async createTaskStep(options: {
    taskId: number;
    stepOrder: number;
    title: string;
    description?: string;
    status?: string;
    resultSummary?: string;
  }): Promise<AgentTaskStepRecord> {
    const db = getDb();
    const [inserted] = await db
      .insert(agentTaskStepsTable)
      .values({
        taskId: options.taskId,
        stepOrder: options.stepOrder,
        title: options.title,
        description: options.description ?? null,
        status: options.status ?? "pending",
        resultSummary: options.resultSummary ?? null,
      })
      .returning();

    return this.serializeTaskStep(inserted);
  }

  async updateTaskStep(
    stepId: number,
    data: {
      status?: string;
      resultSummary?: string;
      description?: string;
    },
  ): Promise<AgentTaskStepRecord | null> {
    const db = getDb();
    const [updated] = await db
      .update(agentTaskStepsTable)
      .set({
        ...data,
        updatedAt: new Date(),
      })
      .where(eq(agentTaskStepsTable.id, stepId))
      .returning();

    if (updated) return this.serializeTaskStep(updated);
    return null;
  }

  async getTaskSteps(taskId: number): Promise<AgentTaskStepRecord[]> {
    const db = getDb();
    const rows = await db
      .select()
      .from(agentTaskStepsTable)
      .where(eq(agentTaskStepsTable.taskId, taskId))
      .orderBy(agentTaskStepsTable.stepOrder);

    return rows.map((r) => this.serializeTaskStep(r));
  }

  // ==========================================
  // CONVERSATION SUMMARY PERSISTENCE
  // ==========================================

  async saveConversationSummary(options: {
    telegramUserId: number | bigint;
    conversationId: number;
    summary: string;
    keyTakeawaysJson?: string;
    artifactRefsJson?: string;
    messageCountSummarized?: number;
  }): Promise<ConversationSummaryRecord> {
    const telegramUserIdNum = Number(options.telegramUserId);
    const db = getDb();

    const [inserted] = await db
      .insert(conversationSummariesTable)
      .values({
        telegramUserId: telegramUserIdNum,
        conversationId: options.conversationId,
        summary: options.summary,
        keyTakeawaysJson: options.keyTakeawaysJson ?? null,
        artifactRefsJson: options.artifactRefsJson ?? null,
        messageCountSummarized: options.messageCountSummarized ?? 0,
      })
      .returning();

    return {
      id: inserted.id,
      telegramUserId: Number(inserted.telegramUserId),
      conversationId: inserted.conversationId,
      summary: inserted.summary,
      keyTakeawaysJson: inserted.keyTakeawaysJson,
      artifactRefsJson: inserted.artifactRefsJson,
      messageCountSummarized: inserted.messageCountSummarized,
      createdAt: inserted.createdAt,
      updatedAt: inserted.updatedAt,
    };
  }

  async getLatestSummaryForConversation(
    conversationId: number,
  ): Promise<ConversationSummaryRecord | null> {
    const db = getDb();
    const rows = await db
      .select()
      .from(conversationSummariesTable)
      .where(eq(conversationSummariesTable.conversationId, conversationId))
      .orderBy(desc(conversationSummariesTable.createdAt))
      .limit(1);

    if (rows[0]) {
      return {
        id: rows[0].id,
        telegramUserId: Number(rows[0].telegramUserId),
        conversationId: rows[0].conversationId,
        summary: rows[0].summary,
        keyTakeawaysJson: rows[0].keyTakeawaysJson,
        artifactRefsJson: rows[0].artifactRefsJson,
        messageCountSummarized: rows[0].messageCountSummarized,
        createdAt: rows[0].createdAt,
        updatedAt: rows[0].updatedAt,
      };
    }
    return null;
  }

  // ==========================================
  // HELPERS & SERIALIZERS
  // ==========================================

  private async ensureUserExists(telegramUserId: bigint): Promise<void> {
    await this.prisma.user.upsert({
      where: { telegramUserId },
      update: { updatedAt: new Date() },
      create: {
        telegramUserId,
        personality: "playful",
        mode: "general",
      },
    });
  }

  private serializeSession(session: {
    id: number;
    telegramUserId: bigint;
    chatId: bigint;
    title: string | null;
    summary: string | null;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
  }): ChatSessionRecord {
    return {
      id: session.id,
      telegramUserId: Number(session.telegramUserId),
      chatId: Number(session.chatId),
      title: session.title,
      summary: session.summary,
      isActive: session.isActive,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    };
  }

  private serializeMemory(memory: Record<string, unknown>): UserMemoryRecord {
    return {
      id: Number(memory.id),
      telegramUserId: Number(memory.telegramUserId),
      key: String(memory.key || ""),
      content: String(memory.content || ""),
      category: String(memory.category || "general"),
      type: String(memory.type || "user_fact"),
      structuredValue: memory.structuredValue ? String(memory.structuredValue) : null,
      confidence: (memory.confidence as "low" | "medium" | "high") || "high",
      importance: (memory.importance as "low" | "medium" | "high") || "medium",
      status: (memory.status as "active" | "archived" | "deleted") || "active",
      embeddingJson: memory.embeddingJson ? String(memory.embeddingJson) : null,
      sourceSessionId: memory.sourceSessionId ? Number(memory.sourceSessionId) : null,
      sourceMessageId: memory.sourceMessageId ? Number(memory.sourceMessageId) : null,
      sourceConversationId: memory.sourceConversationId ? Number(memory.sourceConversationId) : null,
      expiresAt: memory.expiresAt instanceof Date ? memory.expiresAt : null,
      lastAccessedAt: memory.lastAccessedAt instanceof Date ? memory.lastAccessedAt : null,
      createdAt: memory.createdAt instanceof Date ? memory.createdAt : new Date(),
      updatedAt: memory.updatedAt instanceof Date ? memory.updatedAt : new Date(),
    };
  }

  private serializeTask(task: Record<string, unknown>): AgentTaskRecord {
    return {
      id: Number(task.id),
      telegramUserId: Number(task.telegramUserId),
      conversationId: task.conversationId ? Number(task.conversationId) : null,
      title: String(task.title || ""),
      goal: String(task.goal || ""),
      taskType: String(task.taskType || "general"),
      status: String(task.status || "pending"),
      currentStep: Number(task.currentStep || 1),
      contextJson: task.contextJson ? String(task.contextJson) : null,
      metadataJson: task.metadataJson ? String(task.metadataJson) : null,
      createdAt: task.createdAt instanceof Date ? task.createdAt : new Date(),
      updatedAt: task.updatedAt instanceof Date ? task.updatedAt : new Date(),
      completedAt: task.completedAt instanceof Date ? task.completedAt : null,
    };
  }

  private serializeTaskStep(step: Record<string, unknown>): AgentTaskStepRecord {
    return {
      id: Number(step.id),
      taskId: Number(step.taskId),
      stepOrder: Number(step.stepOrder || 1),
      title: String(step.title || ""),
      description: step.description ? String(step.description) : null,
      status: String(step.status || "pending"),
      resultSummary: step.resultSummary ? String(step.resultSummary) : null,
      createdAt: step.createdAt instanceof Date ? step.createdAt : new Date(),
      updatedAt: step.updatedAt instanceof Date ? step.updatedAt : new Date(),
    };
  }
}

export const chatDatabaseService = new ChatDatabaseService();
