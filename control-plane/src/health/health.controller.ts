import * as fs from 'fs';
import * as path from 'path';
import { Controller, Get, NotFoundException, Param, Query, Res } from '@nestjs/common';
import { Response } from 'express';

const pkg = { name: 'mastermind-control-plane', version: '0.0.3' };
const PLATFORM_FILES: Record<string, string> = {
  'linux-amd64':   'mastermind-agent-linux-amd64',
  'linux-arm64':   'mastermind-agent-linux-arm64',
  'darwin-amd64':  'mastermind-agent-darwin-amd64',
  'darwin-arm64':  'mastermind-agent-darwin-arm64',
  'windows-amd64': 'mastermind-agent-windows-amd64.exe',
};

@Controller()
export class HealthController {
  @Get()
  getRoot() {
    return {
      service: 'Mastermind 7DTD Server Manager — Control Plane',
      version: pkg.version,
      status: 'ok',
      at: new Date().toISOString(),
      endpoints: {
        health: 'GET /health',
        docs: 'GET /docs',
        auth: {
          register: 'POST /api/auth/register',
          login: 'POST /api/auth/login',
          me: 'GET /api/auth/me',
        },
        orgs: {
          list: 'GET /api/orgs',
          create: 'POST /api/orgs',
          get: 'GET /api/orgs/:orgId',
          update: 'PATCH /api/orgs/:orgId',
        },
        hosts: {
          list: 'GET /api/orgs/:orgId/hosts',
          get: 'GET /api/orgs/:orgId/hosts/:hostId',
          heartbeat: 'POST /api/agent/hosts/:hostId/heartbeat',
        },
        pairing: {
          generate: 'POST /api/orgs/:orgId/pairing-tokens',
          pair: 'POST /api/agent/pair',
        },
        serverInstances: {
          list: 'GET /api/orgs/:orgId/server-instances',
          create: 'POST /api/orgs/:orgId/server-instances',
          get: 'GET /api/orgs/:orgId/server-instances/:id',
          update: 'PATCH /api/orgs/:orgId/server-instances/:id',
          delete: 'DELETE /api/orgs/:orgId/server-instances/:id',
        },
        jobs: {
          list: 'GET /api/orgs/:orgId/jobs',
          create: 'POST /api/orgs/:orgId/jobs',
          agentPoll: 'GET /api/agent/hosts/:hostId/jobs/poll',
          agentResult: 'POST /api/agent/hosts/:hostId/jobs/:jobRunId/result',
        },
        schedules: {
          list: 'GET /api/orgs/:orgId/schedules',
          create: 'POST /api/orgs/:orgId/schedules',
          update: 'PATCH /api/orgs/:orgId/schedules/:id',
          delete: 'DELETE /api/orgs/:orgId/schedules/:id',
        },
        alerts: {
          list: 'GET /api/orgs/:orgId/alerts',
          create: 'POST /api/orgs/:orgId/alerts',
          update: 'PATCH /api/orgs/:orgId/alerts/:id',
          delete: 'DELETE /api/orgs/:orgId/alerts/:id',
        },
        gameTypes: 'GET /api/game-types',
        agentInstall: 'GET /install.sh?token=TOKEN&url=URL&name=NAME',
        agentDownload: 'GET /agent/download/:platform',
        agentDownloadZip: 'GET /agent/download/:platform/zip',
        agentBundleZip: 'GET /agent/download/:platform/bundle.zip?token=TOKEN&url=URL&name=NAME',
      },
    };
  }

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
  (cd "\$SRC_DIR" && go build -o /usr/local/bin/mastermind-agent .)
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

  /**
   * Serves pre-built agent binaries built by scripts/start.sh.
   * Binaries live at control-plane/public/agents/<filename>.
   *
   * Platforms:
   *   linux-amd64, linux-arm64, darwin-amd64, darwin-arm64, windows-amd64
   *
   * Usage:
   *   curl -LO "http://<cp>:3001/agent/download/linux-amd64"
   */
  @Get('agent/download/:platform')
  downloadAgent(@Param('platform') platform: string, @Res() res: Response) {
    const { filePath } = resolveAgentBinaryPath(platform);

    const stat = fs.statSync(filePath);
    const isWindows = platform.startsWith('windows');
    const downloadName = isWindows ? 'mastermind-agent.exe' : 'mastermind-agent';

    res.set('Content-Type', 'application/octet-stream');
    res.set('Content-Disposition', `attachment; filename="${downloadName}"`);
    res.set('Content-Length', String(stat.size));
    fs.createReadStream(filePath).pipe(res);
  }

  /**
   * Serves a ZIP package containing the pre-built agent binary.
   * Useful for browsers/environments that block direct executable downloads.
   */
  @Get('agent/download/:platform/zip')
  downloadAgentZip(@Param('platform') platform: string, @Res() res: Response) {
    const { filename, filePath } = resolveAgentBinaryPath(platform);
    const isWindows = platform.startsWith('windows');
    const entryName = isWindows ? 'mastermind-agent.exe' : 'mastermind-agent';
    const zipFileName = `${filename}.zip`;
    const fileData = fs.readFileSync(filePath);
    const zipBuffer = createSingleFileZip(entryName, fileData);

    res.set('Content-Type', 'application/zip');
    res.set('Content-Disposition', `attachment; filename="${zipFileName}"`);
    res.set('Content-Length', String(zipBuffer.length));
    res.send(zipBuffer);
  }

