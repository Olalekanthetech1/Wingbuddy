import { chatDatabaseService, type UserMemoryRecord, type SaveMemoryOptions } from "@workspace/db";
import { logger } from "../lib/logger";

export type MemoryType =
  | "user_preference"
  | "user_fact"
  | "workflow_preference"
  | "project_context"
  | "learning_context"
  | "interaction_preference"
  | "important_context";

export interface ExtractedMemoryItem {
  key: string;
  content: string;
  type: MemoryType;
  category: string;
  confidence: "low" | "medium" | "high";
  importance: "low" | "medium" | "high";
}

export class MemoryService {
  /**
   * Saves or updates a memory record with automatic key normalisation, deduplication, and confidence checking.
   */
  async saveMemory(options: {
    telegramUserId: number | bigint;
    key: string;
    content: string;
    type?: MemoryType;
    category?: string;
    confidence?: "low" | "medium" | "high";
    importance?: "low" | "medium" | "high";
    status?: "active" | "archived" | "deleted";
    structuredValue?: string;
    sourceSessionId?: number;
    sourceMessageId?: number;
    sourceConversationId?: number;
    importSource?: string;
    externalId?: string;
    importBatchId?: string;
    expiresAt?: Date;
  }): Promise<UserMemoryRecord | null> {
    const telegramUserId = Number(options.telegramUserId);
    const key = options.key.trim().toLowerCase().replace(/[^a-z0-9_]/g, "_");
    const confidence = options.confidence ?? "high";

    // Sanitize content: strip control characters
    let content = options.content.replace(/[\x00-\x1F\x7F-\x9F]/g, "").trim();

    // Ignore low confidence extractions to prevent noise
    if (confidence === "low") {
      logger.info({ telegramUserId, key }, "MEMORY_IGNORED_LOW_CONFIDENCE");
      return null;
    }

    const type = options.type ?? "user_fact";
    const category = options.category ?? type;
    const importance = options.importance ?? "medium";
    const status = options.status ?? "active";

    // Check for existing memories to deduplicate/update
    const existingMemories = await chatDatabaseService.getUserMemories(telegramUserId);
    const match = existingMemories.find(
      (m) => m.key === key || m.content.toLowerCase() === options.content.toLowerCase(),
    );

    let result: UserMemoryRecord;
    if (match) {
      logger.info(
        { telegramUserId, key, previousContent: match.content, newContent: options.content },
        "MEMORY_UPDATED",
      );
      result = await chatDatabaseService.saveMemory({
        telegramUserId,
        key: match.key,
        content: content,
        category,
        type,
        confidence,
        importance,
        status,
        structuredValue: options.structuredValue,
        sourceSessionId: options.sourceSessionId,
        sourceMessageId: options.sourceMessageId,
        sourceConversationId: options.sourceConversationId,
        importSource: options.importSource,
        externalId: options.externalId,
        importBatchId: options.importBatchId,
        expiresAt: options.expiresAt,
      });
    } else {
      logger.info({ telegramUserId, key, content: content }, "MEMORY_CREATED");
      result = await chatDatabaseService.saveMemory({
        telegramUserId,
        key,
        content: content,
        category,
        type,
        confidence,
        importance,
        status,
        structuredValue: options.structuredValue,
        sourceSessionId: options.sourceSessionId,
        sourceMessageId: options.sourceMessageId,
        sourceConversationId: options.sourceConversationId,
        importSource: options.importSource,
        externalId: options.externalId,
        importBatchId: options.importBatchId,
        expiresAt: options.expiresAt,
      });
    }

    return result;
  }

  /**
   * Retrieves active memories for a given user, optionally filtered by type or category.
   */
  async getMemories(
    telegramUserId: number | bigint,
    options?: { type?: MemoryType; category?: string; minConfidence?: "medium" | "high" },
  ): Promise<UserMemoryRecord[]> {
    const uid = Number(telegramUserId);
    const all = await chatDatabaseService.getUserMemories(uid);

    return all.filter((m) => {
      if (m.status === "deleted" || m.status === "archived") return false;
      if (options?.type && m.type !== options.type) return false;
      if (options?.category && m.category !== options.category) return false;
      if (options?.minConfidence === "high" && m.confidence !== "high") return false;
      return true;
    });
  }

