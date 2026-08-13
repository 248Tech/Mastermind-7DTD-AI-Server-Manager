ALTER TABLE "Org" ALTER COLUMN "openai_model" SET DEFAULT 'gpt-5.3-codex';
UPDATE "Org" SET "openai_model" = 'gpt-5.3-codex' WHERE "openai_model" = 'gpt-5-codex';