  /**
   * Serves a full deployment bundle ZIP:
   * - agent binary
   * - sample config.yaml
   * - systemd unit file
   * - quick install README
   *
   * Optional query params prefill config values:
   *   token, url, name
   */
  @Get('agent/download/:platform/bundle.zip')
  downloadAgentBundle(
    @Param('platform') platform: string,
    @Query('token') token = '',
    @Query('url') cpUrl = '',
    @Query('name') hostName = '',
    @Res() res: Response,
  ) {
    const { filename, filePath } = resolveAgentBinaryPath(platform);
    const isWindows = platform.startsWith('windows');
    const binaryName = isWindows ? 'mastermind-agent.exe' : 'mastermind-agent';
    const safeCpUrl = cpUrl || 'http://CHANGE_ME:3001';
    const safeToken = token || 'REPLACE_WITH_PAIRING_TOKEN';
    const safeName = sanitizeHostName(hostName);
    const bundleRoot = `mastermind-agent-${platform}-bundle`;
    const bundleFileName = `${filename}-bundle.zip`;

    const binaryData = fs.readFileSync(filePath);
    const configYaml = buildSampleConfigYaml({
      cpUrl: safeCpUrl,
      token: safeToken,
      hostName: safeName,
      isWindows,
    });
    const systemdUnit = buildSystemdUnit();
    const readme = buildBundleReadme({
      platform,
      cpUrl: safeCpUrl,
      token: safeToken,
      hostName: safeName,
      isWindows,
    });

    const zipBuffer = createZip([
      { name: `${bundleRoot}/${binaryName}`, data: binaryData },
      { name: `${bundleRoot}/config.yaml`, data: Buffer.from(configYaml, 'utf8') },
      { name: `${bundleRoot}/mastermind-agent.service`, data: Buffer.from(systemdUnit, 'utf8') },
      { name: `${bundleRoot}/README.md`, data: Buffer.from(readme, 'utf8') },
    ]);

    res.set('Content-Type', 'application/zip');
    res.set('Content-Disposition', `attachment; filename="${bundleFileName}"`);
    res.set('Content-Length', String(zipBuffer.length));
    res.send(zipBuffer);
  }
}

function resolveAgentBinaryPath(platform: string): { filename: string; filePath: string } {
  const filename = PLATFORM_FILES[platform];
  if (!filename) {
    throw new NotFoundException(
      `Unknown platform "${platform}". Valid: ${Object.keys(PLATFORM_FILES).join(', ')}`,
    );
  }

  // Binaries are written to control-plane/public/agents/ by scripts/bootstrap/start.
  const agentsDir = path.join(process.cwd(), 'public', 'agents');
  const filePath = path.join(agentsDir, filename);
  if (!fs.existsSync(filePath)) {
    throw new NotFoundException(
      `Agent binary for "${platform}" is not available yet. Run make bootstrap (or scripts/bootstrap) to build it.`,
    );
  }

  return { filename, filePath };
}

function createSingleFileZip(entryName: string, data: Buffer): Buffer {
  return createZip([{ name: entryName, data }]);
}

function createZip(entries: { name: string; data: Buffer }[]): Buffer {
  if (!entries.length) {
    throw new Error('createZip requires at least one entry');
  }

  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const fileName = Buffer.from(entry.name, 'utf8');
    const crc = crc32(entry.data);
    const { dosDate, dosTime } = toDosDateTime(new Date());

    const localHeader = Buffer.alloc(30 + fileName.length);
    localHeader.writeUInt32LE(0x04034b50, 0); // local file header signature
    localHeader.writeUInt16LE(20, 4); // version needed to extract
    localHeader.writeUInt16LE(0, 6); // general purpose bit flag
    localHeader.writeUInt16LE(0, 8); // compression method: stored
    localHeader.writeUInt16LE(dosTime, 10); // mod time
    localHeader.writeUInt16LE(dosDate, 12); // mod date
    localHeader.writeUInt32LE(crc, 14); // crc-32
    localHeader.writeUInt32LE(entry.data.length, 18); // compressed size
    localHeader.writeUInt32LE(entry.data.length, 22); // uncompressed size
    localHeader.writeUInt16LE(fileName.length, 26); // file name length
    localHeader.writeUInt16LE(0, 28); // extra field length
    fileName.copy(localHeader, 30);

    localParts.push(localHeader, entry.data);

    const centralHeader = Buffer.alloc(46 + fileName.length);
    centralHeader.writeUInt32LE(0x02014b50, 0); // central file header signature
    centralHeader.writeUInt16LE(20, 4); // version made by
    centralHeader.writeUInt16LE(20, 6); // version needed to extract
    centralHeader.writeUInt16LE(0, 8); // general purpose bit flag
    centralHeader.writeUInt16LE(0, 10); // compression method: stored
    centralHeader.writeUInt16LE(dosTime, 12); // mod time
    centralHeader.writeUInt16LE(dosDate, 14); // mod date
    centralHeader.writeUInt32LE(crc, 16); // crc-32
    centralHeader.writeUInt32LE(entry.data.length, 20); // compressed size
    centralHeader.writeUInt32LE(entry.data.length, 24); // uncompressed size
    centralHeader.writeUInt16LE(fileName.length, 28); // file name length
    centralHeader.writeUInt16LE(0, 30); // extra field length
    centralHeader.writeUInt16LE(0, 32); // file comment length
    centralHeader.writeUInt16LE(0, 34); // disk number start
    centralHeader.writeUInt16LE(0, 36); // internal file attributes
    centralHeader.writeUInt32LE(0, 38); // external file attributes
    centralHeader.writeUInt32LE(offset, 42); // relative offset of local header
    fileName.copy(centralHeader, 46);
    centralParts.push(centralHeader);

    offset += localHeader.length + entry.data.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); // end of central dir signature
  end.writeUInt16LE(0, 4); // number of this disk
  end.writeUInt16LE(0, 6); // number of the disk with the start of the central directory
  end.writeUInt16LE(entries.length, 8); // total number of entries in central dir on this disk
  end.writeUInt16LE(entries.length, 10); // total number of entries in central dir
  end.writeUInt32LE(centralDirectory.length, 12); // size of central directory
  end.writeUInt32LE(offset, 16); // offset of start of central directory
  end.writeUInt16LE(0, 20); // zip file comment length

  return Buffer.concat([...localParts, centralDirectory, end]);
}

