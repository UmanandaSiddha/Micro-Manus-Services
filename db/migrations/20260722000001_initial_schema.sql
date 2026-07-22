-- migrate:up
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE users (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email           text NOT NULL UNIQUE,
  name            text,
  image           text,
  oauth_provider  text NOT NULL CHECK (oauth_provider IN ('google','github')),
  oauth_id        text NOT NULL,
  credits         int  NOT NULL DEFAULT 0 CHECK (credits >= 0),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (oauth_provider, oauth_id)
);

CREATE TABLE api_keys (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider        text NOT NULL CHECK (provider IN ('openai','anthropic','moonshot','openrouter')),
  base_url        text NOT NULL,
  key_ciphertext  text NOT NULL,
  key_hint        text NOT NULL,
  models          jsonb NOT NULL DEFAULT '[]',
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, provider)
);

CREATE TABLE threads (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title       text NOT NULL DEFAULT 'New chat',
  model_id    text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX threads_user_idx ON threads (user_id, updated_at DESC);

CREATE TABLE messages (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id    uuid NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  role         text NOT NULL CHECK (role IN ('user','assistant','tool')),
  content      text NOT NULL DEFAULT '',
  tool_calls   jsonb,
  tool_call_id text,
  archived     boolean NOT NULL DEFAULT false,
  token_count  int,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX messages_thread_idx ON messages (thread_id, created_at);

CREATE TABLE runs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id    uuid NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  model_id     text NOT NULL,
  status       text NOT NULL DEFAULT 'running' CHECK (status IN ('running','done','failed')),
  steps        jsonb NOT NULL DEFAULT '[]',
  error        text,
  started_at   timestamptz NOT NULL DEFAULT now(),
  finished_at  timestamptz
);
CREATE INDEX runs_thread_idx ON runs (thread_id, started_at);

CREATE TABLE summaries (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id         uuid NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  content           text NOT NULL,
  embedding         vector(1024),
  first_message_id  uuid NOT NULL,
  last_message_id   uuid NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX summaries_thread_idx ON summaries (thread_id);

CREATE TABLE chunks (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  artifact_id  uuid NOT NULL,
  content      text NOT NULL,
  embedding    vector(1024),
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE artifacts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id   uuid NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  run_id      uuid REFERENCES runs(id) ON DELETE SET NULL,
  type        text NOT NULL CHECK (type IN ('pdf','md','html','csv','json','txt','xlsx')),
  title       text NOT NULL,
  file_path   text NOT NULL,
  content_md  text,
  size_bytes  int,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX artifacts_thread_idx ON artifacts (thread_id);

CREATE TABLE usage_events (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  thread_id          uuid NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  run_id             uuid REFERENCES runs(id) ON DELETE SET NULL,
  model_id           text NOT NULL,
  input_tokens       int NOT NULL DEFAULT 0,
  output_tokens      int NOT NULL DEFAULT 0,
  cache_read_tokens  int NOT NULL DEFAULT 0,
  cache_write_tokens int NOT NULL DEFAULT 0,
  cost_usd           numeric(12,6) NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX usage_thread_idx ON usage_events (thread_id);
CREATE INDEX usage_user_idx   ON usage_events (user_id, created_at);

CREATE TABLE credit_ledger (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  delta       int  NOT NULL,
  reason      text NOT NULL CHECK (reason IN ('purchase','coupon','run','refund')),
  ref_id      text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ledger_user_idx ON credit_ledger (user_id, created_at);

CREATE TABLE redemptions (
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, code)
);

CREATE TABLE stripe_events (
  event_id    text PRIMARY KEY,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- migrate:down
DROP TABLE IF EXISTS stripe_events, redemptions, credit_ledger, usage_events,
  artifacts, chunks, summaries, runs, messages, threads, api_keys, users CASCADE;
DROP EXTENSION IF EXISTS vector;
