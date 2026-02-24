CREATE TABLE command_macros (
  id                  TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id              TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  name                TEXT NOT NULL,
  description         TEXT,
  job_type            TEXT NOT NULL,
  payload_template    JSONB NOT NULL,
  param_definitions   JSONB NOT NULL,
  server_instance_id  TEXT REFERENCES server_instances(id) ON DELETE SET NULL,
  allowed_role_names  JSONB NOT NULL,
  created_by_id       TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_command_macros_org_id ON command_macros(org_id);
CREATE INDEX idx_command_macros_server_instance_id ON command_macros(server_instance_id);
