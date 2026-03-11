# Mastermind — 7DTD AI Server Manager

**Control Plane + Host Agent** for managing 7 Days to Die (and other game) servers. Instead of SSH’ing into each box, you run a small agent on every host; the control plane sends jobs (start, stop, restart, RCON, etc.) and the agent runs them locally.

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

- **Control plane:** REST API, Postgres (orgs, hosts, server instances, jobs), Redis/BullMQ (job queues), pairing tokens, auth, org membership guards.
- **Web:** Next.js UI — login/register, dashboard, hosts, jobs, schedules/alerts/settings pages.
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

## Current known features (v0.0.1)

### Implemented end-to-end

- User auth: register, login, `GET /api/auth/me` (JWT).
- Org management: create org, list my orgs, get org details.
- Agent onboarding: generate pairing token, pair agent, rotate key, heartbeat ingestion.
- Host inventory: list hosts, host details, online/offline status from heartbeat.
- Server instances: CRUD for org-scoped server definitions.
- Job dispatch: create/list jobs, queue-backed execution, job run status/result reporting from agents.
- Agent polling loop: host fetches pending jobs and posts job results back.
- Game type registry: `7dtd` and `minecraft` seeded with capabilities.
- Web UI pages:
  - Login/Register
  - Dashboard (host + recent job summaries)
  - Hosts (pair token generation, server registration)
  - Jobs (create start/stop/restart/rcon/custom jobs + view output)
  - Settings (org/account info display)

### Present in UI but backend support still in progress

- Schedules management page (`/schedules`) currently shows “API coming soon” if schedule endpoints are unavailable.
- Alert rules page (`/alerts`) currently shows “API coming soon” if alerts endpoints are unavailable.
- Discord webhook update from settings may show “API coming soon” where org update endpoint is not exposed yet.

---

## Prerequisites

- **Node.js** 20 LTS (or 20.x)
- **pnpm** 9.x (`corepack enable && corepack prepare pnpm@latest --activate`)
- **Go** 1.22+ (for building the agent)
- **Docker** and **Docker Compose** v2 (for Postgres, Redis, and optional full stack)

---

## Quickstart (copy-paste)

```bash
git clone https://github.com/248Tech/Mastermind-7DTD-AI-Server-Manager.git
cd Mastermind-7DTD-AI-Server-Manager

# 1. Install tools check (optional)
./scripts/doctor.sh

# 2. Bootstrap: install deps, copy .env files
make bootstrap
# or: ./scripts/bootstrap.sh

# 3. Start Postgres + Redis (required for control plane)
make up
# or: cd infra && docker compose up -d
# (Optionally start control-plane + web in Docker: docker compose --profile full up -d)

# 4. Run migrations + seed (first time only)
cd control-plane
pnpm prisma migrate deploy
pnpm prisma:seed
cd ..

# 5. Start control plane and web (separate terminals)
cd control-plane && pnpm dev    # → http://localhost:3001
cd web && pnpm dev              # → http://localhost:3000
```

Open **http://localhost:3000/login** and sign in with the seeded account:

- `admin@mastermind.local`
- `changeme`

Health check: **http://localhost:3001/health**.

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

1. **Start infra:** `make up` (Postgres + Redis).
2. **Migrate + seed:** `cd control-plane && pnpm prisma migrate deploy && pnpm prisma:seed`.
3. **Start services:** `cd control-plane && pnpm dev`, then `cd web && pnpm dev`.
4. **Login:** open `http://localhost:3000/login` and sign in with seeded admin credentials.
5. **Pair a host:** in **Hosts**, click **Pair New Host** and generate a token.
6. **Start agent:** in `agent/`, copy `config.yaml.example` to `config.yaml`, set:
   - `control_plane_url: "http://localhost:3001"`
   - `pairing_token: "<token from UI>"`
   - then run `go run .`
7. **Register a server instance:** in **Hosts**, use the Register Server form (game type `7dtd` or `minecraft`).
8. **Run jobs:** in **Jobs**, create `start` / `stop` / `restart` / `rcon` / `custom` jobs and monitor status/output.

---

## Troubleshooting

| Issue | What to do |
|-------|------------|
| Port 3000, 3001, 5432, or 6379 in use | Change ports in `.env` and `infra/docker-compose.yml`, or stop the process using the port. |
| Migrations fail | Ensure Postgres is up and `DATABASE_URL` is correct. Run migrations in order (see `control-plane/prisma/migrations/README-migration-order.md`). |
| Compose build fails | Run `make bootstrap` first. Ensure Docker has enough memory. For control-plane, run `pnpm prisma generate` locally if needed. |
| Login fails for default admin | Run `cd control-plane && pnpm prisma:seed` and try `admin@mastermind.local / changeme`. |
| Web shows backend/API errors | Ensure control plane is running on the URL in `NEXT_PUBLIC_CONTROL_PLANE_URL` (default `http://localhost:3001`). |
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
