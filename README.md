# Mastermind — 7DTD AI Server Manager

**Control Plane + Host Agent** for managing 7 Days to Die (and other game) servers. Instead of SSH’ing into each box, you run a small agent on every host; the control plane sends jobs (start, stop, restart, RCON, etc.) and the agent runs them locally.

---

## In plain English

Mastermind is a control panel for a 7 Days to Die server. It lets an owner see what is happening, make common changes safely, and give trusted staff the right amount of access—without handing everyone SSH access or asking them to edit XML by hand.

### What you can do

| If you want to… | Start here |
|---|---|
| See whether the server is healthy | **Dashboard → Health** |
| Watch players, zombies, animals, or claims | **Live Map** |
| Read logs or talk to the server | **Logs → Console** |
| Manage players | **Players** |
| Add, edit, quarantine, or restore mods | **Mods** |
| Back up or restore the world | **Saves** |
| Schedule restarts and backups | **Schedules** |
| Configure Discord, email, AI, maps, or security | **Settings** |
| Let players see their own map and profile | **Player Portal** at `/player` |

### Choose the setup that fits

- **Just trying it locally?** Use the Docker Compose quickstart below.
- **Running a real game host?** Install the Go agent on the host and pair it from the dashboard. See [`human/user-guide.md`](human/user-guide.md).
- **Hosting Mastermind on a VPS?** Follow [`docs/DIGITALOCEAN_DEPLOYMENT.md`](docs/DIGITALOCEAN_DEPLOYMENT.md), then keep game APIs private over WireGuard or the host network.
- **Only interested in the player experience?** Open `/player`; Steam verification is required before player locations, profiles, and inventory are shown.

### Quick navigation

