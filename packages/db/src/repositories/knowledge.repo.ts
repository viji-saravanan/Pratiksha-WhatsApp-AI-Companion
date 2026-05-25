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
    }
  };
}
