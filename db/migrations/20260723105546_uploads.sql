-- migrate:up
CREATE TABLE uploads (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  thread_id     uuid REFERENCES threads(id) ON DELETE CASCADE,
  filename      text NOT NULL,
  mime          text NOT NULL,
  size_bytes    int  NOT NULL,
  url           text NOT NULL,        -- /public/uploads/{id}.{ext}
  text_content  text,                 -- extracted text for text-like files (agent context)
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX uploads_thread_idx ON uploads (thread_id, created_at);

-- migrate:down
DROP TABLE IF EXISTS uploads;
