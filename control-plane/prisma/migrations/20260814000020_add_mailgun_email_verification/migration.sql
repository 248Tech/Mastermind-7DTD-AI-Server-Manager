ALTER TABLE "Org"
  ADD COLUMN "mailgun_api_key_encrypted" TEXT,
  ADD COLUMN "mailgun_domain" TEXT,
  ADD COLUMN "mailgun_from_email" TEXT,
  ADD COLUMN "mailgun_region" TEXT NOT NULL DEFAULT 'us';

ALTER TABLE "User"
  ADD COLUMN "email_verified_at" TIMESTAMP(3),
  ADD COLUMN "email_verification_sent_at" TIMESTAMP(3);

-- Preserve access for accounts that existed before email verification.
UPDATE "User" SET "email_verified_at" = CURRENT_TIMESTAMP;