  /**
   * Alias for getMemories to support user routes and controllers.
   */
  async getUserMemories(
    telegramUserId: number | bigint,
    options?: { type?: MemoryType; category?: string; minConfidence?: "medium" | "high" },
  ): Promise<UserMemoryRecord[]> {
    return this.getMemories(telegramUserId, options);
  }

  /**
   * Direct helper to save a user memory with default category/importance.
   */
  async saveUserMemory(
    telegramUserId: number | bigint,
    key: string,
    content: string,
    category = "general",
    importance: "low" | "medium" | "high" = "medium",
  ): Promise<UserMemoryRecord | null> {
    return this.saveMemory({
      telegramUserId,
      key,
      content,
      category,
      type: (category as MemoryType) || "user_fact",
      importance,
      confidence: "high",
    });
  }

  /**
   * Direct helper to delete a memory by key or ID.
   */
  async deleteUserMemory(telegramUserId: number | bigint, keyOrId: string | number): Promise<boolean> {
    return this.forgetMemory(telegramUserId, keyOrId);
  }

  /**
   * Searches memories using keyword and semantic similarity.
   */
  async searchMemories(telegramUserId: number | bigint, query: string): Promise<UserMemoryRecord[]> {
    const uid = Number(telegramUserId);
    return chatDatabaseService.searchMemories(uid, query);
  }

  /**
   * Forgets a single memory by ID or key.
   */
  async forgetMemory(telegramUserId: number | bigint, memoryIdOrKey: number | string): Promise<boolean> {
    const uid = Number(telegramUserId);
    if (typeof memoryIdOrKey === "number") {
      const deleted = await chatDatabaseService.deleteMemory(uid, memoryIdOrKey);
      logger.info({ telegramUserId: uid, memoryId: memoryIdOrKey, deleted }, "MEMORY_DELETED_BY_ID");
      return deleted;
    } else {
      const key = memoryIdOrKey.trim().toLowerCase().replace(/[^a-z0-9_]/g, "_");
      const memories = await chatDatabaseService.getUserMemories(uid);
      const target = memories.find((m) => m.key === key);
      if (target) {
        const deleted = await chatDatabaseService.deleteMemory(uid, target.id);
        logger.info({ telegramUserId: uid, key, deleted }, "MEMORY_DELETED_BY_KEY");
        return deleted;
      }
    }
    return false;
  }

  /**
   * Clears all long-term memories for a user.
   */
  async clearAllMemories(telegramUserId: number | bigint): Promise<number> {
    const uid = Number(telegramUserId);
    const count = await chatDatabaseService.clearUserMemories(uid);
    logger.info({ telegramUserId: uid, count }, "MEMORY_ALL_CLEARED");
    return count;
  }

  /**
   * Formats active memories into a structured, token-optimized section for system prompt injection.
   * Can accept either a user ID or an array of UserMemoryRecord objects.
   */
  formatMemoriesForPrompt(input: number | bigint | UserMemoryRecord[]): string | Promise<string> {
    if (Array.isArray(input)) {
      if (input.length === 0) return "";

      const categories: Record<string, string[]> = {};
      for (const mem of input) {
        const catKey = mem.type || mem.category || "user_fact";
        if (!categories[catKey]) {
          categories[catKey] = [];
        }
        categories[catKey].push(`• [${mem.key}]: ${mem.content}`);
      }

      const sections: string[] = [];
      const typeLabels: Record<string, string> = {
        user_preference: "USER PREFERENCES",
        user_fact: "USER FACTS",
        workflow_preference: "WORKFLOW PREFERENCES",
        project_context: "PROJECT CONTEXT",
        learning_context: "LEARNING GOALS",
        interaction_preference: "INTERACTION PREFERENCES",
        important_context: "IMPORTANT CONTEXT",
      };

      for (const [catKey, items] of Object.entries(categories)) {
        const label = typeLabels[catKey] || catKey.toUpperCase();
        sections.push(`[${label}]\n${items.join("\n")}`);
      }

      return `\n\n[PERSISTENT LONG-TERM MEMORY]\n${sections.join("\n\n")}\n\nInstructions regarding persistent memories:\n- Use these stored facts and preferences naturally.\n- Never reveal internal memory key identifiers to the user unless explicitly asked via /memory.`;
    }

    return this.getMemories(input).then((memories) => this.formatMemoriesForPrompt(memories) as string);
  }

