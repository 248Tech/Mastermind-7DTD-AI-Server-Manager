-- 7DTD server instance fields (single-host MVP)
ALTER TABLE server_instances
  ADD COLUMN IF NOT EXISTS start_command TEXT,
  ADD COLUMN IF NOT EXISTS telnet_host TEXT,
  ADD COLUMN IF NOT EXISTS telnet_port INT,
  ADD COLUMN IF NOT EXISTS telnet_password TEXT;
