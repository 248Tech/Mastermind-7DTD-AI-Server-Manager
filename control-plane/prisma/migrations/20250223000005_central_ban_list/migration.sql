-- Central ban list: org_bans + BanEntry sync fields
CREATE TABLE org_bans (
  id                TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id            TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  identifier_type   TEXT NOT NULL,
  identifier_value  TEXT NOT NULL,
  reason            TEXT,
  banned_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at        TIMESTAMPTZ,
  created_by_id     TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX idx_org_bans_org_identifier ON org_bans(org_id, identifier_type, identifier_value);
CREATE INDEX idx_org_bans_org_id ON org_bans(org_id);

ALTER TABLE ban_entries
  ADD COLUMN IF NOT EXISTS org_ban_id TEXT REFERENCES org_bans(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS sync_status TEXT,
  ADD COLUMN IF NOT EXISTS synced_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_sync_error TEXT,
  ADD COLUMN IF NOT EXISTS last_sync_job_id TEXT;
CREATE INDEX IF NOT EXISTS idx_ban_entries_org_ban_id ON ban_entries(org_ban_id);
CREATE INDEX IF NOT EXISTS idx_ban_entries_server_sync ON ban_entries(server_instance_id, sync_status);