function toDosDateTime(date: Date): { dosDate: number; dosTime: number } {
  const year = Math.max(date.getFullYear(), 1980);
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const seconds = Math.floor(date.getSeconds() / 2);

  const dosDate = ((year - 1980) << 9) | (month << 5) | day;
  const dosTime = (hours << 11) | (minutes << 5) | seconds;
  return { dosDate, dosTime };
}

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const b of data) {
    crc ^= b;
    for (let i = 0; i < 8; i++) {
      crc = (crc & 1) !== 0 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function sanitizeHostName(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9_-]/g, '');
  return cleaned || 'my-server';
}

function buildSampleConfigYaml(input: {
  cpUrl: string;
  token: string;
  hostName: string;
  isWindows: boolean;
}): string {
  const keyPath = input.isWindows ? 'C:\\\\Mastermind\\\\agent.key' : '/var/lib/mastermind-agent/agent.key';
  return `control_plane_url: "${input.cpUrl}"
pairing_token: "${input.token}"
agent_key_path: "${keyPath}"
heartbeat:
  interval_sec: 5
jobs:
  poll_interval_sec: 5
  long_poll_sec: 30
host:
  name: "${input.hostName}"
`;
}

function buildSystemdUnit(): string {
  return `[Unit]
Description=Mastermind Game Server Agent
After=network.target

[Service]
ExecStart=/usr/local/bin/mastermind-agent -config /etc/mastermind-agent/config.yaml
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
`;
}

function buildBundleReadme(input: {
  platform: string;
  cpUrl: string;
  token: string;
  hostName: string;
  isWindows: boolean;
}): string {
  const binaryName = input.isWindows ? 'mastermind-agent.exe' : 'mastermind-agent';
  const serviceNote = input.isWindows
    ? `Note: 'mastermind-agent.service' is for Linux/systemd and is not used on Windows.`
    : `Use 'mastermind-agent.service' to run the agent on boot via systemd.`;

  return `# Mastermind Agent Bundle (${input.platform})

This bundle contains:
- ${binaryName}
- config.yaml (sample, prefilled)
- mastermind-agent.service (Linux/systemd)
- README.md (this file)

Prefilled values:
- control_plane_url: ${input.cpUrl}
- pairing_token: ${input.token}
- host.name: ${input.hostName}

## Quick install (Linux)
1. Move binary into place:
   - \`sudo install -m 0755 ./${binaryName} /usr/local/bin/mastermind-agent\`
2. Create config directory and copy config:
   - \`sudo mkdir -p /etc/mastermind-agent /var/lib/mastermind-agent\`
   - \`sudo cp ./config.yaml /etc/mastermind-agent/config.yaml\`
3. (Optional) edit \`/etc/mastermind-agent/config.yaml\` if needed.
4. Install and start systemd service:
   - \`sudo cp ./mastermind-agent.service /etc/systemd/system/mastermind-agent.service\`
   - \`sudo systemctl daemon-reload\`
   - \`sudo systemctl enable --now mastermind-agent\`
5. Check status/logs:
   - \`systemctl status mastermind-agent\`
   - \`journalctl -u mastermind-agent -f\`

## Quick install (Windows)
1. Copy \`${binaryName}\` and \`config.yaml\` to \`C:\\Mastermind\\\`.
2. Edit \`config.yaml\` if needed.
3. Run:
   - \`C:\\Mastermind\\${binaryName} -config C:\\Mastermind\\config.yaml\`

${serviceNote}
`;
}
