CREATE TABLE relationship_observations (
  user_id TEXT NOT NULL REFERENCES relationship_states(user_id) ON DELETE CASCADE,
  message_id TEXT NOT NULL,
  observed_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (user_id, message_id)
);