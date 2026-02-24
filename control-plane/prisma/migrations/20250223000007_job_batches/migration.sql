-- Bulk server operations: job_batches + Job.batchId
CREATE TABLE job_batches (
  id               TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id           TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  type             TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'running',
  total_count      INT NOT NULL,
  pending_count    INT NOT NULL DEFAULT 0,
  running_count    INT NOT NULL DEFAULT 0,
  success_count    INT NOT NULL DEFAULT 0,
  failed_count     INT NOT NULL DEFAULT 0,
  cancelled_count  INT NOT NULL DEFAULT 0,
  created_by_id    TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at     TIMESTAMPTZ
);
CREATE INDEX idx_job_batches_org_id ON job_batches(org_id);
CREATE INDEX idx_job_batches_org_created ON job_batches(org_id, created_at DESC);
CREATE INDEX idx_job_batches_status ON job_batches(status);

ALTER TABLE jobs ADD COLUMN IF NOT EXISTS batch_id TEXT REFERENCES job_batches(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_jobs_batch_id ON jobs(batch_id);
