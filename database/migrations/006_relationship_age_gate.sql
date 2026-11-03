ALTER TABLE relationship_states
  ADD COLUMN age_group TEXT NOT NULL DEFAULT 'unknown'
  CHECK (age_group IN ('unknown', 'adult', 'minor'));

ALTER TABLE relationship_states
  ADD COLUMN declared_age INTEGER NULL
  CHECK (declared_age IS NULL OR (declared_age > 0 AND declared_age <= 120));