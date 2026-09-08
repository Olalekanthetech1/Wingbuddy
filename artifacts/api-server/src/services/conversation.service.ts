import { and, desc, eq } from "drizzle-orm";
import {
  chatDatabaseService,
  conversationsTable,
  db,
  messagesTable,
  usersTable,
  type Message,
  type UserMemoryRecord,
} from "@workspace/db";
import { isPersonalityKey, type PersonalityKey } from "../config/personality";
import { isModeKey, type ModeKey } from "../config/mode";
import { runtimeBehaviorConfigService } from "./runtime-behavior-config.service";

export interface TelegramUserProfile {
  id: number;
  username?: string;
  firstName?: string;
  lastName?: string;
}

export class ConversationService {
  async upsertUser(user: TelegramUserProfile): Promise<void> {
    const now = new Date();
    await db
      .insert(usersTable)
      .values({ telegramUserId: user.id, username: user.username ?? null, firstName: user.firstName ?? null, lastName: user.lastName ?? null, updatedAt: now })
      .onConflictDoUpdate({ target: usersTable.telegramUserId, set: { username: user.username ?? null, firstName: user.firstName ?? null, lastName: user.lastName ?? null, updatedAt: now } });
  }

  async getOrCreateConversation(telegramUserId: number, chatId: number): Promise<number> {
    const existing = await db.select({ id: conversationsTable.id }).from(conversationsTable).where(and(eq(conversationsTable.telegramUserId, telegramUserId), eq(conversationsTable.chatId, chatId))).limit(1);
    if (existing[0]) return existing[0].id;
    const created = await db.insert(conversationsTable).values({ telegramUserId, chatId }).onConflictDoUpdate({ target: [conversationsTable.telegramUserId, conversationsTable.chatId], set: { updatedAt: new Date() } }).returning({ id: conversationsTable.id });
    return created[0]?.id ?? this.getConversationId(telegramUserId, chatId);
  }

  async getUserPersonality(telegramUserId: number): Promise<PersonalityKey> {
    const result = await db.select({ personality: usersTable.personality }).from(usersTable).where(eq(usersTable.telegramUserId, telegramUserId)).limit(1);
    const personality = result[0]?.personality;
    if (isPersonalityKey(personality)) return personality;
    const configured = runtimeBehaviorConfigService.getDefault("personality");
    return isPersonalityKey(configured) ? configured : "playful";
  }

  async setUserPersonality(telegramUserId: number, personality: PersonalityKey): Promise<void> {
    await db.insert(usersTable).values({ telegramUserId, personality, mode: "general", updatedAt: new Date() }).onConflictDoUpdate({ target: usersTable.telegramUserId, set: { personality, updatedAt: new Date() } });
    chatDatabaseService.invalidateUserCache(telegramUserId);
  }

  async getUserMode(telegramUserId: number): Promise<ModeKey> {
    const result = await db.select({ mode: usersTable.mode }).from(usersTable).where(eq(usersTable.telegramUserId, telegramUserId)).limit(1);
    const mode = result[0]?.mode;
    if (isModeKey(mode)) return mode;
    const configured = runtimeBehaviorConfigService.getDefault("mode");
    return isModeKey(configured) ? configured : "general";
  }

  async setUserMode(telegramUserId: number, mode: ModeKey): Promise<void> {
    await db.insert(usersTable).values({ telegramUserId, personality: "playful", mode, updatedAt: new Date() }).onConflictDoUpdate({ target: usersTable.telegramUserId, set: { mode, updatedAt: new Date() } });
    chatDatabaseService.invalidateUserCache(telegramUserId);
  }

  private async getConversationId(telegramUserId: number, chatId: number): Promise<number> {
    const conversation = await db.select({ id: conversationsTable.id }).from(conversationsTable).where(and(eq(conversationsTable.telegramUserId, telegramUserId), eq(conversationsTable.chatId, chatId))).limit(1);
    if (!conversation[0]) throw new Error("Conversation could not be created.");
    return conversation[0].id;
  }

  async addMessage(conversationId: number, role: "user" | "model", content: string): Promise<void> {
    await db.insert(messagesTable).values({ conversationId, role, content });
    await db.update(conversationsTable).set({ updatedAt: new Date() }).where(eq(conversationsTable.id, conversationId));
  }

  async getRecentMessages(conversationId: number, limit: number): Promise<Message[]> {
    const messages = await db.select().from(messagesTable).where(eq(messagesTable.conversationId, conversationId)).orderBy(desc(messagesTable.createdAt)).limit(limit);
    return messages.reverse();
  }

  async clearConversation(telegramUserId: number, chatId: number): Promise<void> {
    const conversationId = await this.findConversationId(telegramUserId, chatId);
    if (!conversationId) return;
    await db.delete(messagesTable).where(eq(messagesTable.conversationId, conversationId));
    await db.update(conversationsTable).set({ updatedAt: new Date() }).where(eq(conversationsTable.id, conversationId));
  }

  async resetConversation(telegramUserId: number, chatId: number): Promise<void> {
    const conversationId = await this.findConversationId(telegramUserId, chatId);
    if (!conversationId) return;
    await db.delete(messagesTable).where(eq(messagesTable.conversationId, conversationId));
    await db.delete(conversationsTable).where(eq(conversationsTable.id, conversationId));
  }

  async getUserMemories(telegramUserId: number): Promise<UserMemoryRecord[]> { return chatDatabaseService.getUserMemories(telegramUserId); }
  async saveUserMemory(telegramUserId: number, key: string, content: string, category = "general", embedding?: number[]): Promise<UserMemoryRecord> { return chatDatabaseService.saveMemory({ telegramUserId, key, content, category, embedding }); }
  async searchSimilarMemories(telegramUserId: number, queryVector: number[], limit = 5, minSimilarity = 0.45): Promise<UserMemoryRecord[]> { return chatDatabaseService.searchSimilarMemories(telegramUserId, queryVector, limit, minSimilarity); }
  async deleteUserMemory(telegramUserId: number, key: string): Promise<boolean> { return chatDatabaseService.deleteMemory(telegramUserId, key); }
  async clearUserMemories(telegramUserId: number): Promise<number> { return chatDatabaseService.clearUserMemories(telegramUserId); }
  formatMemoriesForPrompt(memories: UserMemoryRecord[]): string { return chatDatabaseService.formatMemoriesForPrompt(memories); }
  async getUserWithFullContext(telegramUserId: number) { return chatDatabaseService.getUserWithFullContext(telegramUserId); }
  async purgeUserData(telegramUserId: number): Promise<boolean> { return chatDatabaseService.deleteUserCompletely(telegramUserId); }

  async getRecentSessionSummary(telegramUserId: number, chatId: number): Promise<string | null> {
    const session = await db.select({ summary: conversationsTable.summary }).from(conversationsTable).where(and(eq(conversationsTable.telegramUserId, telegramUserId), eq(conversationsTable.chatId, chatId))).limit(1);
    return session[0]?.summary ?? null;
  }

  async setSessionSummary(conversationId: number, summary: string): Promise<void> {
    await db.update(conversationsTable).set({ summary, updatedAt: new Date() }).where(eq(conversationsTable.id, conversationId));
  }

  private async findConversationId(telegramUserId: number, chatId: number): Promise<number | undefined> {
    const result = await db.select({ id: conversationsTable.id }).from(conversationsTable).where(and(eq(conversationsTable.telegramUserId, telegramUserId), eq(conversationsTable.chatId, chatId))).limit(1);
    return result[0]?.id;
  }
}
