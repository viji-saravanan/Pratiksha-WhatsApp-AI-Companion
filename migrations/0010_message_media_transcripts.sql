CREATE TABLE IF NOT EXISTS msg_message_media_transcripts (
  msg_message_media_transcript_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_msg_message_media_id uuid NOT NULL
    REFERENCES msg_message_media (msg_message_media_id)
    ON DELETE CASCADE,
  msg_message_media_transcript_status text NOT NULL DEFAULT 'pending',
  msg_message_media_transcript_text text,
  msg_message_media_transcript_language text,
  msg_message_media_transcript_confidence numeric,
  msg_message_media_transcript_duration_ms integer,
  msg_message_media_transcript_model_name text,
  msg_message_media_transcript_error_code text,
  msg_message_media_transcript_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  msg_message_media_transcript_created_at timestamptz NOT NULL DEFAULT now(),
  msg_message_media_transcript_updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT msg_message_media_transcripts_status_chk
    CHECK (
      msg_message_media_transcript_status IN (
        'pending',
        'transcribed',
        'low_confidence',
        'failed',
        'unsupported'
      )
    ),
  CONSTRAINT msg_message_media_transcripts_confidence_chk
    CHECK (
      msg_message_media_transcript_confidence IS NULL OR
      (
        msg_message_media_transcript_confidence >= 0 AND
        msg_message_media_transcript_confidence <= 1
      )
    ),
  CONSTRAINT msg_message_media_transcripts_duration_nonnegative_chk
    CHECK (
      msg_message_media_transcript_duration_ms IS NULL OR
      msg_message_media_transcript_duration_ms >= 0
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS msg_message_media_transcripts_media_unique_idx
  ON msg_message_media_transcripts (parent_msg_message_media_id);

CREATE INDEX IF NOT EXISTS msg_message_media_transcripts_status_updated_idx
  ON msg_message_media_transcripts (
    msg_message_media_transcript_status,
    msg_message_media_transcript_updated_at DESC
  );
