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

### 4. Agent (Go)
```bash
cd agent

# Copy and edit config
cp config.yaml.example config.yaml
# Edit: controlPlaneUrl, pairingToken (get from web UI → Hosts → Pair New Host)

# Build
go build -o mastermind-agent ./...

# Run
./mastermind-agent
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
