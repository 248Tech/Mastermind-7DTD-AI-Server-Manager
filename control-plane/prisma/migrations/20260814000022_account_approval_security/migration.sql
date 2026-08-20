ALTER TABLE "User"
  ADD COLUMN "approved_at" TIMESTAMP(3),
  ADD COLUMN "approved_by_id" TEXT,
  ADD COLUMN "auth_version" INTEGER NOT NULL DEFAULT 1;

-- Preserve access for accounts that existed before the approval workflow.
UPDATE "User" SET "approved_at" = "created_at" WHERE "approved_at" IS NULL;

-- Retire the well-known development credential if an older installation
-- seeded it. Historical attribution and the membership row remain intact.
UPDATE "User"
SET "password_hash" = NULL,
    "auth_version" = "auth_version" + 1
WHERE lower("email") = 'admin@mastermind.local';

CREATE TABLE "auth_rate_limits" (
  "key_hash" TEXT NOT NULL,
  "failures" INTEGER NOT NULL DEFAULT 0,
  "window_started_at" TIMESTAMP(3) NOT NULL,
  "blocked_until" TIMESTAMP(3),
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "auth_rate_limits_pkey" PRIMARY KEY ("key_hash")
);

CREATE INDEX "auth_rate_limits_updated_at_idx" ON "auth_rate_limits"("updated_at");
