-- Pairing tokens (single-use, expiry) + agent key version on host for rotation
ALTER TABLE hosts ADD COLUMN IF NOT EXISTS agent_key_version INT NOT NULL DEFAULT 1;
COMMENT ON COLUMN hosts.agent_key_version IS 'Incremented on key rotation; JWT must match';

CREATE TABLE pairing_tokens (
  id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id          TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  token_hash      TEXT NOT NULL,
  expires_at      TIMESTAMPTZ NOT NULL,
  used_at         TIMESTAMPTZ,
  created_by_id   TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  used_by_host_id TEXT UNIQUE REFERENCES hosts(id) ON DELETE SET NULL
);
CREATE INDEX idx_pairing_tokens_org_id ON pairing_tokens(org_id);
CREATE INDEX idx_pairing_tokens_token_hash ON pairing_tokens(token_hash);
CREATE INDEX idx_pairing_tokens_expires_at ON pairing_tokens(expires_at) WHERE used_at IS NULL;
