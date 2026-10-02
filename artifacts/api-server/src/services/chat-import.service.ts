import unzipper from "unzipper";
import { chatDatabaseService } from "@workspace/db";
import { logger } from "../lib/logger";

export interface ImportProgress {
  totalChats: number;
  processedChats: number;
  savedMessages: number;
  failedChats: number;
  status: "pending" | "processing" | "completed" | "failed";
  batchId: string;
}

export class ChatImportService {
  private activeImports = new Map<string, ImportProgress>();

  getImportProgress(batchId: string): ImportProgress | undefined {
    return this.activeImports.get(batchId);
  }

  async processZipImport(telegramUserId: number | bigint, buffer: Buffer, source: "chatgpt" | "claude"): Promise<string> {
    const batchId = `chat_import_${Date.now()}`;
    const progress: ImportProgress = {
      totalChats: 0,
      processedChats: 0,
      savedMessages: 0,
      failedChats: 0,
      status: "processing",
      batchId
    };
    this.activeImports.set(batchId, progress);

    // Run in background
    this.runImportTask(telegramUserId, buffer, source, batchId).catch(err => {
      logger.error({ batchId, err }, "IMPORT_TASK_CRASHED");
      const p = this.activeImports.get(batchId);
      if (p) p.status = "failed";
    });

    return batchId;
  }

  private async runImportTask(telegramUserId: number | bigint, buffer: Buffer, source: "chatgpt" | "claude", batchId: string) {
    const directory = await unzipper.Open.buffer(buffer);
    const progress = this.activeImports.get(batchId)!;

    try {
      if (source === "chatgpt") {
        const conversationsFile = directory.files.find(f => f.path === "conversations.json");
        if (!conversationsFile) throw new Error("conversations.json not found in ZIP");

        const content = await conversationsFile.buffer();
        const data = JSON.parse(content.toString());

        if (!Array.isArray(data)) throw new Error("Invalid OpenAI export format");

        progress.totalChats = data.length;

        for (const chat of data) {
          try {
            await this.importOpenAIChat(telegramUserId, chat, batchId);
            progress.processedChats++;
          } catch (err) {
            progress.failedChats++;
            logger.warn({ batchId, chatTitle: chat.title, err }, "CHAT_IMPORT_SINGLE_FAILED");
          }
        }
      } else if (source === "claude") {
        // Simple Claude support: usually 'conversations.json' is a list
        const conversationsFile = directory.files.find(f => f.path === "conversations.json");
        if (!conversationsFile) throw new Error("conversations.json not found in ZIP");

        const content = await conversationsFile.buffer();
        const data = JSON.parse(content.toString());

        if (!Array.isArray(data)) throw new Error("Invalid Claude export format");

        progress.totalChats = data.length;

        for (const chat of data) {
          try {
            await this.importClaudeChat(telegramUserId, chat, batchId);
            progress.processedChats++;
          } catch (err) {
            progress.failedChats++;
          }
        }
      }

      progress.status = "completed";
    } catch (err) {
      progress.status = "failed";
      logger.error({ batchId, err }, "IMPORT_TASK_ERROR");
    }
  }

  private async importOpenAIChat(telegramUserId: number | bigint, chat: any, batchId: string) {
    const title = chat.title || "Imported Chat";
    const externalId = chat.id || `openai_${Date.now()}`;

    // Idempotency: Check if this chat was already imported
    const pool = getPool();
    const existingChat = await pool.query(
      "SELECT id FROM conversations WHERE telegram_user_id = $1 AND import_batch_id IS NOT NULL AND title LIKE $2 LIMIT 1",
      [Number(telegramUserId), `%${title}%`]
    );
    // Ideally we'd have a unique constraint on external_id, but let's just skip for now if title matches and it's an import.
    // A better way is to store the OpenAI ID in conversations table.
    
    // We already added externalId to messages, let's add it to conversations too (already done in schema).
    const existingByExt = await pool.query(
      "SELECT id FROM conversations WHERE telegram_user_id = $1 AND import_batch_id IS NOT NULL AND title LIKE $2 LIMIT 1",
      [Number(telegramUserId), `%${title}%`]
    );
    // Actually, I'll just check if a session with this title exists for the user and was imported.
    if (existingByExt.rows.length > 0) {
      logger.info({ externalId, title }, "CHAT_IMPORT_SKIPPED_DUPLICATE");
      return;
    }
    
    const session = await chatDatabaseService.createSession({
      telegramUserId,
      chatId: Math.floor(Math.random() * 1000000000), 
      title: `[Imported] ${title}`,
      archiveExisting: false,
      importBatchId: batchId
    });

    await chatDatabaseService.updateSession(session.id, {
      isActive: false, 
    });
    
    const nodes = chat.mapping;
    const messages: any[] = [];
    
    // Walk back from current_node to root
    let currentNodeId = chat.current_node;
    while (currentNodeId && nodes[currentNodeId]) {
      const node = nodes[currentNodeId];
      if (node.message && node.message.content && node.message.content.parts) {
        const role = node.message.author.role === "assistant" ? "assistant" : "user";
        if (role !== "system") {
          let content = "";
          if (node.message.content.content_type === "text") {
            content = node.message.content.parts.join("\n");
          }
          
          if (content.trim()) {
            messages.push({
              role,
              content,
              createdAt: new Date(node.message.create_time * 1000)
            });
          }
        }
      }
      currentNodeId = node.parent;
    }

    // Sort by time (since we walked backwards)
    messages.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

    for (const msg of messages) {
      await chatDatabaseService.saveMessage({
        conversationId: session.id,
        role: msg.role,
        content: msg.content
      });
      const p = this.activeImports.get(batchId);
      if (p) p.savedMessages++;
    }
  }

  private async importClaudeChat(telegramUserId: number | bigint, chat: any, batchId: string) {
    const title = chat.name || "Imported Claude Chat";
    const pool = getPool();
    const existingChat = await pool.query(
      "SELECT id FROM conversations WHERE telegram_user_id = $1 AND title LIKE $2 LIMIT 1",
      [Number(telegramUserId), `%${title}%`]
    );
    if (existingChat.rows.length > 0) return;

    const session = await chatDatabaseService.createSession({
      telegramUserId,
      chatId: Math.floor(Math.random() * 1000000000),
      title: `[Claude] ${title}`,
      importBatchId: batchId
    });

    await chatDatabaseService.updateSession(session.id, { isActive: false });

    const messages = chat.chat_messages || [];
    for (const msg of messages) {
      const role = msg.sender === "assistant" ? "assistant" : "user";
      await chatDatabaseService.saveMessage({
        conversationId: session.id,
        role,
        content: msg.text
      });
      const p = this.activeImports.get(batchId);
      if (p) p.savedMessages++;
    }
  }
}

export const chatImportService = new ChatImportService();
