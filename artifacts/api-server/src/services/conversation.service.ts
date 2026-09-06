import { and, desc, eq } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  conversationsTable,
  messagesTable,
  usersTable,
  type Message,
} from "@workspace/db";

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
      .values({
        telegramUserId: user.id,
        username: user.username ?? null,
        firstName: user.firstName ?? null,
        lastName: user.lastName ?? null,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: usersTable.telegramUserId,
        set: {
          username: user.username ?? null,
          firstName: user.firstName ?? null,
          lastName: user.lastName ?? null,
          updatedAt: now,
        },
      });
  }

  async getOrCreateConversation(telegramUserId: number, chatId: number): Promise<number> {
    const existing = await db
      .select({ id: conversationsTable.id })
      .from(conversationsTable)
      .where(
        and(
          eq(conversationsTable.telegramUserId, telegramUserId),
          eq(conversationsTable.chatId, chatId),
        ),
      )
      .limit(1);

    if (existing[0]) return existing[0].id;

    const created = await db
      .insert(conversationsTable)
      .values({ telegramUserId, chatId })
      .onConflictDoUpdate({
        target: [conversationsTable.telegramUserId, conversationsTable.chatId],
        set: { updatedAt: new Date() },
      })
      .returning({ id: conversationsTable.id });

    return created[0]?.id ?? this.getConversationId(telegramUserId, chatId);
  }

  private async getConversationId(telegramUserId: number, chatId: number): Promise<number> {
    const conversation = await db
      .select({ id: conversationsTable.id })
      .from(conversationsTable)
      .where(
        and(
          eq(conversationsTable.telegramUserId, telegramUserId),
          eq(conversationsTable.chatId, chatId),
        ),
      )
      .limit(1);
    if (!conversation[0]) throw new Error("Conversation could not be created.");
    return conversation[0].id;
  }

  async addMessage(conversationId: number, role: "user" | "model", content: string): Promise<void> {
    await db.insert(messagesTable).values({ conversationId, role, content });
    await db
      .update(conversationsTable)
      .set({ updatedAt: new Date() })
      .where(eq(conversationsTable.id, conversationId));
  }

  async getRecentMessages(conversationId: number, limit: number): Promise<Message[]> {
    const messages = await db
      .select()
      .from(messagesTable)
      .where(eq(messagesTable.conversationId, conversationId))
      .orderBy(desc(messagesTable.createdAt))
      .limit(limit);
    return messages.reverse();
  }

  async clearConversation(telegramUserId: number, chatId: number): Promise<void> {
    const conversationId = await this.findConversationId(telegramUserId, chatId);
    if (!conversationId) return;
    await db.delete(messagesTable).where(eq(messagesTable.conversationId, conversationId));
    await db
      .update(conversationsTable)
      .set({ updatedAt: new Date() })
      .where(eq(conversationsTable.id, conversationId));
  }

  async resetConversation(telegramUserId: number, chatId: number): Promise<void> {
    const conversationId = await this.findConversationId(telegramUserId, chatId);
    if (!conversationId) return;
    await db.delete(messagesTable).where(eq(messagesTable.conversationId, conversationId));
    await db
      .delete(conversationsTable)
      .where(eq(conversationsTable.id, conversationId));
  }

  private async findConversationId(
    telegramUserId: number,
    chatId: number,
  ): Promise<number | undefined> {
    const result = await db
      .select({ id: conversationsTable.id })
      .from(conversationsTable)
      .where(
        and(
          eq(conversationsTable.telegramUserId, telegramUserId),
          eq(conversationsTable.chatId, chatId),
        ),
      )
      .limit(1);
    return result[0]?.id;
  }
}