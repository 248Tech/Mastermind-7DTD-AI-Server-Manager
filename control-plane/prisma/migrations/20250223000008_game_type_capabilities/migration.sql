-- Add capabilities to game_types for UI: list of supported adapter actions (start, stop, send_command, etc.)
ALTER TABLE game_types ADD COLUMN IF NOT EXISTS capabilities JSONB;

COMMENT ON COLUMN game_types.capabilities IS 'Array of capability slugs for this game type; UI renders only these actions.';
