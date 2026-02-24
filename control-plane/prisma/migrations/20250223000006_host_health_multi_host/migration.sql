-- Multi-host: host health, status, dashboard metrics, labels
ALTER TABLE hosts
  ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS last_metrics JSONB,
  ADD COLUMN IF NOT EXISTS labels JSONB;
CREATE INDEX IF NOT EXISTS idx_hosts_org_status ON hosts(org_id, status);

-- Backfill status from last_heartbeat_at (run once after deploy)
-- UPDATE hosts SET status = CASE
--   WHEN last_heartbeat_at >= now() - interval '2 minutes' THEN 'online'
--   WHEN last_heartbeat_at IS NOT NULL THEN 'offline'
--   ELSE 'unknown' END;
