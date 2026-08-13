ALTER TABLE "Org" ADD COLUMN "openai_api_key_encrypted" TEXT;
ALTER TABLE "Org" ADD COLUMN "openai_model" TEXT NOT NULL DEFAULT 'gpt-5-codex';
