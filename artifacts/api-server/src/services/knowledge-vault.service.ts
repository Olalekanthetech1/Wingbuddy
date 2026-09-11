import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "../lib/logger";
import { unifiedModelRegistryService } from "./unified-model-registry.service";
import { aiProviderGatewayService } from "./ai-provider-gateway.service";
import { randomBytes } from "crypto";

export interface KnowledgeDocument {
  id: string;
  telegramUserId: string;
  filename: string;
  mimeType: string;
  content: string;
  createdAt: string;
}

export interface KnowledgeSearchResult {
  documentId: string;
  filename: string;
  content: string;
  similarity: number;
}

export class KnowledgeVaultService {
  private async initTables() {
    // We create these dynamically to ensure we don't interfere with Prisma/Drizzle ORM states.
    // Also we use pgvector if available, otherwise just fallback to JS-level cosine similarity.
    try {
      await db.execute(sql`CREATE EXTENSION IF NOT EXISTS vector;`);
      
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS knowledge_documents (
          id VARCHAR(255) PRIMARY KEY,
          telegram_user_id VARCHAR(255) NOT NULL,
          filename VARCHAR(1024) NOT NULL,
          mime_type VARCHAR(255) NOT NULL,
          content TEXT NOT NULL,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );
      `);

      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS knowledge_chunks (
          id VARCHAR(255) PRIMARY KEY,
          document_id VARCHAR(255) NOT NULL REFERENCES knowledge_documents(id) ON DELETE CASCADE,
          telegram_user_id VARCHAR(255) NOT NULL,
          content TEXT NOT NULL,
          embedding vector(768),
          chunk_index INT NOT NULL,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );
      `);
      
      logger.info("Knowledge Vault tables and vector extensions initialized");
    } catch (error) {
      logger.error({ error: String(error) }, "Failed to initialize Knowledge Vault tables");
    }
  }

  async initialize() {
    await this.initTables();
    void this.reindexUnprocessedDocuments();
  }

  async reindexUnprocessedDocuments() {
    try {
      const unindexed = await db.execute(sql`
        SELECT d.id, d.telegram_user_id as "telegramUserId", d.content
        FROM knowledge_documents d
        LEFT JOIN knowledge_chunks c ON d.id = c.document_id
        WHERE c.id IS NULL
      `);
      const rows = (unindexed.rows || []) as any[];
      if (!rows.length) return;
      logger.info({ count: rows.length }, "Knowledge Vault: re-indexing documents missing vector embeddings");
      for (const row of rows) {
        await this.indexDocumentChunks(row.id, row.telegramUserId, row.content);
      }
    } catch (e) {
      logger.warn({ error: String(e) }, "Knowledge Vault: re-indexing failed");
    }
  }

  // Basic chunking (overlapping)
  private chunkText(text: string, chunkSize: number = 1000, overlap: number = 200): string[] {
    const chunks: string[] = [];
    let i = 0;
    while (i < text.length) {
      chunks.push(text.slice(i, i + chunkSize));
      i += chunkSize - overlap;
    }
    return chunks;
  }

  async indexDocumentChunks(docId: string, telegramUserId: string, content: string): Promise<void> {
    const chunks = this.chunkText(content);
    const models = await unifiedModelRegistryService.list();
    const embedModel = models.find(m => m.enabled && (m.roles.includes("primary_embedding" as any) || m.roles.includes("embedding"))) || models.find(m => m.enabled && m.capabilities.includes("embedding"));
    if (!embedModel) {
      throw new Error("No embedding model configured. Please set a primary embedding model in the dashboard.");
    }

    for (let i = 0; i < chunks.length; i++) {
      const chunkText = chunks[i];
      try {
        const execution = await aiProviderGatewayService.generateEmbeddings(embedModel.provider, {
          model: embedModel.modelId,
          input: chunkText,
          dimensions: 768
        });

        let embedding = execution.result.embeddings[0];
        if (!embedding || !embedding.length) {
          throw new Error("Empty embedding returned");
        }
        if (embedding.length > 768) {
          embedding = embedding.slice(0, 768);
        } else if (embedding.length < 768) {
          embedding = embedding.concat(new Array(768 - embedding.length).fill(0));
        }
        const chunkId = randomBytes(16).toString("hex");
        const vectorStr = '[' + embedding.join(',') + ']';

        await db.execute(sql`
          INSERT INTO knowledge_chunks (id, document_id, telegram_user_id, content, embedding, chunk_index)
          VALUES (${chunkId}, ${docId}, ${telegramUserId}, ${chunkText}, ${vectorStr}::vector, ${i})
        `);
      } catch (e) {
        logger.error({ error: String(e), chunkIndex: i, docId }, "Failed to embed chunk");
      }
    }
  }

  async uploadDocument(telegramUserId: string, filename: string, mimeType: string, content: string) {
    const docId = randomBytes(16).toString("hex");
    
    // 1. Save Document
    await db.execute(sql`
      INSERT INTO knowledge_documents (id, telegram_user_id, filename, mime_type, content)
      VALUES (${docId}, ${telegramUserId}, ${filename}, ${mimeType}, ${content})
    `);

    // 2. Chunk and embed
    await this.indexDocumentChunks(docId, telegramUserId, content);
    
    return docId;
  }

  async listDocuments(telegramUserId: string): Promise<KnowledgeDocument[]> {
    const res = await db.execute(sql`
      SELECT id, telegram_user_id as "telegramUserId", filename, content, mime_type as "mimeType", created_at as "createdAt"
      FROM knowledge_documents
      WHERE telegram_user_id = ${telegramUserId}
      ORDER BY created_at DESC
    `);
    return res.rows as unknown as KnowledgeDocument[];
  }

  async deleteDocument(telegramUserId: string, docId: string) {
    await db.execute(sql`
      DELETE FROM knowledge_documents WHERE id = ${docId} AND telegram_user_id = ${telegramUserId}
    `);
  }

  async searchSimilar(telegramUserId: string, query: string, limit: number = 3): Promise<KnowledgeSearchResult[]> {
    const models = await unifiedModelRegistryService.list();
    const embedModel = models.find(m => m.enabled && (m.roles.includes("primary_embedding" as any) || m.roles.includes("embedding"))) || models.find(m => m.enabled && m.capabilities.includes("embedding"));
    
    if (!embedModel) return [];

    try {
      const execution = await aiProviderGatewayService.generateEmbeddings(embedModel.provider, {
        model: embedModel.modelId,
        input: query,
        dimensions: 768
      });
      let queryEmbedding = execution.result.embeddings[0];
      if (!queryEmbedding || !queryEmbedding.length) return [];
      if (queryEmbedding.length > 768) {
        queryEmbedding = queryEmbedding.slice(0, 768);
      } else if (queryEmbedding.length < 768) {
        queryEmbedding = queryEmbedding.concat(new Array(768 - queryEmbedding.length).fill(0));
      }
      const vectorStr = '[' + queryEmbedding.join(',') + ']';

      // Cosine distance operator is <=>
      const res = await db.execute(sql`
        SELECT 
          c.document_id as "documentId", 
          d.filename, 
          c.content,
          1 - (c.embedding <=> ${vectorStr}::vector) as similarity
        FROM knowledge_chunks c
        JOIN knowledge_documents d ON c.document_id = d.id
        WHERE c.telegram_user_id = ${telegramUserId}
        ORDER BY c.embedding <=> ${vectorStr}::vector
        LIMIT ${limit}
      `);
      
      return res.rows as unknown as KnowledgeSearchResult[];
    } catch (e) {
      logger.error({ error: String(e) }, "Vector search failed");
      return [];
    }
  }
}

export const knowledgeVaultService = new KnowledgeVaultService();
