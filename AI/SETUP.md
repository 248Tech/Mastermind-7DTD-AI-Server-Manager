# Mastermind — Setup Guide

## Prerequisites
- Node.js 20+, pnpm, Go 1.22+, Docker (for Postgres + Redis)

## Quick Start

### 1. Start Infrastructure
```bash
cd infra
docker-compose up -d   # starts postgres:5432, redis:6379
```

### 2. Control Plane
```bash
cd control-plane
pnpm install

# Set env vars (or create .env)
export DATABASE_URL="postgresql://postgres:postgres@localhost:5432/mastermind"
export REDIS_HOST=localhost
export REDIS_PORT=6379
export JWT_SECRET=your-secret-here
export JWT_AGENT_SECRET=your-agent-secret-here

# Run migrations + seed
npx prisma migrate deploy
npx ts-node prisma/seed.ts

# Start dev server (port 3001)
pnpm dev
```

### 3. Web Frontend
```bash
cd web
pnpm install

# Optional: create .env.local
echo "NEXT_PUBLIC_CONTROL_PLANE_URL=http://localhost:3001" > .env.local

# Start dev server (port 3000)
pnpm dev
```

### 4. Agent Installation (Game Host Machine)

After the control plane is running, go to **Hosts → Pair New Host** in the web UI and generate a pairing token.

Use one of these install paths on the game server host.

#### Option A (recommended for most users, Linux): one-line installer

```bash
CP_URL="http://<control-plane-ip>:3001"
TOKEN="<pairing-token-from-ui>"
HOST_NAME="my-game-host"

curl -fsSL "$CP_URL/install.sh?token=$TOKEN&url=$CP_URL&name=$HOST_NAME" | sudo bash
```

What this does:
- writes `/etc/mastermind-agent/config.yaml`
- starts a `mastermind-agent` container if Docker is installed
- otherwise attempts a local Go build fallback

#### Option B: download a prebuilt agent binary

Available endpoints:
- `GET /agent/download/linux-amd64`
- `GET /agent/download/linux-arm64`
- `GET /agent/download/darwin-amd64`
- `GET /agent/download/darwin-arm64`
- `GET /agent/download/windows-amd64`

Linux example:

```bash
CP_URL="http://<control-plane-ip>:3001"
TOKEN="<pairing-token-from-ui>"

curl -fL "$CP_URL/agent/download/linux-amd64" -o mastermind-agent
chmod +x mastermind-agent
sudo mv mastermind-agent /usr/local/bin/mastermind-agent
sudo mkdir -p /etc/mastermind-agent /var/lib/mastermind-agent

sudo tee /etc/mastermind-agent/config.yaml > /dev/null <<EOF
control_plane_url: "$CP_URL"
pairing_token: "$TOKEN"
agent_key_path: "/var/lib/mastermind-agent/agent.key"
heartbeat:
  interval_sec: 5
jobs:
  poll_interval_sec: 5
  long_poll_sec: 30
host:
  name: "my-game-host"
EOF

sudo /usr/local/bin/mastermind-agent -config /etc/mastermind-agent/config.yaml
```

#### Option C: build from source (advanced)

```bash
git clone <repo-url>
cd Mastermind-7DTD-AI-Server-Manager/agent
go build -o mastermind-agent .
./mastermind-agent -config /path/to/config.yaml
```

Minimum config:

```yaml
control_plane_url: "http://<control-plane-ip>:3001"
pairing_token: "<pairing-token-from-ui>"
agent_key_path: "/var/lib/mastermind-agent/agent.key"
```

## Default Credentials
- **Email:** admin@mastermind.local
- **Password:** changeme

## API Endpoints (Control Plane)

### Auth
- `POST /api/auth/register` — create account
- `POST /api/auth/login` — login, get JWT
- `GET /api/auth/me` — current user + orgs

### Orgs
- `GET /api/orgs` — list user's orgs
- `POST /api/orgs` — create org

### Hosts
- `GET /api/orgs/:orgId/hosts` — list hosts
- `GET /api/orgs/:orgId/hosts/:hostId` — host detail

### Server Instances
- `GET /api/orgs/:orgId/server-instances`
- `POST /api/orgs/:orgId/server-instances`
- `PATCH /api/orgs/:orgId/server-instances/:id`
- `DELETE /api/orgs/:orgId/server-instances/:id`

### Jobs
- `GET /api/orgs/:orgId/jobs` — list jobs
- `POST /api/orgs/:orgId/jobs` — create job (body: { serverInstanceId, type, payload? })
  - Types: start | stop | restart | rcon | custom

### Pairing
- `POST /api/orgs/:orgId/pairing-tokens` — generate pairing token
- `POST /api/agent/pair` — agent pairs with token

### Agent Endpoints (Bearer = agent JWT)
- `POST /api/agent/hosts/:hostId/heartbeat` — heartbeat
- `GET /api/agent/hosts/:hostId/jobs/poll` — poll for next job
- `POST /api/agent/hosts/:hostId/jobs/:jobRunId/result` — submit result

## MVP Flow

1. Login to web UI at http://localhost:3000
2. Go to Hosts → Pair New Host → copy token
3. Put token in agent config.yaml
4. Run agent → it pairs, starts heartbeating
5. Go to Hosts → Register Server → fill form → save
6. Go to Jobs → Create Job → pick server, type=start → submit
7. Agent picks up job, executes, reports result
8. Jobs page auto-refreshes, shows success/failed
