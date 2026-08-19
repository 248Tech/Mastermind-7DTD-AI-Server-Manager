CREATE TABLE "registration_ip_quotas" (
  "ip_hash" TEXT NOT NULL,
  "registration_count" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "registration_ip_quotas_pkey" PRIMARY KEY ("ip_hash"),
  CONSTRAINT "registration_ip_quotas_count_check" CHECK ("registration_count" >= 0 AND "registration_count" <= 2)
);
