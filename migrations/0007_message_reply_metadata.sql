ALTER TABLE msg_messages
  ADD COLUMN IF NOT EXISTS msg_message_adapter_metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS msg_messages_reply_to_idx
  ON msg_messages (reply_to_msg_message_id)
  WHERE reply_to_msg_message_id IS NOT NULL;
