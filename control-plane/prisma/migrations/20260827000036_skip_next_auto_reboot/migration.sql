ALTER TABLE "Schedule" ADD COLUMN IF NOT EXISTS "skip_next_run" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Schedule" ADD COLUMN IF NOT EXISTS "skip_next_run_reason" TEXT;
ALTER TABLE "Schedule" ADD COLUMN IF NOT EXISTS "skip_next_run_requested_at" TIMESTAMP(3);
