import {
  bigint,
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const usersTable = pgTable(
  "users",
  {
    id: serial("id").primaryKey(),
    telegramUserId: bigint("telegram_user_id", { mode: "number" }).notNull(),
    username: text("username"),
    firstName: text("first_name"),
    lastName: text("last_name"),
    personality: text("personality").default("playful").notNull(),
    mode: text("mode").default("general").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("users_telegram_user_id_idx").on(table.telegramUserId)],
);

export const conversationsTable = pgTable(
  "conversations",
  {
    id: serial("id").primaryKey(),
    telegramUserId: bigint("telegram_user_id", { mode: "number" }).notNull(),
    chatId: bigint("chat_id", { mode: "number" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("conversations_user_chat_idx").on(table.telegramUserId, table.chatId),
    index("conversations_chat_id_idx").on(table.chatId),
  ],
);

export const messagesTable = pgTable(
  "messages",
  {
    id: serial("id").primaryKey(),
    conversationId: integer("conversation_id").notNull(),
    role: text("role").notNull(),
    content: text("content").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("messages_conversation_created_idx").on(
      table.conversationId,
      table.createdAt,
    ),
  ],
);

export type User = typeof usersTable.$inferSelect;
export type Conversation = typeof conversationsTable.$inferSelect;
export type Message = typeof messagesTable.$inferSelect;