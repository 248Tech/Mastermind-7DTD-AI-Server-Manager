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
├── scripts/          # bootstrap.sh, start.sh, dev.sh, doctor.sh
├── .github/          # Issue/PR templates
├── Makefile          # make start, bootstrap, up, down, logs, test
├── pnpm-workspace.yaml
└── README.md
```

---

## Release 0.0.3 (March 18, 2026)

### Highlights

- New one-line startup flow: `make start` (or `bash scripts/start.sh`) installs deps, builds agent binaries, starts infra, migrates/seeds DB, and launches control-plane + web.
- New downloadable prebuilt agent endpoints from control-plane: `GET /agent/download/:platform`.
- Schedules API is now implemented: list/create/update/delete under `/api/orgs/:orgId/schedules`.
- Alerts API is now implemented: list/create/update/delete under `/api/orgs/:orgId/alerts`.
- Org settings update endpoint added: `PATCH /api/orgs/:orgId` (including `discordWebhookUrl`).
- Hosts page now includes a setup wizard and an agent download/build helper panel.

---

## Current known features (v0.0.3)

### Implemented end-to-end

- User auth: register, login, `GET /api/auth/me` (JWT).
- Org management: create org, list my orgs, get org details.
- Agent onboarding: generate pairing token, pair agent, rotate key, heartbeat ingestion.
- Agent installer script endpoint for one-line setup: `GET /install.sh`.
- Host inventory: list hosts, host details, online/offline status from heartbeat.
- Server instances: CRUD for org-scoped server definitions.
- Job dispatch: create/list jobs, queue-backed execution, job run status/result reporting from agents.
- Agent polling loop: host fetches pending jobs and posts job results back.
- Game type registry: `7dtd` and `minecraft` seeded with capabilities.
- Schedules CRUD API + queue integration.
- Alert rule CRUD API.
- Org settings update API (Discord webhook supported).
- Web UI pages:
  - Login/Register
  - Dashboard (host + recent job summaries)
  - Hosts (pair token generation, server registration)
  - Jobs (create start/stop/restart/rcon/custom jobs + view output)
  - Schedules (create/list/edit/delete schedule rules)
  - Alerts (create/list/edit/delete alert rules)
  - Settings (org/account + Discord webhook update)

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

# Recommended one-line start (v0.0.3)
make start
# or: bash scripts/start.sh
```

Open **http://localhost:3000/login** and sign in with the seeded account:

- `admin@mastermind.local`
- `changeme`

Health check: **http://localhost:3001/health**.

The `make start` command handles dependency install, agent binary builds, Postgres/Redis startup, Prisma push/seed, and starts both app services.

Detailed setup options (full Docker, local dev, API reference): see **[QUICKSTART.md](QUICKSTART.md)**.

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

1. **Run one command:** `make start` (or `bash scripts/start.sh`).
2. **Login:** open `http://localhost:3000/login` and sign in with seeded admin credentials.
3. **Pair a host:** in **Hosts**, click **Pair New Host**, set host name / control-plane URL, and generate a token.
4. **Start agent (recommended):** run the generated one-liner from the Hosts page:
   - `curl -sSL "http://<control-plane>:3001/install.sh?token=<token>&url=http://<control-plane>:3001&name=<host-name>" | sudo bash`
5. **Manual fallback:** in `agent/`, copy `config.yaml.example` to `config.yaml`, set `control_plane_url` + `pairing_token`, then run `go run .`
6. **Register a server instance:** in **Hosts**, use the Register Server form (game type `7dtd` or `minecraft`).
7. **Run jobs:** in **Jobs**, create `start` / `stop` / `restart` / `rcon` / `custom` jobs and monitor status/output.

---

## Troubleshooting

| Issue | What to do |
|-------|------------|
| Port 3000, 3001, 5432, or 6379 in use | Change ports in `.env` and `infra/docker-compose.yml`, or stop the process using the port. |
| Schema sync fails | Ensure Postgres is up and `DATABASE_URL` is correct, then run `cd control-plane && pnpm prisma db push`. |
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
