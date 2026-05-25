import type { DbExecutor } from "../query.js";
import { queryOne, queryRequired } from "../query.js";

export type KnowledgeSourceType =
  | "local_folder"
  | "local_file"
  | "resource_file_asset"
  | "drive"
  | "url"
  | "manual";

export type KnowledgeDocumentIndexedState =
  | "pending"
  | "extracting"
  | "chunked"
  | "embedded"
  | "failed"
  | "unsupported";

export type KnowledgeDocumentExtractionStatus =
  | "pending"
  | "extracted"
  | "unsupported"
  | "failed";

export interface KnowledgeSourceRecord {
  knowledgeSourceId: string;
  type: KnowledgeSourceType;
  name: string;
  uri: string;
  syncState: "pending" | "syncing" | "indexed" | "failed" | "disabled";
  lastSyncAt: Date | null;
}

export interface KnowledgeDocumentRecord {
  documentId: string;
  knowledgeSourceId: string;
  fileAssetId: string | null;
  title: string;
  mimeType: string;
  contentHash: string;
  versionLabel: string | null;
  indexedState: KnowledgeDocumentIndexedState;
  extractionStatus: KnowledgeDocumentExtractionStatus;
  extractionError: string | null;
  extractorName: string | null;
  extractorVersion: string | null;
  extractorMetadata: Record<string, unknown>;
}

export interface KnowledgeDocumentChunkRecord {
  documentChunkId: string;
  documentId: string;
  chunkIndex: number;
  content: string;
  tokenCount: number | null;
  pageStart: number | null;
  pageEnd: number | null;
  metadata: Record<string, unknown>;
}

export interface KnowledgeEmbeddingModelRecord {
  embeddingModelId: string;
  name: string;
  dimensions: number;
  runtime: "local";
}

export interface KnowledgeEmbeddingRecord {
  embeddingId: string;
  documentChunkId: string | null;
  resourceId: string | null;
  embeddingModelId: string;
  dimensions: number;
  contentHash: string;
}

export interface SemanticResourceMatchRecord {
  resourceId: string;
  registeredFileName: string;
  title: string;
  aliases: string[];
  description: string | null;
  contentSummary: string | null;
  semanticScore: string;
  documentChunkId: string | null;
}

export interface CreateRetrievalRunInput {
  agentRunId: string;
  embeddingModelId: string;
  queryText: string;
  topK: number;
  latencyMs?: number | null;
  chunks: Array<{
    documentChunkId?: string | null;
    resourceId?: string | null;
    rank: number;
    score: number;
    includedInPrompt?: boolean;
  }>;
}

export interface KnowledgeRetrievalRunRecord {
  retrievalRunId: string;
  agentRunId: string;
  embeddingModelId: string;
  queryText: string;
  topK: number;
  latencyMs: number | null;
}

export interface UpsertKnowledgeSourceInput {
  type: KnowledgeSourceType;
  name: string;
  uri: string;
  syncState?: KnowledgeSourceRecord["syncState"];
}

export interface UpsertKnowledgeDocumentInput {
  knowledgeSourceId: string;
  fileAssetId?: string | null;
  title: string;
  mimeType: string;
  contentHash: string;
  versionLabel?: string | null;
  indexedState: KnowledgeDocumentIndexedState;
  extractionStatus: KnowledgeDocumentExtractionStatus;
  extractionError?: string | null;
  extractorName?: string | null;
  extractorVersion?: string | null;
  extractorMetadata?: Record<string, unknown>;
}

export interface ReplaceDocumentChunksInput {
  documentId: string;
  chunks: Array<{
    chunkIndex: number;
    content: string;
    tokenCount?: number | null;
    pageStart?: number | null;
    pageEnd?: number | null;
    metadata?: Record<string, unknown>;
  }>;
}

function sourceReturningSql(): string {
  return `
    kb_knowledge_source_id AS "knowledgeSourceId",
    kb_knowledge_source_type AS "type",
    kb_knowledge_source_name AS "name",
    kb_knowledge_source_uri AS "uri",
    kb_knowledge_source_sync_state AS "syncState",
    kb_knowledge_source_last_sync_at AS "lastSyncAt"
  `;
}

