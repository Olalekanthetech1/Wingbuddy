import { chatDatabaseService } from "@workspace/db";
import { getDefaultGeminiService } from "../gemini/gemini.service";
import { logger } from "../lib/logger";

export interface IndexingProgress {
  total: number;
  processed: number;
  failed: number;
  status: "processing" | "completed" | "failed";
}

export class SemanticSearchService {
  private activeJobs = new Map<string, IndexingProgress>();

  getIndexingProgress(jobId: string): IndexingProgress | undefined {
    return this.activeJobs.get(jobId);
  }

  async indexConversation(conversationId: number): Promise<string> {
    const jobId = `index_${conversationId}_${Date.now()}`;
    const progress: IndexingProgress = {
      total: 0,
      processed: 0,
      failed: 0,
      status: "processing"
    };
    this.activeJobs.set(jobId, progress);

    // Run in background
    this.runIndexingTask(conversationId, jobId).catch(err => {
      logger.error({ conversationId, err }, "INDEXING_TASK_CRASHED");
      const p = this.activeJobs.get(jobId);
      if (p) p.status = "failed";
    });

    return jobId;
  }

  private async runIndexingTask(conversationId: number, jobId: string) {
    const messages = await chatDatabaseService.getMessagesForConversation(conversationId);
    const progress = this.activeJobs.get(jobId)!;
    progress.total = messages.length;

    const gemini = getDefaultGeminiService();

    for (const msg of messages) {
      if (msg.embeddingJson) {
        progress.processed++;
        continue;
      }

      try {
        const embedding = await gemini.embedText(msg.content);
        if (embedding && embedding.length > 0) {
          await chatDatabaseService.updateMessageEmbedding(msg.id, embedding);
          progress.processed++;
        } else {
          progress.failed++;
        }
      } catch (err) {
        progress.failed++;
        logger.warn({ messageId: msg.id, err }, "EMBEDDING_FAILED");
      }
      
      // Update state in map to allow polling
      this.activeJobs.set(jobId, { ...progress });
      
      // Avoid rate limits
      await new Promise(r => setTimeout(r, 100));
    }

    progress.status = "completed";
    this.activeJobs.set(jobId, { ...progress });
  }
}

export const semanticSearchService = new SemanticSearchService();
