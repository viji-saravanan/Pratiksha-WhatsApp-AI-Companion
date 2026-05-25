import { createHash } from "node:crypto";

import {
  createEmbeddingClientFromEnv,
  type EmbeddingClient
} from "@viji/ai";
import {
  createRepositories,
  type DbExecutor,
  type FileResourceRecord,
  type KnowledgeDocumentChunkRecord,
  type SemanticResourceMatchRecord
} from "@viji/db";
import type { SemanticResourceMatch } from "@viji/resources";
import { ERROR_CODES, type AppLogger } from "@viji/shared";

export interface ResourceSemanticConfig {
  enabled: boolean;
  modelName: string;
  minScore: number;
  indexLimit: number;
  chunkLimitPerResource: number;
  searchLimit: number;
}

export interface FindSemanticResourceMatchesInput {
  queryText: string;
  contactId?: string | null;
  agentRunId?: string | null;
  env?: NodeJS.ProcessEnv;
  embeddingClient?: EmbeddingClient;
  logger?: AppLogger;
}

const DEFAULT_EMBEDDING_MODEL = "mxbai-embed-large";

function booleanFromEnv(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }

  return value === "true";
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function numberInRange(
  value: string | undefined,
  fallback: number,
  min: number,
  max: number
): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= min && parsed <= max
    ? parsed
    : fallback;
}

function contentHash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function resourceEmbeddingText(resource: FileResourceRecord): string {
  return [
    resource.registeredFileName,
    resource.title,
    ...(resource.aliases ?? []),
    resource.description ?? "",
    resource.contentSummary ?? ""
  ]
    .join("\n")
    .replace(/\s+/g, " ")
    .trim();
}

function chunkEmbeddingText(chunk: KnowledgeDocumentChunkRecord): string {
  return chunk.content.replace(/\s+/g, " ").trim();
}

function semanticMatchesFromRecords(
  records: readonly SemanticResourceMatchRecord[]
): SemanticResourceMatch[] {
  return records.map((record) => ({
    resourceId: record.resourceId,
    semanticScore: Number(record.semanticScore),
    documentChunkId: record.documentChunkId
  }));
}

export function getResourceSemanticConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env
): ResourceSemanticConfig {
  return {
    enabled: booleanFromEnv(env.VIJI_RESOURCE_SEMANTIC_ENABLED, true),
    modelName:
      env.VIJI_RESOURCE_EMBEDDING_MODEL ||
      env.VIJI_OLLAMA_EMBEDDING_MODEL ||
      DEFAULT_EMBEDDING_MODEL,
    minScore: numberInRange(env.VIJI_RESOURCE_SEMANTIC_MIN_SCORE, 0.72, -1, 1),
    indexLimit: positiveInteger(env.VIJI_RESOURCE_EMBEDDING_INDEX_LIMIT, 50),
    chunkLimitPerResource: positiveInteger(
      env.VIJI_RESOURCE_EMBEDDING_CHUNK_LIMIT_PER_RESOURCE,
      8
    ),
    searchLimit: positiveInteger(env.VIJI_RESOURCE_SEMANTIC_SEARCH_LIMIT, 10)
  };
}

async function ensureResourceEmbedding(input: {
  db: DbExecutor;
  resource: FileResourceRecord;
  embeddingModelId: string;
  modelName: string;
  embeddingClient: EmbeddingClient;
}): Promise<void> {
  const repositories = createRepositories(input.db);
  const text = resourceEmbeddingText(input.resource);
  if (!text) {
    return;
  }

  const hash = contentHash(text);
  const existing = await repositories.knowledge.findResourceEmbedding({
    resourceId: input.resource.resourceId,
    embeddingModelId: input.embeddingModelId
  });
  if (existing?.contentHash === hash) {
    return;
  }

  const embedding = await input.embeddingClient.embedText({
    text,
    modelName: input.modelName
  });
  await repositories.knowledge.upsertResourceEmbedding({
    resourceId: input.resource.resourceId,
    embeddingModelId: input.embeddingModelId,
    vector: embedding.vector,
    contentHash: hash
  });
}

