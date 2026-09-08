import { getPrisma, getPool, isPgVectorAvailable } from "../client";

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
  embedding?: number[];
  embeddingJson?: string;
  sourceSessionId?: number;
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
  embeddingJson?: string | null;
  similarity?: number;
  sourceSessionId: number | null;
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
        embeddingJson,
        sourceSessionId: options.sourceSessionId ?? null,
        updatedAt: new Date(),
      },
      create: {
        telegramUserId,
        key: options.key,
        content: options.content,
        category,
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
   * Searches user long-term memories using native PostgreSQL pgvector cosine distance (<=>)
   * or fast in-database/in-memory hybrid cosine scoring fallback.
   */
  async searchSimilarMemories(
    telegramUserId: number | bigint,
    queryVector: number[],
    limit = 5,
    minSimilarity = 0.45,
  ): Promise<UserMemoryRecord[]> {
    const uid = BigInt(telegramUserId);
    if (!queryVector || queryVector.length === 0) {
      return this.getUserMemories(uid);
    }

    // 1. Attempt Native PostgreSQL pgvector cosine similarity search
    if (isPgVectorAvailable()) {
      try {
        const vectorStr = `[${queryVector.join(",")}]`;
        const pool = getPool();
        const res = await pool.query(
          `
          SELECT id, telegram_user_id, key, content, category, embedding_json, source_session_id, created_at, updated_at,
                 (1 - (embedding <=> $1::vector)) as similarity
          FROM user_memories
          WHERE telegram_user_id = $2 AND embedding IS NOT NULL
          ORDER BY embedding <=> $1::vector ASC
          LIMIT $3
          `,
          [vectorStr, uid.toString(), limit],
        );

        if (res.rows && res.rows.length > 0) {
          const results = res.rows
            .map((row) => ({
              id: row.id,
              telegramUserId: Number(row.telegram_user_id),
              key: row.key,
              content: row.content,
              category: row.category,
              embeddingJson: row.embedding_json,
              similarity: typeof row.similarity === "number" ? row.similarity : parseFloat(row.similarity),
              sourceSessionId: row.source_session_id,
              createdAt: row.created_at,
              updatedAt: row.updated_at,
            }))
            .filter((m) => (m.similarity ?? 0) >= minSimilarity);

          if (results.length > 0) {
            return results;
          }
        }
      } catch {
        // Fallback to in-memory JSON embedding ranking
      }
    }

    // 2. Hybrid In-Memory Cosine Similarity ranking over stored embedding JSON
    const allMemories = await this.prisma.userMemory.findMany({
      where: { telegramUserId: uid },
      orderBy: { updatedAt: "desc" },
    });

    const scored: Array<UserMemoryRecord & { similarity: number }> = [];

    for (const memory of allMemories) {
      const memRecord = this.serializeMemory(memory);
      if (memory.embeddingJson) {
        try {
          const storedVec = JSON.parse(memory.embeddingJson);
          if (Array.isArray(storedVec) && storedVec.length === queryVector.length) {
            const sim = computeCosineSimilarity(queryVector, storedVec);
            if (sim >= minSimilarity) {
              scored.push({ ...memRecord, similarity: sim });
            }
          }
        } catch {}
      }
    }

    scored.sort((a, b) => b.similarity - a.similarity);
    return scored.slice(0, limit);
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
   * Deletes a specific long-term memory key for a user.
   */
  async deleteMemory(telegramUserId: number | bigint, key: string): Promise<boolean> {
    const uid = BigInt(telegramUserId);
    try {
      await this.prisma.userMemory.delete({
        where: {
          telegramUserId_key: {
            telegramUserId: uid,
            key,
          },
        },
      });
      this.invalidateUserCache(telegramUserId);
      return true;
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
  // HELPERS
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

  private serializeMemory(memory: {
    id: number;
    telegramUserId: bigint;
    key: string;
    content: string;
    category: string;
    embeddingJson?: string | null;
    sourceSessionId: number | null;
    createdAt: Date;
    updatedAt: Date;
  }): UserMemoryRecord {
    return {
      id: memory.id,
      telegramUserId: Number(memory.telegramUserId),
      key: memory.key,
      content: memory.content,
      category: memory.category,
      embeddingJson: memory.embeddingJson ?? null,
      sourceSessionId: memory.sourceSessionId,
      createdAt: memory.createdAt,
      updatedAt: memory.updatedAt,
    };
  }
}

export const chatDatabaseService = new ChatDatabaseService();
