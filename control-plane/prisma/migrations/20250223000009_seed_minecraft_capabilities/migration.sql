-- Seed Minecraft game type with MVP capabilities (RCON, start/stop, kick/ban, player list).
-- Idempotent: insert if missing, update capabilities if exists.
INSERT INTO game_types (id, slug, name, capabilities, created_at)
VALUES (
  gen_random_uuid()::text,
  'minecraft',
  'Minecraft',
  '["start","stop","restart","status","send_command","kick_player","ban_player","get_log_path"]'::jsonb,
  now()
)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  capabilities = EXCLUDED.capabilities;
