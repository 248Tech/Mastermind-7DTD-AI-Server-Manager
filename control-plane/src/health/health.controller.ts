import { Controller, Get, Query, Res } from '@nestjs/common';
import { Response } from 'express';

@Controller()
export class HealthController {
  @Get('health')
  getHealth() {
    return { status: 'ok', service: 'control-plane', at: new Date().toISOString() };
  }

  @Get('docs')
  getDocs() {
    return { message: 'API docs (Swagger/OpenAPI) — add @nestjs/swagger for full spec', health: '/health' };
  }

  /**
   * Serves a self-contained bash setup script for the Mastermind agent.
   * Usage: curl -sSL "http://<cp>:3001/install.sh?token=TOKEN&url=http://<cp>:3001&name=my-server" | sudo bash
   */
  @Get('install.sh')
  getInstallScript(
    @Query('token') token = '',
    @Query('url') cpUrl = '',
    @Query('name') hostName = '',
    @Res() res: Response,
  ) {
    const safeName = hostName.replace(/[^a-zA-Z0-9_-]/g, '') || 'my-server';
    const safeCpUrl = cpUrl || 'http://CHANGE_ME:3001';
    const safeToken = token || 'MISSING_TOKEN';

    const script = `#!/usr/bin/env bash
# Mastermind Agent — auto-generated setup script
# Control plane: ${safeCpUrl}
# Token expires in ~10 minutes; run this promptly.
set -e

MASTERMIND_CP_URL="\${MASTERMIND_CP_URL:-${safeCpUrl}}"
MASTERMIND_PAIRING_TOKEN="\${MASTERMIND_PAIRING_TOKEN:-${safeToken}}"
MASTERMIND_HOST_NAME="\${MASTERMIND_HOST_NAME:-${safeName}}"
CONFIG_DIR="/etc/mastermind-agent"
DATA_DIR="/var/lib/mastermind-agent"

echo ""
echo "  Mastermind Agent Setup"
echo "  Control Plane : \$MASTERMIND_CP_URL"
echo "  Host Name     : \$MASTERMIND_HOST_NAME"
echo ""

# ── Write config file ────────────────────────────────────────────────────────
mkdir -p "\$CONFIG_DIR" "\$DATA_DIR"
cat > "\$CONFIG_DIR/config.yaml" <<YAML
control_plane_url: "\$MASTERMIND_CP_URL"
pairing_token: "\$MASTERMIND_PAIRING_TOKEN"
agent_key_path: "\$DATA_DIR/agent.key"
heartbeat:
  interval_sec: 5
jobs:
  poll_interval_sec: 5
  long_poll_sec: 30
host:
  name: "\$MASTERMIND_HOST_NAME"
YAML
chmod 600 "\$CONFIG_DIR/config.yaml"
echo "  ✓ Config written to \$CONFIG_DIR/config.yaml"

# ── Run via Docker if available ───────────────────────────────────────────────
if command -v docker &>/dev/null; then
  echo "  ✓ Docker found — starting agent container"
  docker stop mastermind-agent 2>/dev/null || true
  docker rm   mastermind-agent 2>/dev/null || true
  docker run -d \\
    --name mastermind-agent \\
    --restart unless-stopped \\
    -e MASTERMIND_CP_URL="\$MASTERMIND_CP_URL" \\
    -e MASTERMIND_PAIRING_TOKEN="\$MASTERMIND_PAIRING_TOKEN" \\
    -e MASTERMIND_HOST_NAME="\$MASTERMIND_HOST_NAME" \\
    -v mastermind-agent-data:"\$DATA_DIR" \\
    mastermind-agent
  echo ""
  echo "  Agent started. It will appear in the Mastermind UI within a few seconds."
  echo "  Logs: docker logs -f mastermind-agent"
  exit 0
fi

# ── Fallback: build from source if Go is available ───────────────────────────
if command -v go &>/dev/null; then
  echo "  Docker not found — attempting to build from source (requires repo)"
  if [ ! -f "./agent/main.go" ] && [ ! -f "./main.go" ]; then
    echo ""
    echo "  ERROR: Go is available but the Mastermind agent source was not found."
    echo "  Either clone the repo and re-run, or install Docker first."
    echo ""
    echo "  Config is ready at \$CONFIG_DIR/config.yaml"
    echo "  Once you have the binary: ./mastermind-agent -config \$CONFIG_DIR/config.yaml"
    exit 1
  fi
  SRC_DIR="."
  [ -f "./agent/main.go" ] && SRC_DIR="./agent"
  echo "  Building agent in \$SRC_DIR ..."
  (cd "\$SRC_DIR" && go build -o /usr/local/bin/mastermind-agent ./...)
  echo "  ✓ Built /usr/local/bin/mastermind-agent"

  # Install systemd service if available
  if command -v systemctl &>/dev/null; then
    cat > /etc/systemd/system/mastermind-agent.service <<UNIT
[Unit]
Description=Mastermind Game Server Agent
After=network.target

[Service]
ExecStart=/usr/local/bin/mastermind-agent -config /etc/mastermind-agent/config.yaml
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT
    systemctl daemon-reload
    systemctl enable --now mastermind-agent
    echo "  ✓ Systemd service enabled and started"
  else
    /usr/local/bin/mastermind-agent -config "\$CONFIG_DIR/config.yaml" &
    echo "  ✓ Agent started in background (PID \$!)"
  fi
  echo ""
  echo "  Agent started. It will appear in the Mastermind UI within a few seconds."
  exit 0
fi

# ── Neither Docker nor Go ─────────────────────────────────────────────────────
echo ""
echo "  ERROR: Neither Docker nor Go was found on this machine."
echo "  Install Docker (https://docs.docker.com/get-docker/) then re-run this script."
echo ""
echo "  Config has been written to \$CONFIG_DIR/config.yaml"
echo "  Once you have the agent binary:"
echo "    ./mastermind-agent -config \$CONFIG_DIR/config.yaml"
exit 1
`;

    res.set('Content-Type', 'text/plain; charset=utf-8');
    res.set('Content-Disposition', 'inline; filename="install.sh"');
    res.send(script);
  }
}
