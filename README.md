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
├── discord-bot/      # Optional downloadable Discord slash-command bridge
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

## Release 0.0.10 (August 13, 2026)

### Highlights

- Codex-assisted mod configuration editing through the OpenAI Responses API, with encrypted API-key storage, model testing, structured proposals, mandatory line diff review, explicit approval, and no automatic writes.
- Server Tools page with configurable high-ping enforcement and country-based kick/ban policies.
- Improved Players experience with search, filters, sorting, summary cards, responsive mobile cards, level/combat statistics, inventory inspection, administrator controls, and last-known IP addresses.
- Live map region labels now use actual save filenames for every loaded region tile.
- Profile Editor associates EOS/Steam `.ttp` files with player names from `players.xml` when possible.
- Organization administrators can reset lower-tier account passwords without seeing or knowing the original password.

---

## Current features (v0.0.10)

### Implemented end-to-end

- **Authentication and organizations:** register/login, JWT sessions, organization membership and roles, admin-created operator/viewer accounts, protected account deletion, administrator resets for lower-tier passwords, protected pairing-token creation, agent-key rotation, and password changes using salted scrypt with legacy-hash migration.
- **Host agents:** one-time pairing, persistent agent identity, heartbeat and inventory reporting, long-poll job execution, same-host Linux 7DTD autodiscovery, and automatic server registration.
- **Server-first dashboard:** registered servers are primary; each server opens a management view with overview, controls, console, and server-filtered job history.
- **7DTD controls:** start, graceful stop, verified restart, safe restart with countdown/save/backup/kick verification, emergency process kill, telnet console commands, and a confirmed save wipe that safely stops or escalates a hung server before deleting only the configured save and verifying fresh-world creation.
- **Blood Moon safety:** an optional organization setting defers restart jobs on in-game days divisible by 7 until the next game day begins.
- **Jobs and accountability:** queue-backed start/stop/restart/safe-restart/kill/RCON/custom jobs, result/output tracking, schedule and batch support, per-server filtering, initiating-account attribution, and serialized mutations with concurrent read-only inventory jobs.
- **Logs and console:** agent log tailing, database persistence, incremental live viewing, optional auto-scroll, selectable retention, keyword alert definitions, match history, and an audited telnet command box.
- **Chat:** player and server-authored chat extraction, stored history, player-only per-server Discord webhook relay with mention suppression, and operator replies automatically sent as server `say` messages.
- **Health:** host-scoped CPU, RAM, disk, agent latency, and real 7DTD reachability samples with current values, historical averages, and configurable polling intervals.
- **Players:** authoritative `lp` polling every 60 seconds by default, reconciled Steam/EOS identity capture, last-known IP address, online state, current/lifetime playtime, last seen, level, zombie/player kills, deaths, inventory inspection, search/filter/sort controls, responsive mobile cards, kick/ban/kick-all actions, post-kick verification, and XML-backed administrator status with promote/demote controls.
- **Mods:** fast active/quarantined inventories, `ModInfo.xml` name/version/author/website parsing, activation timestamps, sortable columns, single/bulk selection, quarantine, permission-safe restore, constrained permanent deletion, safe configuration editing, and optional Codex-assisted changes with mandatory diff review and approval before an atomic save.
- **Connection protection tools:** per-server high-ping kicker with consecutive-sample threshold and cooldown, plus country-based kick/ban policies when the game exposes a real public player IP. Relay-masked/private IPs are deliberately skipped.
- **RegionHealer:** status information plus start/stop jobs for a separately installed RegionHealer-v2 service.
- **7D2D Profile Editor:** isolated integration of RussDev7's GPL-3.0 TTP Profile Editor with server profile discovery, staged live edits, timestamped original `.ttp`/`.ttp.bak` archives plus audit metadata, atomic installation on the next Mastermind-managed start/restart, and visible/backend attribution.
- **Live server map:** authenticated official terrain map with live players, animals, hostiles, coordinates, game time, region grid, owned land-claim blocks and protection areas, selectable player tracking and trail colors, plus selectable 5-minute through 72-hour browser-local history. The 7DTD dashboard and telnet ports remain private.
- **Saves:** combined full-world and RegionHealer snapshot inventory, timestamp/game-day metadata, manual full backup, confirmed server-off restore/delete, full-backup retention, and scheduled backups from every 15 minutes through daily.
- **Schedules:** safe scheduled restarts, a simple day/hour/minute builder, advanced five-field cron entry, and automatic full-world backup intervals.
- **Alerts and integrations:** Discord alerts, per-rule pipeline testing, deduplicated player connection/disconnection events with session duration, durable player-chat delivery/retries, log-keyword alerts, and server/agent events.
- **Discord command bot:** optional downloadable slash-command bridge for start, stop, restart, and Safe Restart with completion/failure replies, dedicated-account job attribution, and Discord role/user allowlists.
- **Host and instance registry:** role-protected rename and unregister operations with clear confirmation that unregistering does not delete game files.
- **Responsive UI:** server-first overview, customizable Quick Access cards, grouped scrollable navigation, full desktop, half-window compact navigation, mobile drawer, safe table overflow, Original/Dark/Light themes, custom Mastermind logo, and favicon.
- **Game adapters:** 7 Days to Die is fully managed; Minecraft adapter and capability registry remain available for expansion.