async function ensureChunkEmbeddings(input: {
  db: DbExecutor;
  resource: FileResourceRecord;
  embeddingModelId: string;
  modelName: string;
  embeddingClient: EmbeddingClient;
  limit: number;
}): Promise<void> {
  if (!input.resource.fileAssetId) {
    return;
  }

  const repositories = createRepositories(input.db);
  const document = await repositories.knowledge.findDocumentByFileAssetId(
    input.resource.fileAssetId
  );
  if (!document || document.extractionStatus !== "extracted") {
    return;
  }

  const chunks = await repositories.knowledge.listDocumentChunks(
    document.documentId
  );
  for (const chunk of chunks.slice(0, input.limit)) {
    const text = chunkEmbeddingText(chunk);
    if (!text) {
      continue;
    }

    const hash = contentHash(text);
    const existing = await repositories.knowledge.findDocumentChunkEmbedding({
      documentChunkId: chunk.documentChunkId,
      embeddingModelId: input.embeddingModelId
    });
    if (existing?.contentHash === hash) {
      continue;
    }

    const embedding = await input.embeddingClient.embedText({
      text,
      modelName: input.modelName
    });
    await repositories.knowledge.upsertDocumentChunkEmbedding({
      documentChunkId: chunk.documentChunkId,
      embeddingModelId: input.embeddingModelId,
      vector: embedding.vector,
      contentHash: hash
    });
  }
}

export async function findSemanticResourceMatches(
  db: DbExecutor,
  input: FindSemanticResourceMatchesInput
): Promise<SemanticResourceMatch[]> {
  const startedAt = Date.now();
  const config = getResourceSemanticConfigFromEnv(input.env);
  if (!config.enabled || !input.queryText.trim()) {
    return [];
  }

  const repositories = createRepositories(db);
  const embeddingClient =
    input.embeddingClient ?? createEmbeddingClientFromEnv(input.env);

  try {
    const queryEmbedding = await embeddingClient.embedText({
      text: input.queryText,
      modelName: config.modelName
    });
    const model = await repositories.knowledge.upsertEmbeddingModel({
      name: queryEmbedding.modelName,
      dimensions: queryEmbedding.dimensions,
      runtime: "local"
    });
    const resources = await repositories.resources.listSearchableFileResources({
      contactId: input.contactId,
      limit: config.indexLimit
    });

    for (const resource of resources) {
      await ensureResourceEmbedding({
        db,
        resource,
        embeddingModelId: model.embeddingModelId,
        modelName: model.name,
        embeddingClient
      });
      await ensureChunkEmbeddings({
        db,
        resource,
        embeddingModelId: model.embeddingModelId,
        modelName: model.name,
        embeddingClient,
        limit: config.chunkLimitPerResource
      });
    }

    const matches = await repositories.knowledge.searchSemanticResourceMatches({
      modelName: model.name,
      vector: queryEmbedding.vector,
      contactId: input.contactId,
      limit: config.searchLimit,
      minScore: config.minScore
    });

    if (input.agentRunId) {
      await repositories.knowledge.createRetrievalRun({
        agentRunId: input.agentRunId,
        embeddingModelId: model.embeddingModelId,
        queryText: input.queryText,
        topK: config.searchLimit,
        latencyMs: Date.now() - startedAt,
        chunks: matches.map((match, index) => ({
          documentChunkId: match.documentChunkId,
          resourceId: match.resourceId,
          rank: index + 1,
          score: Number(match.semanticScore),
          includedInPrompt: false
        }))
      });
    }

    return semanticMatchesFromRecords(matches);
  } catch (error) {
    input.logger?.warn("resource.semantic_retrieval_failed", {
      errorCode:
        error && typeof error === "object" && "code" in error
          ? String((error as { code?: unknown }).code)
          : ERROR_CODES.ai.modelUnavailable,
      message: error instanceof Error ? error.message : "semantic retrieval failed"
    });
    return [];
  }
}
