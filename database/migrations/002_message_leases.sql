ALTER TABLE message_processing ADD COLUMN claim_id TEXT NULL;
ALTER TABLE message_processing ADD COLUMN result JSONB NULL;