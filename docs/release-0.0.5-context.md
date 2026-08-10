# Mastermind 0.0.5 context

## Scope

Version 0.0.5 turns Mastermind into an operational, server-first 7 Days to Die management interface. It adds persistent logs and alerts, health monitoring, authoritative player state, mod lifecycle controls, RegionHealer controls, account-attributed jobs, password changes, responsive layouts, branding, and safe restart/save-wipe workflows.

## Runtime model

- Next.js web UI talks to the NestJS control plane.
- PostgreSQL stores configuration, jobs, logs, alerts, health samples, and player history.
- Redis/BullMQ dispatches server-scoped jobs.
- Restricted Go agents run on game hosts, report heartbeats/metrics, tail logs, poll `lp`, and execute adapter jobs.
- 7DTD telnet should remain loopback-only. Public game traffic and any WireGuard relay are deployment concerns, not managed by this release.
- RegionHealer-v2 remains a separate installation controlled through a narrowly scoped systemd service.

## Important safety behavior

Save wipe requires `confirmed: true`, resolves `GameWorld`, `GameName`, and `UserDataFolder` from `serverconfig.xml`, validates containment beneath `Saves`, stops RegionHealer, stops and verifies `7dtd.service`, deletes only the resolved save through a constrained helper, restarts 7DTD, waits for a fresh `main.ttw`, and resumes RegionHealer.

Restart no longer treats telnet `quit` acknowledgement as completed shutdown. It waits up to two minutes for `7dtd.service` to become inactive, starts the configured server command, then verifies the service becomes active. This fixes successful-looking restart jobs that never replaced the game process.

Mod operations reject invalid names and symlink targets. Quarantine moves a mod outside `Mods`; restore refuses overwrite; deletion targets one validated direct child. Bulk UI actions enqueue the same constrained job once per selected mod.

## Deployment notes

- Run Prisma schema synchronization/migration before starting the updated control plane. A formal migration should be added for production release processes currently relying on `prisma db push`.
- Rebuild and redeploy the Go agent to receive log tailing, player polling, mod actions, wipe sequencing, and verified restart behavior.
- `deploy-agent.sh` requires `MASTERMIND_ADMIN_EMAIL` and `MASTERMIND_ADMIN_PASSWORD`; do not place credentials in Git.
- Deployment-specific `.env`, agent keys, JWTs, pairing tokens, telnet passwords, Discord webhooks, SSH keys, WireGuard keys, saves, and server configuration must remain outside the repository.
- RegionHealer source/runtime is not vendored. Install it separately and preserve its upstream MIT license.

## Validation status

The customized deployment previously verified web/control-plane health, agent heartbeats, server discovery, log ingestion and retention, keyword alerts, health samples, player parsing/reconciliation, password changes, per-server job filtering, telnet console jobs, RegionHealer controls, mod inventory, quarantine/restore round trips, responsive production web builds, and fresh-world creation after a wipe. No live destructive mod operation should be repeated only for testing.

Windows publishing workstation lacks Go, Node/pnpm, Docker, and WSL tooling in its current shell, so release-time source checks may be limited to Git whitespace and static inspection unless validation runs inside the Linux deployment host or CI.
