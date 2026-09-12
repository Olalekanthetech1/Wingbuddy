import { logger } from "../lib/logger";

export type ArtifactType = "image" | "video" | "audio" | "document" | "json" | "text";
export type ArtifactLifecycle = "active" | "persisted" | "expired" | "deleted";

export interface ArtifactMetadata {
  width?: number;
  height?: number;
  aspectRatio?: string;
  durationSeconds?: number;
  fileSizeBytes?: number;
  format?: string;
  hash?: string;
  tags?: string[];
  annotations?: Record<string, unknown>;
}

export interface ArtifactGenerationProvenance {
  model: string;
  provider: string;
  parameters: Record<string, unknown>;
  prompt?: string;
  referenceArtifactIds?: string[];
  jobId?: string;
  executionDurationMs?: number;
}

export interface UniversalArtifact {
  id: string;
  type: ArtifactType;
  mimeType: string;
  uri: string;
  publicUrl?: string;
  sourceNodeId?: string;
  graphId?: string;
  planRevision?: number;
  executionId?: string;
  metadata: ArtifactMetadata;
  generation: ArtifactGenerationProvenance;
  createdAt: string;
  updatedAt: string;
  lifecycle: ArtifactLifecycle;
}

export interface ArtifactQueryFilter {
  type?: ArtifactType;
  graphId?: string;
  executionId?: string;
  sourceNodeId?: string;
  lifecycle?: ArtifactLifecycle;
}

class UniversalArtifactService {
  private readonly artifacts = new Map<string, UniversalArtifact>();
  private readonly MAX_IN_MEMORY = 500;

  /**
   * Registers a provider-neutral artifact in the authoritative registry.
   */
  register(input: {
    id?: string;
    type: ArtifactType;
    mimeType: string;
    uri: string;
    publicUrl?: string;
    sourceNodeId?: string;
    graphId?: string;
    planRevision?: number;
    executionId?: string;
    metadata?: ArtifactMetadata;
    generation: ArtifactGenerationProvenance;
  }): UniversalArtifact {
    const id = input.id || `art_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const now = new Date().toISOString();

    const artifact: UniversalArtifact = {
      id,
      type: input.type,
      mimeType: input.mimeType,
      uri: input.uri,
      publicUrl: input.publicUrl || (input.uri.startsWith("http") ? input.uri : undefined),
      sourceNodeId: input.sourceNodeId,
      graphId: input.graphId,
      planRevision: input.planRevision,
      executionId: input.executionId,
      metadata: input.metadata || {},
      generation: {
        ...input.generation,
        parameters: input.generation.parameters || {},
      },
      createdAt: now,
      updatedAt: now,
      lifecycle: "active",
    };

    if (this.artifacts.size >= this.MAX_IN_MEMORY) {
      const oldestKey = this.artifacts.keys().next().value;
      if (oldestKey) this.artifacts.delete(oldestKey);
    }

    this.artifacts.set(id, artifact);

    logger.info(
      {
        artifactId: id,
        type: artifact.type,
        model: artifact.generation.model,
        provider: artifact.generation.provider,
        sourceNodeId: artifact.sourceNodeId,
      },
      "UNIVERSAL_ARTIFACT_REGISTERED",
    );

    return artifact;
  }

  get(id: string): UniversalArtifact | undefined {
    return this.artifacts.get(id);
  }

  list(filter?: ArtifactQueryFilter): UniversalArtifact[] {
    let items = Array.from(this.artifacts.values());
    if (!filter) return items;

    if (filter.type) items = items.filter((a) => a.type === filter.type);
    if (filter.graphId) items = items.filter((a) => a.graphId === filter.graphId);
    if (filter.executionId) items = items.filter((a) => a.executionId === filter.executionId);
    if (filter.sourceNodeId) items = items.filter((a) => a.sourceNodeId === filter.sourceNodeId);
    if (filter.lifecycle) items = items.filter((a) => a.lifecycle === filter.lifecycle);

    return items;
  }

  listAllArtifacts(): UniversalArtifact[] {
    return this.list();
  }

  listArtifactsForExecution(executionId: string): UniversalArtifact[] {
    return this.list({ executionId });
  }

  getSummary(): { total: number; active: number; byType: Record<string, number> } {
    const all = this.list();
    const byType: Record<string, number> = {};
    let active = 0;

    for (const art of all) {
      byType[art.type] = (byType[art.type] || 0) + 1;
      if (art.lifecycle === "active") active++;
    }

    return {
      total: all.length,
      active,
      byType,
    };
  }

  updateLifecycle(id: string, lifecycle: ArtifactLifecycle): UniversalArtifact | undefined {
    const artifact = this.artifacts.get(id);
    if (!artifact) return undefined;
    artifact.lifecycle = lifecycle;
    artifact.updatedAt = new Date().toISOString();
    return artifact;
  }
}

export const universalArtifactService = new UniversalArtifactService();
