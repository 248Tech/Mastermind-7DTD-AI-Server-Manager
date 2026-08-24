ALTER TABLE "auth_rate_limits"
  ADD COLUMN "lockout_level" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "Org"
  ADD COLUMN "recaptcha_site_key" TEXT,
  ADD COLUMN "recaptcha_secret_encrypted" TEXT;
