CREATE TABLE "ServerProtectionSettings" (
  "id" TEXT NOT NULL,
  "server_instance_id" TEXT NOT NULL,
  "high_ping_enabled" BOOLEAN NOT NULL DEFAULT false,
  "high_ping_threshold_ms" INTEGER NOT NULL DEFAULT 250,
  "high_ping_samples" INTEGER NOT NULL DEFAULT 3,
  "high_ping_reason" TEXT NOT NULL DEFAULT 'Connection latency remained too high',
  "country_ban_enabled" BOOLEAN NOT NULL DEFAULT false,
  "blocked_country_codes" JSONB NOT NULL DEFAULT '[]',
  "country_action" TEXT NOT NULL DEFAULT 'kick',
  "country_ban_duration" TEXT NOT NULL DEFAULT '365 days',
  "country_reason" TEXT NOT NULL DEFAULT 'Connections from your country are not allowed',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ServerProtectionSettings_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ServerProtectionSettings_server_instance_id_key" ON "ServerProtectionSettings"("server_instance_id");
ALTER TABLE "ServerProtectionSettings" ADD CONSTRAINT "ServerProtectionSettings_server_instance_id_fkey" FOREIGN KEY ("server_instance_id") REFERENCES "ServerInstance"("id") ON DELETE CASCADE ON UPDATE CASCADE;
