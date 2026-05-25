CREATE TABLE IF NOT EXISTS kb_embedding_models (
  kb_embedding_model_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kb_embedding_model_name text NOT NULL,
  kb_embedding_model_dimensions integer NOT NULL,
  kb_embedding_model_runtime text NOT NULL DEFAULT 'local',
  kb_embedding_model_created_at timestamptz NOT NULL DEFAULT now(),
  kb_embedding_model_updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT kb_embedding_models_name_nonempty_chk
    CHECK (length(btrim(kb_embedding_model_name)) > 0),
  CONSTRAINT kb_embedding_models_dimensions_positive_chk
    CHECK (kb_embedding_model_dimensions > 0),
  CONSTRAINT kb_embedding_models_runtime_chk
    CHECK (kb_embedding_model_runtime IN ('local'))
);

CREATE UNIQUE INDEX IF NOT EXISTS kb_embedding_models_name_unique_idx
  ON kb_embedding_models (kb_embedding_model_name);

CREATE TABLE IF NOT EXISTS kb_embeddings (
  kb_embedding_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_kb_document_chunk_id uuid
    REFERENCES kb_document_chunks (kb_document_chunk_id)
    ON DELETE CASCADE,
  target_res_resource_id uuid
    REFERENCES res_resources (res_resource_id)
    ON DELETE CASCADE,
  model_kb_embedding_model_id uuid NOT NULL
    REFERENCES kb_embedding_models (kb_embedding_model_id),
  kb_embedding_vector vector NOT NULL,
  kb_embedding_dimensions integer NOT NULL,
  kb_embedding_content_hash text NOT NULL,
  kb_embedding_created_at timestamptz NOT NULL DEFAULT now(),
  kb_embedding_updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT kb_embeddings_single_target_chk
    CHECK (
      (
        target_kb_document_chunk_id IS NOT NULL AND
        target_res_resource_id IS NULL
      ) OR (
        target_kb_document_chunk_id IS NULL AND
        target_res_resource_id IS NOT NULL
      )
    ),
  CONSTRAINT kb_embeddings_dimensions_positive_chk
    CHECK (kb_embedding_dimensions > 0),
  CONSTRAINT kb_embeddings_content_hash_nonempty_chk
    CHECK (length(btrim(kb_embedding_content_hash)) > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS kb_embeddings_chunk_model_unique_idx
  ON kb_embeddings (
    target_kb_document_chunk_id,
    model_kb_embedding_model_id
  )
  WHERE target_kb_document_chunk_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS kb_embeddings_resource_model_unique_idx
  ON kb_embeddings (
    target_res_resource_id,
    model_kb_embedding_model_id
  )
  WHERE target_res_resource_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS kb_embeddings_model_dimensions_idx
  ON kb_embeddings (
    model_kb_embedding_model_id,
    kb_embedding_dimensions
  );

CREATE INDEX IF NOT EXISTS kb_embeddings_vector_1024_cosine_idx
  ON kb_embeddings
  USING hnsw ((kb_embedding_vector::vector(1024)) vector_cosine_ops)
  WHERE kb_embedding_dimensions = 1024;

CREATE TABLE IF NOT EXISTS kb_retrieval_runs (
  kb_retrieval_run_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_agent_run_id uuid NOT NULL
    REFERENCES agent_runs (agent_run_id)
    ON DELETE CASCADE,
  model_kb_embedding_model_id uuid NOT NULL
    REFERENCES kb_embedding_models (kb_embedding_model_id),
  kb_retrieval_run_query_text text NOT NULL,
  kb_retrieval_run_top_k integer NOT NULL,
  kb_retrieval_run_latency_ms integer,
  kb_retrieval_run_created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT kb_retrieval_runs_query_nonempty_chk
    CHECK (length(btrim(kb_retrieval_run_query_text)) > 0),
  CONSTRAINT kb_retrieval_runs_top_k_positive_chk
    CHECK (kb_retrieval_run_top_k > 0),
  CONSTRAINT kb_retrieval_runs_latency_nonnegative_chk
    CHECK (
      kb_retrieval_run_latency_ms IS NULL OR
      kb_retrieval_run_latency_ms >= 0
    )
);

CREATE INDEX IF NOT EXISTS kb_retrieval_runs_agent_created_idx
  ON kb_retrieval_runs (
    source_agent_run_id,
    kb_retrieval_run_created_at DESC
  );

CREATE TABLE IF NOT EXISTS kb_retrieval_chunks (
  kb_retrieval_chunk_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_kb_retrieval_run_id uuid NOT NULL
    REFERENCES kb_retrieval_runs (kb_retrieval_run_id)
    ON DELETE CASCADE,
  target_kb_document_chunk_id uuid
    REFERENCES kb_document_chunks (kb_document_chunk_id),
  target_res_resource_id uuid
    REFERENCES res_resources (res_resource_id),
  kb_retrieval_chunk_rank integer NOT NULL,
  kb_retrieval_chunk_score numeric NOT NULL,
  kb_retrieval_chunk_included_in_prompt boolean NOT NULL DEFAULT false,
  kb_retrieval_chunk_created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT kb_retrieval_chunks_single_target_chk
    CHECK (
      target_kb_document_chunk_id IS NOT NULL OR
      target_res_resource_id IS NOT NULL
    ),
  CONSTRAINT kb_retrieval_chunks_rank_positive_chk
    CHECK (kb_retrieval_chunk_rank > 0),
  CONSTRAINT kb_retrieval_chunks_score_range_chk
    CHECK (
      kb_retrieval_chunk_score >= -1 AND
      kb_retrieval_chunk_score <= 1
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS kb_retrieval_chunks_run_rank_unique_idx
  ON kb_retrieval_chunks (
    parent_kb_retrieval_run_id,
    kb_retrieval_chunk_rank
  );
