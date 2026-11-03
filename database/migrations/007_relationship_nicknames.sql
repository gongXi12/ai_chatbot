ALTER TABLE relationship_states
  ADD COLUMN preferred_nicknames TEXT[] NULL;

UPDATE relationship_states
  SET preferred_nicknames = ARRAY[preferred_nickname]
  WHERE preferred_nickname IS NOT NULL;

ALTER TABLE relationship_states
  DROP COLUMN preferred_nickname;