function documentReturningSql(): string {
  return `
    kb_document_id AS "documentId",
    source_kb_knowledge_source_id AS "knowledgeSourceId",
    original_res_file_asset_id AS "fileAssetId",
    kb_document_title AS "title",
    kb_document_mime_type AS "mimeType",
    kb_document_content_hash AS "contentHash",
    kb_document_version_label AS "versionLabel",
    kb_document_indexed_state AS "indexedState",
    kb_document_extraction_status AS "extractionStatus",
    kb_document_extraction_error AS "extractionError",
    kb_document_extractor_name AS "extractorName",
    kb_document_extractor_version AS "extractorVersion",
    kb_document_extractor_metadata AS "extractorMetadata"
  `;
}

function chunkReturningSql(): string {
  return `
    kb_document_chunk_id AS "documentChunkId",
    parent_kb_document_id AS "documentId",
    kb_document_chunk_index AS "chunkIndex",
    kb_document_chunk_content AS "content",
    kb_document_chunk_token_count AS "tokenCount",
    kb_document_chunk_page_start AS "pageStart",
    kb_document_chunk_page_end AS "pageEnd",
    kb_document_chunk_metadata AS "metadata"
  `;
}

function embeddingModelReturningSql(): string {
  return `
    kb_embedding_model_id AS "embeddingModelId",
    kb_embedding_model_name AS "name",
    kb_embedding_model_dimensions AS "dimensions",
    kb_embedding_model_runtime AS "runtime"
  `;
}

function embeddingReturningSql(): string {
  return `
    kb_embedding_id AS "embeddingId",
    target_kb_document_chunk_id AS "documentChunkId",
    target_res_resource_id AS "resourceId",
    model_kb_embedding_model_id AS "embeddingModelId",
    kb_embedding_dimensions AS "dimensions",
    kb_embedding_content_hash AS "contentHash"
  `;
}

function retrievalRunReturningSql(): string {
  return `
    kb_retrieval_run_id AS "retrievalRunId",
    source_agent_run_id AS "agentRunId",
    model_kb_embedding_model_id AS "embeddingModelId",
    kb_retrieval_run_query_text AS "queryText",
    kb_retrieval_run_top_k AS "topK",
    kb_retrieval_run_latency_ms AS "latencyMs"
  `;
}

function pgVectorLiteral(vector: readonly number[]): string {
  return `[${vector.map((value) => {
    if (!Number.isFinite(value)) {
      throw new Error("Embedding vector contains a non-finite value");
    }
    return Number(value).toString();
  }).join(",")}]`;
}

