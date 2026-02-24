# Mastermind — 7DTD AI Server Manager

**Control Plane + Host Agent** for managing 7 Days to Die (and other game) servers. Instead of SSH’ing into each box, you run a small agent on every host; the control plane sends jobs (start, stop, restart, RCON, etc.) and the agent runs them locally. This gives you a single dashboard, RBAC, audit logs, and optional Discord alerts.

---

## Architecture overview

```
    ┌─────────────────────────────────────────────────────────────────┐
    │                     CONTROL PLANE (NestJS)                       │
    │  Web (Next.js) ◄── API + WebSocket ◄── Postgres + Redis/BullMQ   │
    └─────────────────────────────────────────────────────────────────┘
        │                    │
        │ HTTPS/WS           │ Job queue / heartbeat
        ▼                    ▼
    ┌─────────────────────────────────────────────────────────────────┐
    │  HOST: Agent (Go) — pairing, heartbeat, job runner, game adapters │
    │         ◄──────────────────────────────────────────────────────►  │
    │                        Game server (7DTD, etc.)                   │
    └─────────────────────────────────────────────────────────────────┘
```

- **Control plane:** REST API, WebSocket, Postgres (orgs, hosts, server instances, jobs, schedules), Redis/BullMQ (job queues), Discord alerts, pairing tokens, RBAC.
- **Web:** Next.js UI — dashboard, server list, pairing, jobs, alerts.
- **Agent:** Go binary on each game host — pairs with a one-time token, heartbeats, polls for jobs, runs them via game adapters (7DTD, Minecraft, etc.).

---

## Tech stack

| Layer           | Tech                          |
|----------------|-------------------------------|
| Control plane  | NestJS, TypeScript, Prisma, BullMQ |
| Web            | Next.js 14, React, TypeScript |
| Agent          | Go 1.22+                      |
| Data           | PostgreSQL 16, Redis 7       |
| Local dev      | Docker Compose                |

---

## Repo layout

```
├── control-plane/    # NestJS API (REST + WS), Prisma, jobs, pairing, alerts
├── web/              # Next.js frontend
├── agent/            # Go host agent (pairing, heartbeat, job runner)
├── infra/            # Docker Compose for local dev
├── docs/             # Architecture, security, design docs
├── prompts/          # Prompt library
├── scripts/          # bootstrap.sh, dev.sh, doctor.sh
├── .github/          # Issue/PR templates
├── Makefile          # make bootstrap, up, down, logs, test
├── pnpm-workspace.yaml
└── README.md
```

---

## Prerequisites

- **Node.js** 20 LTS (or 20.x)
- **pnpm** 9.x (`corepack enable && corepack prepare pnpm@latest --activate`)
- **Go** 1.22+ (for building the agent)
- **Docker** and **Docker Compose** v2 (for Postgres, Redis, and optional full stack)

---

## Quickstart (copy-paste)

```bash
git clone https://github.com/YOUR_ORG/mastermind-7dtd-ai-server-manager.git
cd mastermind-7dtd-ai-server-manager

# 1. Install tools check (optional)
./scripts/doctor.sh

# 2. Bootstrap: install deps, copy .env files
make bootstrap
# or: ./scripts/bootstrap.sh

# 3. Start Postgres + Redis (required for control plane)
make up
# or: cd infra && docker compose up -d
# (Optionally start control-plane + web in Docker: docker compose --profile full up -d)

# 4. Run migrations (first time only)
cd control-plane && pnpm prisma migrate deploy
# If using raw SQL migrations, run them in order (see control-plane/prisma/migrations/README-migration-order.md)

# 5. Start control plane and web (separate terminals)
cd control-plane && pnpm dev    # → http://localhost:3001
cd web && pnpm dev              # → http://localhost:3000
```

Open **http://localhost:3000** — you should see the landing page and “Backend status: Connected” when the control plane is running. Health check: **http://localhost:3001/health**.

