-- Encrypted Stripe secret key and webhook signing secret for org-scoped donations.
ALTER TABLE "Org" ADD COLUMN "stripe_secret_key_encrypted" TEXT;
ALTER TABLE "Org" ADD COLUMN "stripe_webhook_secret_encrypted" TEXT;