export function createKnowledgeRepository(db: DbExecutor) {
  return {
    async upsertKnowledgeSource(
      input: UpsertKnowledgeSourceInput
    ): Promise<KnowledgeSourceRecord> {
      return queryRequired<KnowledgeSourceRecord>(
        db,
        `
          INSERT INTO kb_knowledge_sources (
            kb_knowledge_source_type,
            kb_knowledge_source_name,
            kb_knowledge_source_uri,
            kb_knowledge_source_sync_state,
            kb_knowledge_source_last_sync_at
          ) VALUES ($1, $2, $3, $4, now())
          ON CONFLICT (kb_knowledge_source_uri) DO UPDATE
          SET
            kb_knowledge_source_type = EXCLUDED.kb_knowledge_source_type,
            kb_knowledge_source_name = EXCLUDED.kb_knowledge_source_name,
            kb_knowledge_source_sync_state =
              EXCLUDED.kb_knowledge_source_sync_state,
            kb_knowledge_source_last_sync_at = now(),
            kb_knowledge_source_updated_at = now()
          RETURNING ${sourceReturningSql()}
        `,
        [
          input.type,
          input.name,
          input.uri,
          input.syncState ?? "indexed"
        ],
        "Failed to upsert knowledge source"
      );
    },

    async upsertKnowledgeDocument(
      input: UpsertKnowledgeDocumentInput
    ): Promise<KnowledgeDocumentRecord> {
      return queryRequired<KnowledgeDocumentRecord>(
        db,
        `
          INSERT INTO kb_documents (
            source_kb_knowledge_source_id,
            original_res_file_asset_id,
            kb_document_title,
            kb_document_mime_type,
            kb_document_content_hash,
            kb_document_version_label,
            kb_document_indexed_state,
            kb_document_extraction_status,
            kb_document_extraction_error,
            kb_document_extractor_name,
            kb_document_extractor_version,
            kb_document_extractor_metadata
          ) VALUES (
            $1,
            $2,
            $3,
            $4,
            $5,
            $6,
            $7,
            $8,
            $9,
            $10,
            $11,
            $12::jsonb
          )
          ON CONFLICT (original_res_file_asset_id)
          WHERE original_res_file_asset_id IS NOT NULL
          DO UPDATE
          SET
            source_kb_knowledge_source_id =
              EXCLUDED.source_kb_knowledge_source_id,
            kb_document_title = EXCLUDED.kb_document_title,
            kb_document_mime_type = EXCLUDED.kb_document_mime_type,
            kb_document_content_hash = EXCLUDED.kb_document_content_hash,
            kb_document_version_label = EXCLUDED.kb_document_version_label,
            kb_document_indexed_state = EXCLUDED.kb_document_indexed_state,
            kb_document_extraction_status =
              EXCLUDED.kb_document_extraction_status,
            kb_document_extraction_error =
              EXCLUDED.kb_document_extraction_error,
            kb_document_extractor_name =
              EXCLUDED.kb_document_extractor_name,
            kb_document_extractor_version =
              EXCLUDED.kb_document_extractor_version,
            kb_document_extractor_metadata =
              EXCLUDED.kb_document_extractor_metadata,
            kb_document_updated_at = now()
          RETURNING ${documentReturningSql()}
        `,
        [
          input.knowledgeSourceId,
          input.fileAssetId ?? null,
          input.title,
          input.mimeType,
          input.contentHash,
          input.versionLabel ?? null,
          input.indexedState,
          input.extractionStatus,
          input.extractionError ?? null,
          input.extractorName ?? null,
          input.extractorVersion ?? null,
          JSON.stringify(input.extractorMetadata ?? {})
        ],
        "Failed to upsert knowledge document"
      );
    },

    async replaceDocumentChunks(
      input: ReplaceDocumentChunksInput
    ): Promise<KnowledgeDocumentChunkRecord[]> {
      await db.query(
        `
          DELETE FROM kb_document_chunks
          WHERE parent_kb_document_id = $1
        `,
        [input.documentId]
      );

      const chunks: KnowledgeDocumentChunkRecord[] = [];
      for (const chunk of input.chunks) {
        chunks.push(
          await queryRequired<KnowledgeDocumentChunkRecord>(
            db,
            `
              INSERT INTO kb_document_chunks (
                parent_kb_document_id,
                kb_document_chunk_index,
                kb_document_chunk_content,
                kb_document_chunk_token_count,
                kb_document_chunk_page_start,
                kb_document_chunk_page_end,
                kb_document_chunk_metadata
              ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
              RETURNING ${chunkReturningSql()}
            `,
            [
              input.documentId,
              chunk.chunkIndex,
              chunk.content,
              chunk.tokenCount ?? null,
              chunk.pageStart ?? null,
              chunk.pageEnd ?? null,
              JSON.stringify(chunk.metadata ?? {})
            ],
            "Failed to insert document chunk"
          )
        );
      }

      return chunks;
    },

    async findDocumentByFileAssetId(
      fileAssetId: string
    ): Promise<KnowledgeDocumentRecord | null> {
      return queryOne<KnowledgeDocumentRecord>(
        db,
        `
          SELECT ${documentReturningSql()}
          FROM kb_documents
          WHERE original_res_file_asset_id = $1
        `,
        [fileAssetId]
      );
    },

    async listDocumentChunks(
      documentId: string
    ): Promise<KnowledgeDocumentChunkRecord[]> {
      const result = await db.query<KnowledgeDocumentChunkRecord>(
        `
          SELECT ${chunkReturningSql()}
          FROM kb_document_chunks
          WHERE parent_kb_document_id = $1
          ORDER BY kb_document_chunk_index ASC
        `,
        [documentId]
      );

      return result.rows;
    },

    async upsertEmbeddingModel(input: {
      name: string;
      dimensions: number;
      runtime?: "local";
    }): Promise<KnowledgeEmbeddingModelRecord> {
      return queryRequired<KnowledgeEmbeddingModelRecord>(
        db,
        `
          INSERT INTO kb_embedding_models (
            kb_embedding_model_name,
            kb_embedding_model_dimensions,
            kb_embedding_model_runtime
          ) VALUES ($1, $2, $3)
          ON CONFLICT (kb_embedding_model_name) DO UPDATE
          SET
            kb_embedding_model_dimensions =
              EXCLUDED.kb_embedding_model_dimensions,
            kb_embedding_model_runtime =
              EXCLUDED.kb_embedding_model_runtime,
            kb_embedding_model_updated_at = now()
          RETURNING ${embeddingModelReturningSql()}
        `,
        [input.name, input.dimensions, input.runtime ?? "local"],
        "Failed to upsert embedding model"
      );
    },

    async findResourceEmbedding(input: {
      resourceId: string;
      embeddingModelId: string;
    }): Promise<KnowledgeEmbeddingRecord | null> {
      return queryOne<KnowledgeEmbeddingRecord>(
        db,
        `
          SELECT ${embeddingReturningSql()}
          FROM kb_embeddings
          WHERE target_res_resource_id = $1
            AND model_kb_embedding_model_id = $2
        `,
        [input.resourceId, input.embeddingModelId]
      );
    },

    async findDocumentChunkEmbedding(input: {
      documentChunkId: string;
      embeddingModelId: string;
    }): Promise<KnowledgeEmbeddingRecord | null> {
      return queryOne<KnowledgeEmbeddingRecord>(
        db,
        `
          SELECT ${embeddingReturningSql()}
          FROM kb_embeddings
          WHERE target_kb_document_chunk_id = $1
            AND model_kb_embedding_model_id = $2
        `,
        [input.documentChunkId, input.embeddingModelId]
      );
    },

    async upsertResourceEmbedding(input: {
      resourceId: string;
      embeddingModelId: string;
      vector: number[];
      contentHash: string;
    }): Promise<KnowledgeEmbeddingRecord> {
      return queryRequired<KnowledgeEmbeddingRecord>(
        db,
        `
          INSERT INTO kb_embeddings (
            target_res_resource_id,
            model_kb_embedding_model_id,
            kb_embedding_vector,
            kb_embedding_dimensions,
            kb_embedding_content_hash
          ) VALUES ($1, $2, $3::vector, $4, $5)
          ON CONFLICT (
            target_res_resource_id,
            model_kb_embedding_model_id
          )
          WHERE target_res_resource_id IS NOT NULL
          DO UPDATE
          SET
            kb_embedding_vector = EXCLUDED.kb_embedding_vector,
            kb_embedding_dimensions = EXCLUDED.kb_embedding_dimensions,
            kb_embedding_content_hash = EXCLUDED.kb_embedding_content_hash,
            kb_embedding_updated_at = now()
          RETURNING ${embeddingReturningSql()}
        `,
        [
          input.resourceId,
          input.embeddingModelId,
          pgVectorLiteral(input.vector),
          input.vector.length,
          input.contentHash
        ],
        "Failed to upsert resource embedding"
      );
    },

    async upsertDocumentChunkEmbedding(input: {
      documentChunkId: string;
      embeddingModelId: string;
      vector: number[];
      contentHash: string;
    }): Promise<KnowledgeEmbeddingRecord> {
      return queryRequired<KnowledgeEmbeddingRecord>(
        db,
        `
          INSERT INTO kb_embeddings (
            target_kb_document_chunk_id,
            model_kb_embedding_model_id,
            kb_embedding_vector,
            kb_embedding_dimensions,
            kb_embedding_content_hash
          ) VALUES ($1, $2, $3::vector, $4, $5)
          ON CONFLICT (
            target_kb_document_chunk_id,
            model_kb_embedding_model_id
          )
          WHERE target_kb_document_chunk_id IS NOT NULL
          DO UPDATE
          SET
            kb_embedding_vector = EXCLUDED.kb_embedding_vector,
            kb_embedding_dimensions = EXCLUDED.kb_embedding_dimensions,
            kb_embedding_content_hash = EXCLUDED.kb_embedding_content_hash,
            kb_embedding_updated_at = now()
          RETURNING ${embeddingReturningSql()}
        `,
        [
          input.documentChunkId,
          input.embeddingModelId,
          pgVectorLiteral(input.vector),
          input.vector.length,
          input.contentHash
        ],
        "Failed to upsert document chunk embedding"
      );
    },

    async searchSemanticResourceMatches(input: {
      modelName: string;
      vector: number[];
      contactId?: string | null;
      limit?: number;
      minScore?: number;
    }): Promise<SemanticResourceMatchRecord[]> {
      const result = await db.query<SemanticResourceMatchRecord>(
        `
          WITH matching_embeddings AS (
            SELECT
              kb_embeddings.target_res_resource_id,
              kb_embeddings.target_kb_document_chunk_id,
              1 - (kb_embeddings.kb_embedding_vector <=> $2::vector)
                AS semantic_score
            FROM kb_embeddings
            INNER JOIN kb_embedding_models
              ON kb_embedding_models.kb_embedding_model_id =
                kb_embeddings.model_kb_embedding_model_id
            WHERE kb_embedding_models.kb_embedding_model_name = $1
              AND kb_embeddings.kb_embedding_dimensions = $3
          ),
          resource_matches AS (
            SELECT
              COALESCE(
                matching_embeddings.target_res_resource_id,
                res_resources.res_resource_id
              ) AS resource_id,
              matching_embeddings.target_kb_document_chunk_id,
              matching_embeddings.semantic_score
            FROM matching_embeddings
            LEFT JOIN kb_document_chunks
              ON kb_document_chunks.kb_document_chunk_id =
                matching_embeddings.target_kb_document_chunk_id
            LEFT JOIN kb_documents
              ON kb_documents.kb_document_id =
                kb_document_chunks.parent_kb_document_id
            LEFT JOIN res_resources
              ON res_resources.backing_res_file_asset_id =
                kb_documents.original_res_file_asset_id
          ),
          ranked_matches AS (
            SELECT DISTINCT ON (resource_matches.resource_id)
              resource_matches.resource_id,
              resource_matches.target_kb_document_chunk_id,
              resource_matches.semantic_score
            FROM resource_matches
            WHERE resource_matches.resource_id IS NOT NULL
            ORDER BY
              resource_matches.resource_id,
              resource_matches.semantic_score DESC,
              resource_matches.target_kb_document_chunk_id NULLS LAST
          )
          SELECT
            res_resources.res_resource_id AS "resourceId",
            res_resources.res_resource_registered_file_name
              AS "registeredFileName",
            res_resources.res_resource_title AS "title",
            res_resources.res_resource_aliases AS "aliases",
            res_resources.res_resource_description AS "description",
            res_resources.res_resource_content_summary AS "contentSummary",
            ranked_matches.semantic_score AS "semanticScore",
            ranked_matches.target_kb_document_chunk_id AS "documentChunkId"
          FROM ranked_matches
          INNER JOIN res_resources
            ON res_resources.res_resource_id = ranked_matches.resource_id
          LEFT JOIN res_file_assets
            ON res_file_assets.res_file_asset_id =
              res_resources.backing_res_file_asset_id
          WHERE res_resources.res_resource_is_active = true
            AND res_resources.res_resource_type = 'file'
            AND ranked_matches.semantic_score >= $5
            AND (
              res_resources.backing_res_file_asset_id IS NULL OR
              res_file_assets.res_file_asset_storage_state = 'available'
            )
            AND (
              res_resources.res_resource_allowed_contact_ids IS NULL OR
              $4::uuid = ANY(res_resources.res_resource_allowed_contact_ids)
            )
          ORDER BY
            ranked_matches.semantic_score DESC,
            res_resources.res_resource_registered_file_name ASC
          LIMIT $6
        `,
        [
          input.modelName,
          pgVectorLiteral(input.vector),
          input.vector.length,
          input.contactId ?? null,
          input.minScore ?? 0.72,
          input.limit ?? 5
        ]
      );

      return result.rows;
    },

    async createRetrievalRun(
      input: CreateRetrievalRunInput
    ): Promise<KnowledgeRetrievalRunRecord> {
      const run = await queryRequired<KnowledgeRetrievalRunRecord>(
        db,
        `
          INSERT INTO kb_retrieval_runs (
            source_agent_run_id,
            model_kb_embedding_model_id,
            kb_retrieval_run_query_text,
            kb_retrieval_run_top_k,
            kb_retrieval_run_latency_ms
          ) VALUES ($1, $2, $3, $4, $5)
          RETURNING ${retrievalRunReturningSql()}
        `,
        [
          input.agentRunId,
          input.embeddingModelId,
          input.queryText,
          input.topK,
          input.latencyMs ?? null
        ],
        "Failed to create retrieval run"
      );

      for (const chunk of input.chunks) {
        await db.query(
          `
            INSERT INTO kb_retrieval_chunks (
              parent_kb_retrieval_run_id,
              target_kb_document_chunk_id,
              target_res_resource_id,
              kb_retrieval_chunk_rank,
              kb_retrieval_chunk_score,
              kb_retrieval_chunk_included_in_prompt
            ) VALUES ($1, $2, $3, $4, $5, $6)
          `,
          [
            run.retrievalRunId,
            chunk.documentChunkId ?? null,
            chunk.resourceId ?? null,
            chunk.rank,
            chunk.score,
            chunk.includedInPrompt ?? false
          ]
        );
      }

      return run;
    }
  };
}
