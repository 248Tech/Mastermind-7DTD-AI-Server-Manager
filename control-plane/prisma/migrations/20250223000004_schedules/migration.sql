CREATE TABLE schedules (
  id                      TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id                  TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  server_instance_id      TEXT NOT NULL REFERENCES server_instances(id) ON DELETE CASCADE,
  name                    TEXT NOT NULL,
  description             TEXT,
  cron_expression         TEXT NOT NULL,
  job_type                TEXT NOT NULL,
  payload                 JSONB,
  enabled                 BOOLEAN NOT NULL DEFAULT true,
  execution_window_start  TEXT,
  execution_window_end    TEXT,
  retry_policy            JSONB,
  last_run_at             TIMESTAMPTZ,
  next_run_at             TIMESTAMPTZ,
  last_run_status         TEXT,
  last_run_job_id         TEXT,
  run_count               INT NOT NULL DEFAULT 0,
  failure_count           INT NOT NULL DEFAULT 0,
  created_by_id           TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_schedules_org_id ON schedules(org_id);
CREATE INDEX idx_schedules_server_instance_id ON schedules(server_instance_id);
CREATE INDEX idx_schedules_enabled_next_run ON schedules(enabled, next_run_at);
