ALTER TABLE "Org" ADD COLUMN IF NOT EXISTS "maintenance_password_encrypted" TEXT;
ALTER TABLE "ServerInstance" ADD COLUMN IF NOT EXISTS "maintenance_mode" BOOLEAN NOT NULL DEFAULT false;
