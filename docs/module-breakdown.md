# Module Breakdown

## Control Plane (NestJS)

| Module | Responsibility | Key deps |
|--------|----------------|----------|
| **auth** | JWT issue/validate, org context, RBAC guards | passport, org repo |
| **orgs** | Org CRUD, membership, invite | TypeORM/Prisma entities |
| **hosts** | Host registration, agent heartbeat ingestion, host↔org | Redis (presence), PG |
| **jobs** | Create job, enqueue (BullMQ), status, result storage | BullMQ, PG |
| **scheduler** | Cron-like schedules → job creation | @nestjs/schedule, jobs |
| **events** | Event ingestion, rule evaluation, dispatch to alert engine | in-memory or Redis |
| **alerts** | Alert rules, Discord webhook, in-app notifications | Discord API, events |
| **game-adapters** | Registry of game types (7DTD, etc.), adapter config per host | config store |
| **websocket** | Real-time: log stream, job status, alerts | @nestjs/websockets, auth |
| **discord-bot** | Slash commands / messages → translate to API calls | discord.js, auth, jobs |
| **api** | REST controllers, DTOs, validation | all above |

---

## Web Frontend (Next.js + Tailwind + shadcn)

| Module | Responsibility | Key components |
|--------|----------------|----------------|
| **auth** | Login, org switch, session | NextAuth or custom JWT, middleware |
| **layout** | App shell, nav, org-scoped layout | sidebar, org selector |
| **dashboard** | Overview: hosts status, recent jobs, alerts | cards, tables |
| **hosts** | Host list, detail, register agent, heartbeat status | data table, detail page |
| **jobs** | Job list, create job, view logs/result | form, log viewer (stream) |
| **schedules** | CRUD scheduled jobs | form, table |
| **alerts** | Alert rules, history | form, table |
| **settings** | Org settings, API keys, Discord link | forms |
| **realtime** | WS client for log stream + job updates | hook + provider |

---

## Agent (Go)

| Module | Responsibility | Key packages |
|--------|----------------|--------------|
| **main** | Entry, config (env/file), systemd-friendly logging | flag/env |
| **client** | HTTP client to CP: heartbeat, fetch jobs, submit result, upload logs | net/http, retry |
| **runner** | Execute local command with allowlist; capture stdout/stderr; timeout | os/exec, policy |
| **policy** | Safety: allowed commands, paths, env; reject unsafe payloads | config struct |
| **heartbeat** | Tick 5–10s, send host ID + status + optional metrics | client |
| **jobs** | Poll or subscribe jobs for this host; run via runner; report back | client, runner |
| **games** | Optional: RCON/Telnet/API clients per game type; call from runner or dedicated | 7dtd rcon, etc. |
| **stream** | Stream logs to CP (chunked HTTP or WS) | client |

---

## Cross-Cutting

- **Control plane ↔ Agent:** Shared job payload schema (JSON), heartbeat payload, auth (agent token or host key).
- **Web ↔ Control plane:** REST + WebSocket; JWT in header / cookie.
- **Discord ↔ Control plane:** Bot token; webhook for alerts; optional slash command → job.
