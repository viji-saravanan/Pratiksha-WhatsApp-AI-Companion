CREATE TABLE IF NOT EXISTS kb_knowledge_sources (
  kb_knowledge_source_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kb_knowledge_source_type text NOT NULL,
  kb_knowledge_source_name text NOT NULL,
  kb_knowledge_source_uri text NOT NULL,
  kb_knowledge_source_sync_state text NOT NULL DEFAULT 'pending',
  kb_knowledge_source_last_sync_at timestamptz,
  kb_knowledge_source_created_at timestamptz NOT NULL DEFAULT now(),
  kb_knowledge_source_updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT kb_knowledge_sources_type_chk
    CHECK (
      kb_knowledge_source_type IN (
        'local_folder',
        'local_file',
        'resource_file_asset',
        'drive',
        'url',
        'manual'
      )
    ),
  CONSTRAINT kb_knowledge_sources_sync_state_chk
    CHECK (
      kb_knowledge_source_sync_state IN (
        'pending',
        'syncing',
        'indexed',
        'failed',
        'disabled'
      )
    ),
  CONSTRAINT kb_knowledge_sources_name_nonempty_chk
    CHECK (length(btrim(kb_knowledge_source_name)) > 0),
  CONSTRAINT kb_knowledge_sources_uri_nonempty_chk
    CHECK (length(btrim(kb_knowledge_source_uri)) > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS kb_knowledge_sources_uri_unique_idx
  ON kb_knowledge_sources (kb_knowledge_source_uri);

CREATE TABLE IF NOT EXISTS kb_documents (
  kb_document_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_kb_knowledge_source_id uuid NOT NULL
    REFERENCES kb_knowledge_sources (kb_knowledge_source_id),
  original_res_file_asset_id uuid
    REFERENCES res_file_assets (res_file_asset_id),
  kb_document_title text NOT NULL,
  kb_document_mime_type text NOT NULL,
  kb_document_content_hash text NOT NULL,
  kb_document_version_label text,
  kb_document_indexed_state text NOT NULL DEFAULT 'pending',
  kb_document_extraction_status text NOT NULL DEFAULT 'pending',
  kb_document_extraction_error text,
  kb_document_extractor_name text,
  kb_document_extractor_version text,
  kb_document_extractor_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  kb_document_created_at timestamptz NOT NULL DEFAULT now(),
  kb_document_updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT kb_documents_title_nonempty_chk
    CHECK (length(btrim(kb_document_title)) > 0),
  CONSTRAINT kb_documents_hash_nonempty_chk
    CHECK (length(btrim(kb_document_content_hash)) > 0),
  CONSTRAINT kb_documents_indexed_state_chk
    CHECK (
      kb_document_indexed_state IN (
        'pending',
        'extracting',
        'chunked',
        'embedded',
        'failed',
        'unsupported'
      )
    ),
  CONSTRAINT kb_documents_extraction_status_chk
    CHECK (
      kb_document_extraction_status IN (
        'pending',
        'extracted',
        'unsupported',
        'failed'
      )
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS kb_documents_source_hash_unique_idx
  ON kb_documents (
    source_kb_knowledge_source_id,
    kb_document_content_hash
  );

CREATE UNIQUE INDEX IF NOT EXISTS kb_documents_file_asset_unique_idx
  ON kb_documents (original_res_file_asset_id)
  WHERE original_res_file_asset_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS kb_documents_state_idx
  ON kb_documents (
    kb_document_indexed_state,
    kb_document_extraction_status,
    kb_document_updated_at DESC
  );

CREATE TABLE IF NOT EXISTS kb_document_chunks (
  kb_document_chunk_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_kb_document_id uuid NOT NULL
    REFERENCES kb_documents (kb_document_id)
    ON DELETE CASCADE,
  kb_document_chunk_index integer NOT NULL,
  kb_document_chunk_content text NOT NULL,
  kb_document_chunk_token_count integer,
  kb_document_chunk_page_start integer,
  kb_document_chunk_page_end integer,
  kb_document_chunk_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  kb_document_chunk_created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT kb_document_chunks_index_nonnegative_chk
    CHECK (kb_document_chunk_index >= 0),
  CONSTRAINT kb_document_chunks_content_nonempty_chk
    CHECK (length(btrim(kb_document_chunk_content)) > 0),
  CONSTRAINT kb_document_chunks_token_count_positive_chk
    CHECK (
      kb_document_chunk_token_count IS NULL OR
      kb_document_chunk_token_count > 0
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS kb_document_chunks_index_unique_idx
  ON kb_document_chunks (
    parent_kb_document_id,
    kb_document_chunk_index
  );
