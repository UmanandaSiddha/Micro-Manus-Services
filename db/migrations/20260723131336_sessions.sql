-- migrate:up

-- Refresh-token sessions (ovlox_v3 pattern): the browser holds
-- `${sessionId}.${token}`; only the HMAC of the token is stored. Rotation on
-- refresh keeps prev_hash valid for a short grace window (concurrent tabs).
CREATE TABLE sessions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  refresh_hash  text NOT NULL,
  prev_hash     text,
  rotated_at    timestamptz,
  expires_at    timestamptz NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user_idx ON sessions (user_id);

-- migrate:down

DROP TABLE sessions;
