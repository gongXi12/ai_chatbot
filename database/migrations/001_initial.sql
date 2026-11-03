CREATE TABLE IF NOT EXISTS message_processing (
  message_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('processing', 'completed')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS message_processing_user_id_idx
  ON message_processing (user_id);

CREATE TABLE IF NOT EXISTS conversation_messages (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  text TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS conversation_messages_user_created_idx
  ON conversation_messages (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  type TEXT NOT NULL,
  content TEXT NOT NULL,
  topic TEXT NOT NULL,
  source_message_ids JSONB NOT NULL,
  observed_at TIMESTAMPTZ NOT NULL,
  confidence DOUBLE PRECISION NOT NULL,
  importance DOUBLE PRECISION NOT NULL,
  sensitivity TEXT NOT NULL,
  status TEXT NOT NULL,
  supersedes_memory_id TEXT NULL REFERENCES memories(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS memories_user_status_idx
  ON memories (user_id, status);

CREATE TABLE IF NOT EXISTS relationship_states (
  user_id TEXT PRIMARY KEY,
  stage TEXT NOT NULL,
  familiarity DOUBLE PRECISION NOT NULL,
  trust DOUBLE PRECISION NOT NULL,
  affection DOUBLE PRECISION NOT NULL,
  openness DOUBLE PRECISION NOT NULL,
  tension DOUBLE PRECISION NOT NULL,
  dependency_risk DOUBLE PRECISION NOT NULL,
  intimacy_consent BOOLEAN NOT NULL,
  preferred_nickname TEXT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);