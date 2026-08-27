CREATE TABLE "triggers" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "server_instance_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "event_type" TEXT NOT NULL,
    "event_config" JSONB NOT NULL,
    "action_type" TEXT NOT NULL,
    "action_config" JSONB NOT NULL,
    "apply_to_existing" BOOLEAN NOT NULL DEFAULT false,
    "last_fired_at" TIMESTAMP(3),
    "fire_count" INTEGER NOT NULL DEFAULT 0,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "triggers_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "trigger_fires" (
    "id" TEXT NOT NULL,
    "trigger_id" TEXT NOT NULL,
    "player_id" TEXT NOT NULL,
    "event_key" TEXT NOT NULL,
    "job_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trigger_fires_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "triggers_org_id_idx" ON "triggers"("org_id");
CREATE INDEX "triggers_server_instance_id_enabled_idx" ON "triggers"("server_instance_id", "enabled");
CREATE UNIQUE INDEX "trigger_fires_trigger_id_player_id_event_key_key" ON "trigger_fires"("trigger_id", "player_id", "event_key");
CREATE INDEX "trigger_fires_trigger_id_created_at_idx" ON "trigger_fires"("trigger_id", "created_at" DESC);

ALTER TABLE "triggers" ADD CONSTRAINT "triggers_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "Org"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "triggers" ADD CONSTRAINT "triggers_server_instance_id_fkey" FOREIGN KEY ("server_instance_id") REFERENCES "ServerInstance"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "triggers" ADD CONSTRAINT "triggers_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "trigger_fires" ADD CONSTRAINT "trigger_fires_trigger_id_fkey" FOREIGN KEY ("trigger_id") REFERENCES "triggers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "trigger_fires" ADD CONSTRAINT "trigger_fires_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;
