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
    tier: text("tier").default("free").notNull(),
    dailyQuota: integer("daily_quota").default(30).notNull(),
    requestsToday: integer("requests_today").default(0).notNull(),
    lastRequestDate: text("last_request_date").default("").notNull(),
    totalRequests: integer("total_requests").default(0).notNull(),
    customModelOverride: text("custom_model_override"),
    status: text("status").default("active").notNull(),
    activePersonaId: text("active_persona_id").default("default_assistant").notNull(),
    lastActiveAt: timestamp("last_active_at", { withTimezone: true }).defaultNow().notNull(),
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
    deadlineAt: timestamp("deadline_at", { withTimezone: true }),
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

export const executionGraphsTable = pgTable(
  "execution_graphs",
  {
    id: serial("id").primaryKey(),
    graphId: text("graph_id").notNull(),
    telegramUserId: bigint("telegram_user_id", { mode: "number" }).notNull(),
    latestRevision: integer("latest_revision").default(1).notNull(),
    status: text("status").default("ready").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("execution_graphs_graph_id_idx").on(table.graphId),
    index("execution_graphs_user_idx").on(table.telegramUserId),
    index("execution_graphs_status_idx").on(table.status),
  ],
);

export const graphRevisionsTable = pgTable(
  "graph_revisions",
  {
    id: serial("id").primaryKey(),
    graphId: text("graph_id").notNull(),
    planRevision: integer("plan_revision").notNull(),
    revisionId: text("revision_id").notNull(),
    parentRevisionId: text("parent_revision_id"),
    telegramUserId: bigint("telegram_user_id", { mode: "number" }).notNull(),
    goal: text("goal").notNull(),
    status: text("status").default("ready").notNull(),
    graphJson: text("graph_json").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("graph_revisions_revision_id_idx").on(table.revisionId),
    index("graph_revisions_graph_rev_idx").on(table.graphId, table.planRevision),
    index("graph_revisions_user_idx").on(table.telegramUserId),
  ],
);

export const executionSessionsTable = pgTable(
  "execution_sessions",
  {
    id: serial("id").primaryKey(),
    executionId: text("execution_id").notNull(),
    requestId: text("request_id").notNull(),
    taskId: integer("task_id"),
    graphId: text("graph_id").notNull(),
    planRevision: integer("plan_revision").notNull(),
    revisionId: text("revision_id").notNull(),
    telegramUserId: bigint("telegram_user_id", { mode: "number" }).notNull(),
    status: text("status").default("ready").notNull(),
    currentNodesJson: text("current_nodes_json"),
    errorJson: text("error_json"),
    startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    deadlineAt: timestamp("deadline_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("execution_sessions_execution_id_idx").on(table.executionId),
    index("execution_sessions_graph_rev_idx").on(table.graphId, table.planRevision),
    index("execution_sessions_status_idx").on(table.status),
    index("execution_sessions_user_idx").on(table.telegramUserId),
  ],
);

export const nodeExecutionsTable = pgTable(
  "node_executions",
  {
    id: serial("id").primaryKey(),
    executionId: text("execution_id").notNull(),
    graphId: text("graph_id").notNull(),
    planRevision: integer("plan_revision").notNull(),
    nodeId: text("node_id").notNull(),
    attempt: integer("attempt").default(1).notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    status: text("status").notNull(),
    workerId: text("worker_id"),
    resultJson: text("result_json"),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    isRetryable: boolean("is_retryable").default(false).notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    deadlineAt: timestamp("deadline_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("node_executions_idempotency_idx").on(table.idempotencyKey),
    index("node_executions_graph_node_idx").on(table.graphId, table.planRevision, table.nodeId),
    index("node_executions_status_idx").on(table.status),
  ],
);

export const executionLeasesTable = pgTable(
  "execution_leases",
  {
    id: serial("id").primaryKey(),
    leaseKey: text("lease_key").notNull(),
    executionId: text("execution_id").notNull(),
    graphId: text("graph_id").notNull(),
    planRevision: integer("plan_revision").notNull(),
    nodeId: text("node_id").notNull(),
    workerId: text("worker_id").notNull(),
    attempt: integer("attempt").default(1).notNull(),
    claimedAt: timestamp("claimed_at", { withTimezone: true }).defaultNow().notNull(),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex("execution_leases_lease_key_idx").on(table.leaseKey),
    index("execution_leases_expires_idx").on(table.leaseExpiresAt),
    index("execution_leases_graph_node_idx").on(table.graphId, table.planRevision, table.nodeId),
  ],
);

export const executionApprovalsTable = pgTable(
  "execution_approvals",
  {
    id: serial("id").primaryKey(),
    approvalId: text("approval_id").notNull(),
    telegramUserId: bigint("telegram_user_id", { mode: "number" }).notNull(),
    graphId: text("graph_id").notNull(),
    planRevision: integer("plan_revision").notNull(),
    nodeId: text("node_id").notNull(),
    status: text("status").default("pending").notNull(),
    reason: text("reason").notNull(),
    requestedAt: timestamp("requested_at", { withTimezone: true }).defaultNow().notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    resolvedByUserId: bigint("resolved_by_user_id", { mode: "number" }),
  },
  (table) => [
    uniqueIndex("execution_approvals_approval_id_idx").on(table.approvalId),
    index("execution_approvals_user_idx").on(table.telegramUserId),
    index("execution_approvals_graph_node_idx").on(table.graphId, table.planRevision, table.nodeId),
    index("execution_approvals_status_idx").on(table.status),
  ],
);

export type User = typeof usersTable.$inferSelect;
export type Conversation = typeof conversationsTable.$inferSelect;
export type Message = typeof messagesTable.$inferSelect;
export type UserMemory = typeof userMemoriesTable.$inferSelect;
export type AgentTask = typeof agentTasksTable.$inferSelect;
export type AgentTaskStep = typeof agentTaskStepsTable.$inferSelect;
export type ConversationSummary = typeof conversationSummariesTable.$inferSelect;
export type Reminder = typeof remindersTable.$inferSelect;
export type SystemSetting = typeof systemSettingsTable.$inferSelect;
export type ExecutionGraphRecord = typeof executionGraphsTable.$inferSelect;
export type GraphRevisionRecord = typeof graphRevisionsTable.$inferSelect;
export type ExecutionSessionRecord = typeof executionSessionsTable.$inferSelect;
export type NodeExecutionRecord = typeof nodeExecutionsTable.$inferSelect;
export type ExecutionLeaseRecord = typeof executionLeasesTable.$inferSelect;
export type ExecutionApprovalRecord = typeof executionApprovalsTable.$inferSelect;

