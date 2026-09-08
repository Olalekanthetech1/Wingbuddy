import {
  bigint,
  boolean,
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
    title: text("title"),
    summary: text("summary"),
    isActive: boolean("is_active").default(true).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("conversations_user_chat_idx").on(table.telegramUserId, table.chatId),
    index("conversations_chat_id_idx").on(table.chatId),
    index("conversations_user_active_idx").on(table.telegramUserId, table.isActive),
  ],
);

export const messagesTable = pgTable(
  "messages",
  {
    id: serial("id").primaryKey(),
    conversationId: integer("conversation_id").notNull(),
    role: text("role").notNull(),
    content: text("content").notNull(),
    tokenCount: integer("token_count"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("messages_conversation_created_idx").on(
      table.conversationId,
      table.createdAt,
    ),
  ],
);

export const userMemoriesTable = pgTable(
  "user_memories",
  {
    id: serial("id").primaryKey(),
    telegramUserId: bigint("telegram_user_id", { mode: "number" }).notNull(),
    key: text("key").notNull(),
    content: text("content").notNull(),
    category: text("category").default("general").notNull(),
    type: text("type").default("user_fact").notNull(),
    structuredValue: text("structured_value"),
    confidence: text("confidence").default("high").notNull(), // 'low' | 'medium' | 'high'
    importance: text("importance").default("medium").notNull(), // 'low' | 'medium' | 'high'
    status: text("status").default("active").notNull(), // 'active' | 'archived' | 'deleted'
    embeddingJson: text("embedding_json"),
    sourceSessionId: integer("source_session_id"),
    sourceMessageId: integer("source_message_id"),
    sourceConversationId: integer("source_conversation_id"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    lastAccessedAt: timestamp("last_accessed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("user_memories_user_key_idx").on(table.telegramUserId, table.key),
    index("user_memories_user_category_idx").on(table.telegramUserId, table.category),
    index("user_memories_user_status_idx").on(table.telegramUserId, table.status),
  ],
);

export const agentTasksTable = pgTable(
  "agent_tasks",
  {
    id: serial("id").primaryKey(),
    telegramUserId: bigint("telegram_user_id", { mode: "number" }).notNull(),
    conversationId: integer("conversation_id"),
    title: text("title").notNull(),
    goal: text("goal").notNull(),
    taskType: text("task_type").default("general").notNull(),
    status: text("status").default("pending").notNull(), // 'pending' | 'active' | 'paused' | 'waiting' | 'completed' | 'failed' | 'cancelled'
    currentStep: integer("current_step").default(1).notNull(),
    contextJson: text("context_json"),
    metadataJson: text("metadata_json"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    index("agent_tasks_user_status_idx").on(table.telegramUserId, table.status),
    index("agent_tasks_user_updated_idx").on(table.telegramUserId, table.updatedAt),
  ],
);

export const agentTaskStepsTable = pgTable(
  "agent_task_steps",
  {
    id: serial("id").primaryKey(),
    taskId: integer("task_id").notNull(),
    stepOrder: integer("step_order").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    status: text("status").default("pending").notNull(), // 'pending' | 'running' | 'completed' | 'failed' | 'skipped'
    resultSummary: text("result_summary"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("agent_task_steps_task_step_idx").on(table.taskId, table.stepOrder),
  ],
);

export const conversationSummariesTable = pgTable(
  "conversation_summaries",
  {
    id: serial("id").primaryKey(),
    telegramUserId: bigint("telegram_user_id", { mode: "number" }).notNull(),
    conversationId: integer("conversation_id").notNull(),
    summary: text("summary").notNull(),
    keyTakeawaysJson: text("key_takeaways_json"),
    artifactRefsJson: text("artifact_refs_json"),
    messageCountSummarized: integer("message_count_summarized").default(0).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("conversation_summaries_user_conv_idx").on(table.telegramUserId, table.conversationId),
  ],
);

export const remindersTable = pgTable(
  "reminders",
  {
    id: serial("id").primaryKey(),
    telegramUserId: bigint("telegram_user_id", { mode: "number" }).notNull(),
    chatId: bigint("chat_id", { mode: "number" }).notNull(),
    prompt: text("prompt").notNull(),
    dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
    isCompleted: boolean("is_completed").default(false).notNull(),
    snoozeCount: integer("snooze_count").default(0).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("reminders_user_completed_idx").on(table.telegramUserId, table.isCompleted),
    index("reminders_due_completed_idx").on(table.dueAt, table.isCompleted),
  ],
);

export const systemSettingsTable = pgTable("system_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type User = typeof usersTable.$inferSelect;
export type Conversation = typeof conversationsTable.$inferSelect;
export type Message = typeof messagesTable.$inferSelect;
export type UserMemory = typeof userMemoriesTable.$inferSelect;
export type AgentTask = typeof agentTasksTable.$inferSelect;
export type AgentTaskStep = typeof agentTaskStepsTable.$inferSelect;
export type ConversationSummary = typeof conversationSummariesTable.$inferSelect;
export type Reminder = typeof remindersTable.$inferSelect;
export type SystemSetting = typeof systemSettingsTable.$inferSelect;