[Quickstart](#quickstart-copy-paste) · [Features](#current-features-v0012) · [Security](#security-notes) · [Deployment](docs/DIGITALOCEAN_DEPLOYMENT.md) · [Human guide](human/user-guide.md) · [Release context](docs/release-0.0.12-context.md)

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

### How an action travels

1. A staff member clicks an action in the web dashboard.
2. The control plane checks the account role and puts the action in the correct server’s job queue.
3. The paired host agent receives the job and runs it locally through the game adapter.
4. The result, logs, and account attribution return to the dashboard.

This separation is why the public website does not need direct access to telnet, save files, or the game process.

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

## Release 0.0.12 (August 18, 2026)

### Highlights

- Selectable Codex or Kimi Code mod-editing agents with encrypted provider credentials, connection testing, structured proposals, mandatory diff approval, and no automatic writes.
- Native chat moderation with editable per-word actions, flood controls, mute/unmute, audited actions, and Discord suppression for blocked messages.
- Safe ZIP mod uploads that discover `ModInfo.xml`, remove redundant wrapper/`Mods` folders, reject unsafe archives, normalize permissions, and stage every upload in quarantine.
- Live-map world bounds from `map_info.xml`, section or explicitly warned full-world `visitmap` generation, truthful start/stop status, player name tags, land claims, entity tracking, and stable extended zoom/history controls.
- Profile Editor injection status for queued/applied `.ttp` changes, including staged and applied timestamps.
- A hardened Go host agent with persistent batched log tailing, pooled HTTP connections, bounded concurrency, jittered retry, configured game reachability, metrics, version reporting, and graceful systemd shutdown.
- Scheduler overlap prevention and stale-running-job recovery keep long operations from silently blocking later work.
- Steam-aware account status and administrator dashboard links connect the player portal with staff workflows without exposing credentials.
- The mod editor now provides IDE-style tabs, line numbers, search, wrapping, syntax coloring, dirty-state feedback, and keyboard save.
- ServerTools and Allocs inventory parsers preserve real stack quantities instead of displaying every item as one.

---

## Current features (v0.0.12)

The complete release handoff is documented in [docs/release-0.0.12-context.md](docs/release-0.0.12-context.md). Package versions and release metadata are `0.0.12`.

### Implemented end-to-end

- **Authentication and organizations:** register/login, JWT sessions, organization membership and roles, admin-created operator/viewer accounts, protected account deletion, administrator resets for lower-tier passwords, protected pairing-token creation, agent-key rotation, password changes using salted scrypt with legacy-hash migration, account approval, Steam-link status, escalating lockouts, registration quotas, math challenges, optional reCAPTCHA, and email confirmation.
- **Host agents:** one-time pairing, persistent agent identity, versioned heartbeat/inventory reporting, configured 7DTD reachability, same-host Linux autodiscovery, automatic server registration, pooled HTTP connections, bounded jittered retries, bounded read concurrency, serialized mutations, and graceful systemd shutdown.
- **Server-first dashboard:** registered servers are primary; each server opens a management view with overview, controls, console, and server-filtered job history.
- **7DTD controls:** start, graceful stop, verified restart, safe restart with countdown/save/backup/kick verification, emergency process kill, telnet console commands, and a confirmed save wipe that safely stops or escalates a hung server before deleting only the configured save and verifying fresh-world creation.
- **Blood Moon safety:** an optional organization setting defers restart jobs on in-game days divisible by 7 until the next game day begins.
- **Jobs and accountability:** queue-backed start/stop/restart/safe-restart/kill/RCON/custom jobs, result/output tracking, schedule and batch support, per-server filtering, initiating-account attribution, stale-run recovery, durable mutation backpressure, and bounded concurrent read-only inventory jobs.
- **Logs and console:** persistent open-file log following with rotation/truncation recovery, ordered 64 KiB/350 ms batches, retry-safe delivery, database persistence, incremental live viewing, optional auto-scroll, selectable retention, keyword alert definitions, match history, and an audited telnet command box.
- **Chat:** player and server-authored chat extraction, stored history, player-only per-server Discord webhook relay with mention suppression, operator replies automatically sent as server `say` messages, and native bad-word/flood moderation with editable log/warn/kick actions plus mute/unmute controls.
- **Health:** host-scoped CPU, RAM, disk, agent latency, and real 7DTD reachability samples with current values, historical averages, and configurable polling intervals.
- **Players:** authoritative `lp` polling every 60 seconds by default, reconciled Steam/EOS identity capture, last-known IP address, online state, current/lifetime playtime, last seen, level, zombie/player kills, deaths, Allocs JSON inventory inspection, search/filter/sort controls, responsive mobile cards, kick/ban/kick-all actions, post-kick verification, and XML-backed administrator status with promote/demote controls.
- **Mods:** fast active/quarantined inventories, `ModInfo.xml` name/version/author/website parsing, activation timestamps, sortable columns, single/bulk selection, quarantine, permission-safe restore, constrained permanent deletion, IDE-style configuration editing with tabs/line numbers/search/syntax colors/wrapping/Ctrl+S, normalized ZIP upload directly to quarantine, and selectable Codex/Kimi Code proposals with mandatory diff review and approval before an atomic save.
- **Connection protection tools:** per-server high-ping kicker with consecutive-sample threshold and cooldown, plus country-based kick/ban policies when the game exposes a real public player IP. Relay-masked/private IPs are deliberately skipped.
- **RegionHealer:** status information plus start/stop jobs for a separately installed RegionHealer-v2 service.
- **7D2D Profile Editor:** isolated integration of RussDev7's GPL-3.0 TTP Profile Editor with server profile discovery, staged live edits, queued/applied injection status and timestamps, timestamped original `.ttp`/`.ttp.bak` archives plus audit metadata, atomic installation on the next Mastermind-managed start/restart, and visible/backend attribution.
- **Live server map:** authenticated official terrain map with `map_info.xml` world bounds, live players from PrismaCore (Allocs fallback), hostiles/animals from Allocs (not telnet `le`), PrismaCore overlays (vehicles, drones, homes, traders, POIs, reset regions, advanced claims), optional player name tags, coordinates, game time, region grid, owned land-claim blocks/protection areas, selectable tracking/trail colors, stable extended zoom, 5-minute through 72-hour browser-local history, and guarded section/full-world `visitmap` generation via Allocs. The dashboard and telnet ports remain private.
- **Live-data fallbacks:** player roster polling prefers Allocs `getplayersonline` for ping, IP, kills, deaths, level, and position, then falls back to telnet `lp` when the API is unavailable or unusable. An authoritative empty API roster is treated as empty rather than replaced with stale data. Map entity feeds fail closed with a visible feed error.
- **Steam-verified player portal:** `/player` map (terrain, zombies, and animals are public; player locations stay hidden until Steam OpenID verifies a SteamID already on that server), `/player/profile` for Steam sessions with inventory quantities, stats, supporter status, and an administrator dashboard link when recognized, and `/player/shop` for the donator catalog. Staff controls, claims, raw telnet, and management APIs are excluded from the player portal.
- **Donator shop and Stripe:** public shop browse and WebP images; checkout requires Steam or an in-game-name password account. Admins manage items on `/donator-shop` and completed purchases on `/purchases`. Custom $5–$500 gifts remain available. Supporter status is granted only from a signed Stripe webhook.
- **Saves:** combined full-world and RegionHealer snapshot inventory, timestamp/game-day metadata, manual full backup, confirmed server-off restore/delete, full-backup retention, and scheduled backups from every 15 minutes through daily.
- **Schedules:** safe scheduled restarts, a simple day/hour/minute builder, advanced five-field cron entry, automatic full-world backup intervals, and overlap prevention that skips a recurrence while its previous job is still pending/running.
- **Alerts and integrations:** Discord alerts, per-rule pipeline testing, deduplicated player connection/disconnection events with session duration, durable player-chat delivery/retries, log-keyword alerts, server/agent events, encrypted Cloudflare and DigitalOcean API-token storage, and encrypted Mailgun configuration with email-confirmation, resend, and test-delivery flows.
- **Discord command bot:** optional downloadable slash-command bridge for start, stop, restart, and Safe Restart with completion/failure replies, dedicated-account job attribution, and Discord role/user allowlists.
- **Host and instance registry:** role-protected rename and unregister operations with clear confirmation that unregistering does not delete game files.
- **Responsive UI:** server-first overview, customizable Quick Access cards, grouped scrollable navigation, full desktop, half-window compact navigation, mobile drawer, safe table overflow, Original/Dark/Light themes, custom Mastermind logo, and favicon.
- **Game adapters:** 7 Days to Die is fully managed; Minecraft adapter and capability registry remain available for expansion.

### Additional current capabilities

- **Allocs WebInterface 52 integration:** control-plane requests use the versioned `X-SDTD-API-TOKENNAME` and `X-SDTD-API-SECRET` headers. Inventory uses `getplayerinventory`, roster data uses `getplayersonline`, entities use the location endpoints, and console access is restricted to numeric map bounds and `stop` for `visitmap`.
- **PrismaCore integration:** ClaimCreator data supplies staff-only vehicles, drones, beds/homes, traders, POIs, reset regions, advanced claims, and map player positions. The player portal never receives PrismaCore credentials or raw staff overlays.
- **Public privacy boundary:** public shop status exposes only server name, checkout availability, reachability, and an online-player count. Player names, positions, IP addresses, telnet output, webtokens, Stripe identifiers, and dashboard APIs remain private.
- **Portal identity modes:** Steam OpenID unlocks player maps, profiles, inventory, and stats for a Steam ID already seen on the configured server. In-game-name accounts are limited to shop checkout and cannot reveal player locations or private profile data.
- **Shop image pipeline:** uploaded JPEG, PNG, and WebP assets are magic-byte validated, resized into WebP master/thumbnail variants, and served through constrained item-image routes.
- **Deployment boundaries:** Mastermind runs behind the Cloudflare tunnel; Allocs `:8080`, PrismaCore `:11111`, telnet, WireGuard keys, save data, and game APIs remain private on the host/WireGuard network. See [`docs/allocs.md`](docs/allocs.md), [`docs/prismacore.md`](docs/prismacore.md), and [`docs/DIGITALOCEAN_DEPLOYMENT.md`](docs/DIGITALOCEAN_DEPLOYMENT.md).

Frigate integration is currently deprecated and hidden from the Settings and new-alert interfaces. Its backend and stored configuration remain intact for compatibility and possible future reactivation.

### Helpful guides

- [Human-friendly user guide](human/user-guide.md) — installation, first login, pairing, and everyday operations.
- [DigitalOcean deployment](docs/DIGITALOCEAN_DEPLOYMENT.md) — production VPS layout and service checks.
- [Allocs integration](docs/allocs.md) — live entities, inventory, roster data, and private API requirements.
- [PrismaCore integration](docs/prismacore.md) — claims and staff map overlays.
- [Release context](docs/release-0.0.12-context.md) — maintainer handoff, validation, and deployment checklist.

### A few terms you will see

- **Control plane:** the web application and API that coordinate everything.
- **Host agent:** the small program installed beside the game server; it performs approved actions locally.
- **Server instance:** one configured game server inside Mastermind.
- **Job:** a queued action such as restart, backup, mod quarantine, or console command.
- **Steam-verified player:** a player whose Steam account matches a player already seen on the configured server.

---

## Prerequisites

- **Node.js** 20 LTS (or 20.x)
- **pnpm** 9.x (`corepack enable && corepack prepare pnpm@latest --activate`)
- **Go** 1.22+ (for building the agent)
- **Docker** and **Docker Compose** v2 (for Postgres, Redis, and optional full stack)

---

## Quickstart (copy-paste)

### Before you begin

You need a computer (or VPS) that can run Docker, the address of your game host, and a password you can safely store in a password manager. The first account created becomes the organization administrator. Do not put real passwords, API keys, Steam credentials, save files, or SSH keys in this repository.

The commands below start the **Mastermind control plane**. They do not install 7 Days to Die or change an existing game save. Pair a game host afterward from **Settings → Hosts** using the one-time pairing token.

```bash
git clone https://github.com/248Tech/Mastermind-7DTD-AI-Server-Manager.git
cd Mastermind-7DTD-AI-Server-Manager

# Recommended one-line start
make start
# or: bash scripts/start.sh
```

Before the first start, set `BOOTSTRAP_ADMIN_EMAIL` and a unique
`BOOTSTRAP_ADMIN_PASSWORD` of at least 12 characters in `infra/.env`. Open
**http://localhost:3000/login** and sign in with that account. Mastermind no
longer ships a default password.

Health check: **http://localhost:3001/health**.

The `make start` command handles dependency install, agent binary builds, Postgres/Redis startup, Prisma push/seed, and starts both app services.

Detailed setup options (full Docker, local dev, API reference): see **[QUICKSTART.md](QUICKSTART.md)**.

---

## Configuration

The active split-host production layout (DigitalOcean control plane plus a
WireGuard-connected game VM) is documented in
[`docs/DIGITALOCEAN_DEPLOYMENT.md`](docs/DIGITALOCEAN_DEPLOYMENT.md).

| Variable | Where | Description |
|----------|--------|-------------|
| `DATABASE_URL` | control-plane | Postgres connection string (e.g. `postgresql://mastermind:changeme@localhost:5432/mastermind`) |
| `REDIS_HOST`, `REDIS_PORT` | control-plane | Redis for BullMQ (default localhost:6379) |
| `JWT_SECRET` | control-plane | Secret for user JWTs (never use default in prod) |
| `JWT_AGENT_SECRET` | control-plane | Secret for agent JWTs (separate from user secret) |
| `PLAYER_JWT_SECRET` | control-plane | Secret for short-lived Steam-verified player sessions; use a separate random value in production. |
| `PLAYER_SESSION_SECRET` | web | HMAC secret for the one-time Steam OpenID login state. |
| `EMAIL_VERIFICATION_SECRET` | control-plane | Dedicated signing secret for expiring, single-use email-confirmation links. |
| `AUTH_RATE_LIMIT_SECRET` | control-plane | Dedicated HMAC secret for persistent login/registration throttling keys. |
| `BOOTSTRAP_ADMIN_EMAIL` | control-plane | Email to create or promote as the first administrator during seed. |
| `BOOTSTRAP_ADMIN_PASSWORD` | control-plane | Required only when the bootstrap administrator does not already exist; minimum 12 characters. |
| `PLAYER_PORTAL_SERVER_ID` | web | Default registered server instance opened from `/player`; copy the ID from its Mastermind server page. |
| `PRISMACORE_WEB_URL` | control-plane | ClaimCreator WebAPI base URL (private, e.g. `http://10.78.0.2:11111`). Leave blank to hide overlays and report shop `serverReachable: false`. |
| `PRISMACORE_API_USER` / `PRISMACORE_API_PASSWORD` | control-plane | ClaimCreator `apiuser` credentials. Never put these in Next public env. |
| `SEVENDTD_WEB_URL` | control-plane, web | Allocs/WebMap base URL (private, e.g. `http://10.78.0.2:8080`). Web uses it for tiles/`serverstats`; control-plane uses it for hostiles/animals/inventory/`visitmap`. |
| `SEVENDTD_WEB_API_TOKEN_NAME` / `SEVENDTD_WEB_API_SECRET` | control-plane (and web tiles if configured) | Allocs webtoken. Inventory and `executeconsolecommand` require the secret. |
| `PUBLIC_WEB_URL` | control-plane | Public HTTPS origin used in email-confirmation links and Stripe return URLs, such as `https://mm.example.com`. |
| `STRIPE_SECRET_KEY` | control-plane | Optional env fallback for Stripe Checkout. Prefer Settings → Stripe Donations, which stores an encrypted org secret key. |
| `STRIPE_WEBHOOK_SECRET` | control-plane | Optional env fallback for `POST /api/donations/stripe/webhook`. Prefer the encrypted org webhook signing secret in Settings. |
| `OPENAI_KEY_ENCRYPTION_SECRET` | control-plane | Dedicated secret used to encrypt stored integration credentials (OpenAI, Moonshot/Kimi, Cloudflare, DigitalOcean, and Mailgun); historical name retained for ciphertext compatibility. Use a long random value and never rotate it without replacing stored credentials. |
| `PORT` | control-plane | API port (default 3001) |
| `NEXT_PUBLIC_CONTROL_PLANE_URL` | web | Backend URL for the browser (e.g. http://localhost:3001) |
| Agent | agent | See `agent/config.yaml.example` — `control_plane_url`, `pairing_token`, `agent_key_path` |

Copy `.env.example` to `.env` (and `control-plane/.env.example` to `control-plane/.env`, etc.). Never commit `.env`.

### Player portal and future domain

Set `PLAYER_PORTAL_SERVER_ID`, then open `http://localhost:3000/player` or use **View Player Portal** in the staff sidebar. `/player/shop` is public to browse. Steam OpenID unlocks the live-map player layer and `/player/profile`. Shop checkout also accepts an in-game-name password account (`auth: name`); those sessions cannot open profile stats or unlock other players on the map. No Steam Web API key is required. The Steam account must already appear with a SteamID in that server's Players page. Stripe Checkout metadata binds a payment to the player session, and only the signed webhook marks them as a supporter.

When a domain is ready, route the domain or player subdomain to the web service on `WEB_PORT` through an HTTPS reverse proxy. Steam OpenID derives its callback and realm from the public URL, so the application code does not need a domain-specific callback. Preserve both player secrets across deployments and ensure the proxy forwards the original host and HTTPS scheme.

### Discord command bot

The optional bot sends `/start`, `/stop`, `/reboot`, and `/safereboot` through the authenticated Mastermind job pipeline and reports completion or failure back to Discord. It includes Discord user/role authorization and attributes jobs to its dedicated Mastermind account. See **[discord-bot/README.md](discord-bot/README.md)**.

---

## First-run walkthrough

1. **Run one command:** `make start` (or `bash scripts/start.sh`).
2. **Login:** open `http://localhost:3000/login` and sign in with the bootstrap administrator configured in `infra/.env`.
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
| Bootstrap admin cannot sign in | Confirm `BOOTSTRAP_ADMIN_EMAIL` is correct, set a password when creating a new bootstrap account, then run `cd control-plane && pnpm prisma:seed`. |
| Web shows backend/API errors | Ensure control plane is running on the URL in `NEXT_PUBLIC_CONTROL_PLANE_URL` (default `http://localhost:3001`). |
| Auth failures | Check `JWT_SECRET` and that the user is in the org. For agent, check `JWT_AGENT_SECRET` and that the host’s key version matches. |

---

## Security notes

- **Signed jobs:** Agents authenticate with a JWT; the control plane only gives jobs to the correct host. See `docs/security-agent-pairing.md`.
- **Allowlists:** The agent runs commands via game adapters (no arbitrary shell by default). See `docs/security-review.md`.
- **Discord:** Webhook URL is stored per org; don’t log it. Rate limit outbound alerts.
- **Account approval:** public registrations are pending viewers. An administrator must approve them from **Accounts** before dashboard access is granted.
- **Login protection:** failed logins and registration/verification requests are persistently throttled by hashed account/IP buckets. Password resets, suspension, and approval changes revoke existing dashboard sessions.
- **Production:** use HTTPS and unique 32+ character secrets. See [`docs/SECURITY_AUDIT_2026-08-14.md`](docs/SECURITY_AUDIT_2026-08-14.md).

---

## Repository workflow

The `main` branch is protected. Submit changes through a pull request; direct pushes, force-pushes, and branch deletion are disabled. Pull requests require at least one approval, dismiss stale approvals after new commits, require approval from someone other than the last pusher, and require resolved review conversations. Review the staged diff for secrets and deployment-only files before opening a PR.

---

## Roadmap

- **Phase 1 (MVP):** Control plane + web + agent, pairing, server CRUD, job dispatch, basic 7DTD adapter.
- **Phase 2:** Schedules, bulk operations, Discord alerts, command macros.
- **Phase 3:** Multi-host, observability, command palette, further game adapters.

---

## License

MIT — see [LICENSE](LICENSE).