Frigate integration is currently deprecated and hidden from the Settings and new-alert interfaces. Its backend and stored configuration remain intact for compatibility and possible future reactivation.

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

# Recommended one-line start
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
| `OPENAI_KEY_ENCRYPTION_SECRET` | control-plane | Dedicated secret used to encrypt stored OpenAI API keys; use a long random value and never rotate it without replacing stored keys. |
| `PORT` | control-plane | API port (default 3001) |
| `NEXT_PUBLIC_CONTROL_PLANE_URL` | web | Backend URL for the browser (e.g. http://localhost:3001) |
| Agent | agent | See `agent/config.yaml.example` — `control_plane_url`, `pairing_token`, `agent_key_path` |

Copy `.env.example` to `.env` (and `control-plane/.env.example` to `control-plane/.env`, etc.). Never commit `.env`.

### Discord command bot

The optional bot sends `/start`, `/stop`, `/reboot`, and `/safereboot` through the authenticated Mastermind job pipeline and reports completion or failure back to Discord. It includes Discord user/role authorization and attributes jobs to its dedicated Mastermind account. See **[discord-bot/README.md](discord-bot/README.md)**.

---

## First-run walkthrough

1. **Run one command:** `make start` (or `bash scripts/start.sh`).
2. **Login:** open `http://localhost:3000/login` and sign in with seeded admin credentials.
3. **Pair a host:** in **Hosts**, click **Pair New Host**, set host name / control-plane URL, and generate a token.
4. **Start agent (recommended):** run the generated one-liner from the Hosts page:
   - `curl -sSL "http://<control-plane>:3001/install.sh?token=<token>&url=http://<control-plane>:3001&name=<host-name>" | sudo bash`
5. **Manual fallback:** in `agent/`, copy `config.yaml.example` to `config.yaml`, set `control_plane_url` + `pairing_token`, then run `go run .`
   - For same-box Linux 7DTD installs, enable `discovery.seven_dtd` and point it at your real paths (for example `serverfiles/serverconfig.xml`, `serverfiles/Mods`, `.local/share/7DaysToDie/Saves/serveradmin.xml`). The agent will auto-register/update the 7DTD server instance for that host.
6. **Register a server instance:** in **Hosts**, use the Register Server form (game type `7dtd` or `minecraft`). If autodiscovery is enabled and working, this may already be done for you.
7. **Run jobs:** in **Jobs**, create `start` / `stop` / `restart` / `rcon` / `custom` jobs and monitor status/output.

### Same-Host 7DTD Autodiscovery Example

If the agent runs on the same Linux machine as your 7DTD dedicated server, use config like:

```yaml
control_plane_url: "http://YOUR_CONTROL_PLANE_IP:3001"
pairing_token: "PAIRING_TOKEN"
agent_key_path: "/var/lib/mastermind-agent/agent.key"

heartbeat:
  interval_sec: 5

jobs:
  poll_interval_sec: 5
  long_poll_sec: 30

host:
  name: "7dtd-box"

discovery:
  enabled: true
  seven_dtd:
    enabled: true
    install_path: "/home/xxxxxxx/serverfiles"
    server_config_path: "/home/xxxxxxx/serverfiles/sdtdserver.xml"
    mods_path: "/home/xxxxxxx/serverfiles/Mods"
    saves_path: "/home/xxxxxxxx/.local/share/7DaysToDie/Saves"
    server_admin_xml_path: "/home/xxxxxxxx/.local/share/7DaysToDie/Saves/serveradmin.xml"
    start_command: "/bin/sh /home/xxxxxxx/serverfiles/startserver.sh"
```

On first run, the agent will pair, read the local 7DTD paths, and auto-create or update the matching 7DTD server instance in Mastermind.

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
