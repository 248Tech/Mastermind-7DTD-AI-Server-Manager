ALTER TABLE "Org" ADD COLUMN "mod_ai_provider" TEXT NOT NULL DEFAULT 'codex';
ALTER TABLE "Org" ADD COLUMN "kimi_api_key_encrypted" TEXT;
ALTER TABLE "Org" ADD COLUMN "kimi_model" TEXT NOT NULL DEFAULT 'kimi-for-coding';