---

## Configuration

| Variable | Where | Description |
|----------|--------|-------------|
| `DATABASE_URL` | control-plane | Postgres connection string (e.g. `postgresql://mastermind:changeme@localhost:5432/mastermind`) |
| `REDIS_HOST`, `REDIS_PORT` | control-plane | Redis for BullMQ (default localhost:6379) |
| `JWT_SECRET` | control-plane | Secret for user JWTs (never use default in prod) |
| `JWT_AGENT_SECRET` | control-plane | Secret for agent JWTs (separate from user secret) |
| `PORT` | control-plane | API port (default 3001) |
| `NEXT_PUBLIC_CONTROL_PLANE_URL` | web | Backend URL for the browser (e.g. http://localhost:3001) |
| Agent | agent | See `agent/config.yaml.example` — `control_plane_url`, `pairing_token`, `agent_key_path` |

Copy `.env.example` to `.env` (and `control-plane/.env.example` to `control-plane/.env`, etc.). Never commit `.env`.

---

## First-run walkthrough

1. **Start infra:** `make up` (Postgres + Redis). Run migrations (see Quickstart step 4).
2. **Seed data (if you have a seed script):** e.g. create an org and a user. Otherwise create them via API or add a minimal seed.
3. **Start control plane:** `cd control-plane && pnpm dev`. Start web: `cd web && pnpm dev`.
4. **Generate pairing token:** Use the API (e.g. POST `/api/orgs/:orgId/pairing-tokens` with JWT) or a future UI. You get a one-time token.
5. **Run agent locally:** Copy `agent/config.yaml.example` to `config.yaml`, set `control_plane_url` to `http://localhost:3001` and `pairing_token` to the token. Run `go run .` from `agent/` (or build and run the binary). Agent pairs, stores the key, then heartbeats.
6. **Register a 7DTD server instance:** Via API (POST `/api/orgs/:orgId/server-instances`) with name, hostId, gameType `7dtd`, optional installPath, startCommand, telnet host/port/password. See `docs/api-server-instances-7dtd.md`.
7. **Start / stop / restart:** Trigger jobs (e.g. SERVER_RESTART) via API or future UI; agent picks them up and runs the game adapter.
8. **View logs:** Control plane stores job runs; log streaming is optional (see docs).

---

## Troubleshooting

| Issue | What to do |
|-------|------------|
| Port 3000, 3001, 5432, or 6379 in use | Change ports in `.env` and `infra/docker-compose.yml`, or stop the process using the port. |
| Migrations fail | Ensure Postgres is up and `DATABASE_URL` is correct. Run migrations in order (see `control-plane/prisma/migrations/README-migration-order.md`). |
| Compose build fails | Run `make bootstrap` first. Ensure Docker has enough memory. For control-plane, run `pnpm prisma generate` locally if needed. |
| Web shows “Not connected” | Ensure control plane is running on the URL in `NEXT_PUBLIC_CONTROL_PLANE_URL` and CORS allows the web origin. |
| Auth failures | Check `JWT_SECRET` and that the user is in the org. For agent, check `JWT_AGENT_SECRET` and that the host’s key version matches. |

---

## Security notes

- **Signed jobs:** Agents authenticate with a JWT; the control plane only gives jobs to the correct host. See `docs/security-agent-pairing.md`.
- **Allowlists:** The agent runs commands via game adapters (no arbitrary shell by default). See `docs/security-review.md`.
- **Discord:** Webhook URL is stored per org; don’t log it. Rate limit outbound alerts.

---

## Roadmap

- **Phase 1 (MVP):** Control plane + web + agent, pairing, server CRUD, job dispatch, basic 7DTD adapter.
- **Phase 2:** Schedules, bulk operations, Discord alerts, command macros.
- **Phase 3:** Multi-host, observability, command palette, further game adapters.

---

## License

MIT — see [LICENSE](LICENSE).
