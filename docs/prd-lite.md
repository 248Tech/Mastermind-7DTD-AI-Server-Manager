# Mastermind — Distributed Game Server Control System

## PRD (Lite)

### Problem
Operators need to manage multiple game servers (e.g. 7 Days to Die) across hosts: start/stop, config, updates, logs, and alerts—with org-scoped access and auditability.

### Solution
**Control Plane (central)** + **Per-Host Agent (edge)**. Control plane owns auth, scheduling, and state; agents execute commands and stream data on each host.

### Out of Scope (v1)
- Multi-region CP; single CP instance.
- Agent auto-update from CP (manual/SSH for now).
- In-game mod/plugin management beyond config files.

### Core Flows
1. **Operator** → Web UI or Discord → Control Plane → enqueue job → Agent (target host) runs command → result/stream back.
2. **Agent** → heartbeat + metrics → Control Plane → store state; alerts if heartbeat missed.
3. **Game server** → RCON/Telnet/API → Agent (optional) → Control Plane for visibility (logs, metrics).

### Non-Functional
- **Multi-tenant:** Org-based isolation; RBAC (admin, operator, viewer).
- **Resilience:** CP stateless where possible; Redis/BullMQ for queues; PostgreSQL for durable state.
- **Safety:** Agent enforces allowlists (commands, paths, ports); no arbitrary shell by default.
- **Observability:** Structured logs, metrics (heartbeat, job duration), alert rules → Discord/web.

### Success (v1)
- Deploy CP + 1 agent; start/stop one game server from UI; see logs in UI; receive Discord alert on heartbeat failure.
