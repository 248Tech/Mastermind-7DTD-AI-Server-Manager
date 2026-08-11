# Mastermind 0.0.7 release context

## Release scope

Version 0.0.7 packages the operational hardening and usability work completed after 0.0.6. It preserves the server-first architecture while making dangerous lifecycle operations verifiable, improving dashboard responsiveness, and adding player chat and richer Discord events.

## Major changes

- Added Safe Restart: six warnings over 60 seconds, `saveworld`, a full manual backup, verified `kickall`, and a verified service restart. Scheduled restart jobs are promoted to this same safe protocol.
- Added an explicitly dangerous emergency Kill control. The agent SIGKILLs the systemd unit's main process, prevents `Restart=on-failure` from respawning it, clears failed state, and verifies inactivity.
- Hardened save wipe to attempt a bounded graceful shutdown before escalating to Kill, then delete only the configured save after process verification.
- Fixed full-save restore ownership and stale `.mastermind-restore-old` cleanup through narrowly constrained privileged helpers.
- Added a dedicated Chat page that parses player messages, stores history, optionally relays them to Discord, and lets operators reply through an audited `say` command.
- Added Player Connected and Player Disconnected Discord alert types, per-rule test delivery, and short lifecycle deduplication. Preliminary login and teleport-spawn lines no longer emit false duplicate connection alerts.
- Improved log loading through incremental cursors, bounded rendering, less frequent alert refreshes, and a persistent optional auto-scroll toggle.
- Improved health graphs with host-scoped samples, real timestamps, correct time-window plotting, current readings, and historical averages.
- Added customizable dashboard Quick Access cards for Logs, Chat, Health, Players, Mods, Saves, Jobs, Schedules, Alerts, and Region Healer.
- Added role-protected host and server-instance rename/unregister actions. Registry removal is clearly separated from deleting game files.
- Improved mod inventory latency by allowing read-only scans alongside serialized mutations. Mod rows now expose activation time and sort by name, author, or activation date.
- Restored mods receive loader-safe permissions and a fresh activation timestamp so they load after restart.
- Added a simple day/hour/minute schedule builder while retaining direct cron input for advanced operators.
- Server status now reflects game reachability instead of agent connectivity, avoiding false online state after a Kill.

## Runtime and safety model

- The Next.js web UI communicates with the NestJS control plane; PostgreSQL stores state and Redis/BullMQ dispatches host jobs.
- The restricted Go agent executes only adapter-approved actions. State-changing jobs remain serialized; read-only mod inventory jobs may execute concurrently.
- 7DTD telnet should remain loopback-only. WireGuard relaying and public game-port exposure remain deployment concerns outside the application.
- Save deletion and rollback cleanup validate the configured `UserDataFolder`, `GameWorld`, and `GameName`. Privileged helpers accept only the live save or its exact restore-rollback sibling.
- Kill is intentionally non-graceful and may corrupt data. Safe Restart or graceful Stop should be used for normal maintenance.
- Discord webhook URLs, account credentials, agent keys, JWT secrets, telnet passwords, SSH/WireGuard keys, save data, VM images, and deployment `.env` files must never enter Git.

## Deployment notes

- Rebuild and redeploy the Go agent for Safe Restart, Kill, wipe escalation, restore permissions, mod timestamps, and concurrent inventory reads.
- Install both constrained helpers with `deploy-agent.sh`: `mastermind-wipe-7dtd-save` and `mastermind-fix-7dtd-save-permissions`.
- Reinstall/update the agent sudoers entry because 0.0.7 adds narrowly scoped `systemctl kill`, `reset-failed`, rollback cleanup, and save-permission repair commands.
- Rebuild the control plane for incremental logs, chat parsing, Discord lifecycle alerts, alert testing, and host/instance registry actions.
- Rebuild the web application for Chat, dashboard customization, health/log/mod performance work, schedule builder, and new controls.
- No Prisma schema migration is required specifically for the features in this release.

## Validation completed

- The Linux deployment successfully built the updated NestJS control-plane image and returned a healthy `/health` response after deployment.
- `7dtd.service` and `mastermind-agent.service` remained active after the latest control-plane deployment.
- Earlier changes in this release were exercised against the customized Linux VM while they were developed, including restart/kill/wipe state verification, mod restore permissions, save ownership repair, and UI/container rebuilds.
- Run `go test ./...`, the control-plane production build, and the Next.js production build again immediately before tagging. Avoid destructive live save/mod actions solely for release testing.

## Release checklist

1. Confirm versions are `0.0.7` in the root, control-plane, web, and health response.
2. Review the complete staged diff and verify no secrets or deployment data are included.
3. Run Git whitespace checks, Go formatting/tests/build, and production container builds.
4. Commit on `main`, push to `origin/main`, create annotated tag `v0.0.7`, and publish GitHub release `v0.0.7`.
5. Update the GitHub repository description to reflect Safe Restart, player chat/Discord relay, lifecycle alerts, and save/mod management.
