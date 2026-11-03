CREATE TABLE outbound_deliveries (
  delivery_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  channel TEXT NOT NULL,
  account_id TEXT NOT NULL,
  inbound_message_id TEXT NOT NULL,
  bubble_index INTEGER NOT NULL CHECK (bubble_index >= 0),
  client_id TEXT NOT NULL UNIQUE,
  delivered_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX outbound_deliveries_user_id_idx
  ON outbound_deliveries (user_id);