  /**
   * Helper for background memory extraction from user conversation dialogue.
   */
  async extractAndSaveMemories(
    telegramUserId: number | bigint,
    userPrompt: string,
    assistantReply?: string,
  ): Promise<void> {
    const combined = `${userPrompt}\n${assistantReply || ""}`;
    await this.processBackgroundExtraction(telegramUserId, combined);
  }

  /**
   * Extracts candidate facts and preferences from dialogue text asynchronously.
   */
  extractCandidateMemories(text: string): ExtractedMemoryItem[] {
    const items: ExtractedMemoryItem[] = [];
    const trimmed = text.trim();

    // Explicit "remember that...", "keep in mind...", "note that..."
    const explicitMatch = trimmed.match(
      /\b(?:remember\s+that|keep\s+in\s+mind\s+that|note\s+that|save\s+this|my\s+preference\s+is)\b\s*(.+)/i,
    );
    if (explicitMatch && explicitMatch[1]) {
      const rawFact = explicitMatch[1].trim();
      items.push({
        key: `explicit_fact_${Date.now()}`,
        content: rawFact,
        type: "important_context",
        category: "important_context",
        confidence: "high",
        importance: "high",
      });
    }

    // Name extraction ("My name is X", "I am X")
    const nameMatch = trimmed.match(/\b(?:my\s+name\s+is|i\s+am|call\s+me)\s+([A-Z][a-z]+)\b/);
    if (nameMatch && nameMatch[1] && !["Here", "Going", "Trying", "Using", "Looking"].includes(nameMatch[1])) {
      items.push({
        key: "user_name",
        content: `User's name is ${nameMatch[1]}`,
        type: "user_fact",
        category: "user_fact",
        confidence: "high",
        importance: "high",
      });
    }

    // Preference extraction ("I prefer X over Y", "I love X", "I prefer using X")
    const prefMatch = trimmed.match(/\b(?:i\s+prefer|i\s+like|i\s+love|i\s+always\s+use)\s+([^.,!?]+)/i);
    if (prefMatch && prefMatch[1]) {
      const prefText = prefMatch[1].trim();
      if (prefText.length > 0) {
        items.push({
          key: `pref_${prefText.slice(0, 20).toLowerCase().replace(/[^a-z0-9]/g, "_")}`,
          content: `User prefers: ${prefText}`,
          type: "user_preference",
          category: "user_preference",
          confidence: "high",
          importance: "medium",
        });
      }
    }

    // Project / Tech stack context ("I am building X", "Working on X in Python")
    const projMatch = trimmed.match(/\b(?:i'm\s+building|i\s+am\s+working\s+on|my\s+project\s+is)\s+([^.,!?]+)/i);
    if (projMatch && projMatch[1]) {
      const projText = projMatch[1].trim();
      items.push({
        key: "current_project",
        content: `Current project: ${projText}`,
        type: "project_context",
        category: "project_context",
        confidence: "high",
        importance: "high",
      });
    }

    return items;
  }

  /**
   * Extracts candidate memories from a larger block of text (e.g., imported from ChatGPT/Claude) using Gemini.
   * Returns a structured list of proposed memories for the user to review.
   */
  async extractImportCandidates(telegramUserId: number | bigint, pastedText: string): Promise<ExtractedMemoryItem[]> {
    const { getDefaultGeminiService } = await import("../gemini/gemini.service");
    const gemini = getDefaultGeminiService();

    // Direct JSON parsing attempt if the text looks like a JSON array
    if (pastedText.trim().startsWith("[") && pastedText.trim().endsWith("]")) {
      try {
        const directParsed = JSON.parse(pastedText.trim());
        if (Array.isArray(directParsed) && directParsed.length > 0) {
          logger.info({ count: directParsed.length }, "IMPORT_DIRECT_JSON_PARSING_SUCCESS");
          
          const existing = await this.getMemories(telegramUserId);
          return directParsed.map(item => {
            const isDuplicate = existing.some(e =>
              e.key === item.key ||
              e.content.toLowerCase().includes(item.content.toLowerCase()) ||
              item.content.toLowerCase().includes(e.content.toLowerCase())
            );

            return {
              key: item.key || `fact_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
              content: item.content || String(item),
              type: item.type || item.category || "user_fact",
              category: item.category || item.type || "user_fact",
              confidence: item.confidence || "high",
              importance: item.importance || "medium",
              isDuplicate
            } as ExtractedMemoryItem;
          });
        }
      } catch (e) {
        // Fallback to AI extraction if JSON parse fails
        logger.debug("Import direct JSON parse failed, falling back to AI extraction");
      }
    }

    const prompt = `You are a memory extraction expert. Analyze the provided text which is a summary of a user's memories, habits, and preferences from another AI tool.
Extract individual, atomic memory items.

Rules:
1. Each item must be discrete (one fact per item).
2. Assign a 'type' from: user_preference, user_fact, workflow_preference, project_context, learning_context, interaction_preference, important_context.
3. Assign a short snake_case 'key' for each.
4. Estimate confidence and importance (low, medium, high).
5. Strip any metadata or conversational filler.
6. COMPLETERNESS: You MUST extract EVERY SINGLE FACT or preference mentioned. Do not summarize multiple items into one. If the input has 50 points, return 50 items.
7. Return ONLY a valid JSON array of objects with schema: [{"key": string, "content": string, "type": string, "category": string, "confidence": string, "importance": string}]

Input Text:
${pastedText}`;

    try {
      const response = await gemini.generateReply([], prompt, "Return valid JSON only.", { 
        isExtraction: true,
        temperature: 0.1 // Lower temperature for more stable extraction
      });
      const cleaned = response.replace(/^```json/i, "").replace(/^```/i, "").replace(/```$/i, "").trim();
      const parsed = JSON.parse(cleaned);

      if (!Array.isArray(parsed)) return [];

      // Dedupe against existing memories semantically
      const existing = await this.getMemories(telegramUserId);
      return parsed.map(item => {
        const isDuplicate = existing.some(e =>
          e.key === item.key ||
          e.content.toLowerCase().includes(item.content.toLowerCase()) ||
          item.content.toLowerCase().includes(e.content.toLowerCase())
        );

        return {
          ...item,
          isDuplicate,
          confidence: item.confidence || "high",
          importance: item.importance || "medium",
          category: item.category || item.type || "user_fact"
        };
      });
    } catch (err) {
      logger.error({ err: err instanceof Error ? err.message : String(err) }, "IMPORT_EXTRACTION_ERROR");
      return [];
    }
  }

  /**
   * Finalizes a batch of imported memories after user confirmation.
   */
  async commitImportedMemories(
    telegramUserId: number | bigint,
    items: ExtractedMemoryItem[],
    source: string
  ): Promise<{ saved: number; skipped: number }> {
    const batchId = `import_${source}_${Date.now()}`;
    let saved = 0;
    let skipped = 0;

    for (const item of items) {
      try {
        const result = await this.saveMemory({
          telegramUserId,
          key: item.key,
          content: item.content,
          type: item.type,
          category: item.category,
          confidence: item.confidence,
          importance: item.importance,
          importSource: source,
          importBatchId: batchId,
          externalId: `import_${source}_${item.key}`
        });

        if (result) saved++;
        else skipped++;
      } catch (err) {
        skipped++;
        logger.error({ key: item.key, err }, "COMMIT_MEMORY_ERROR");
      }
    }

    return { saved, skipped };
  }

  /**
   * Process memory extraction in background post-response.
   */
  async processBackgroundExtraction(
    telegramUserId: number | bigint,
    messageText: string,
    sourceSessionId?: number,
  ): Promise<void> {
    try {
      const candidates = this.extractCandidateMemories(messageText);
      for (const item of candidates) {
        await this.saveMemory({
          telegramUserId,
          key: item.key,
          content: item.content,
          type: item.type,
          category: item.category,
          confidence: item.confidence,
          importance: item.importance,
          sourceSessionId,
        });
      }
    } catch (err) {
      logger.error(
        { telegramUserId, err: err instanceof Error ? err.message : String(err) },
        "BACKGROUND_MEMORY_EXTRACTION_ERROR",
      );
    }
  }
}

export const memoryService = new MemoryService();
