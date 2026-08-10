# Mastermind 0.0.6 release context

## Current repository state

Release `0.0.6` collects the server-control, player administration, Logs console, Saves, retention, and automatic backup work completed after `0.0.5`. The customized Linux deployment already runs this code. Preserve unrelated working-tree changes and the untracked root artwork duplicates when preparing future commits.

## Scope

Version 0.0.6 extends the operational, server-first 7 Days to Die management interface introduced in 0.0.5. It includes persistent logs and alerts, health monitoring, authoritative player state, mod lifecycle controls, RegionHealer controls, account-attributed jobs, password changes, responsive layouts, branding, safe restart/save-wipe workflows, an interactive console, player administration, and full save management.

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

Raw console input is limited to one non-empty command of at most 512 characters at both the control plane and agent. The Logs page waits for the corresponding RCON job and renders its output or failure inline.

Save backup IDs must match `mastermind_YYYY-MM-DD_HH-MM-SS` or RegionHealer's `snap_YYYY-MM-DD_HH-MM-SS` format and remain direct children of the fixed RegionHealer backup root. Full restores replace the configured world save; RegionHealer restores replace only its `Region` directory. Restore requires `7dtd.service` to already be inactive, pauses RegionHealer, and deliberately leaves the game and healer stopped for inspection. Delete and restore require explicit confirmation. Full-backup retention deletes only older `mastermind_*` directories and never RegionHealer `snap_*` data.

## Changes released in 0.0.6

### Players and server control

- Player identities are reconciled across name-only, Steam, and EOS observations to prevent duplicate rows.
- Kick and ban use the platform-qualified identifiers expected by 7DTD and detect rejected console commands.
- Administrator state is read from `serveradmin.xml`; admins can promote or demote players through constrained jobs.
- Players and Server Manager include **Kick all**, an optional reason, and a follow-up `lp` check that requires zero remaining players before reporting success.
- Optional Blood Moon restart protection persists at organization level. On an in-game day divisible by seven, restart waits until the next game day.
- Server restart waits for a verified inactive service before starting it again, preventing false-success restarts.

### Logs console

- The Logs page now has an interactive telnet/RCON command box.
- Command output, rejection, timeout, and transport errors appear inline.
- Empty, multiline, and over-512-character commands are rejected.

### Saves and RegionHealer integration

- New **Saves** navigation page and Server Manager link.
- `SAVE_LIST` inventories full-world backups and the existing RegionHealer snapshots together.
- `SAVE_BACKUP` issues `saveworld`, records UTC creation time and parsed in-game day, then copies the complete configured world save.
- `SAVE_RESTORE` supports full-world or Region-only restore while the server is off.
- `SAVE_DELETE` permanently removes one validated snapshot after confirmation.
- `SAVE_RETENTION` immediately applies the selected full-backup retention count.
- Full-world backup policy is stored in the existing Schedule record: retention from 1–100 and intervals of 15, 30, 60, 120, 360, 720, or 1440 minutes. Disabled scheduling retains the retention setting.
- Cron parsing now supports step expressions such as `*/15` and `0 */2`.
- Scheduled jobs now receive the merged server/install/telnet configuration required by the agent; previously scheduler-created jobs sent only the user payload.
- Schedule updates remove the previous delayed BullMQ occurrence before enqueueing the replacement.
- Fixed a retention slice-bound panic when the requested retention exceeded the number of existing full backups.

### Job types added

`PLAYER_KICK_ALL`, `PLAYER_ADMIN_LIST`, `PLAYER_ADMIN_PROMOTE`, `PLAYER_ADMIN_DEMOTE`, `SAVE_LIST`, `SAVE_BACKUP`, `SAVE_RESTORE`, `SAVE_DELETE`, and `SAVE_RETENTION`.

## Save storage model

- Live world: resolved from `GameWorld`, `GameName`, and `UserDataFolder` in `serverconfig.xml`.
- Shared snapshot root: `/opt/regionhealer/RegionAutoFix/Saves` in the current deployment.
- `mastermind_*`: complete world saves with `.mastermind-save.json` metadata.
- `snap_*`: RegionHealer-managed Region-only snapshots. Older snapshots have no game-day metadata and display **Unknown**.
- The hardened agent unit includes `/opt/regionhealer/RegionAutoFix/Saves` in `ReadWritePaths`. The `mastermind-agent` service account belongs to the `serveradmin` group so it can manage the live save and snapshot trees without broad filesystem access.

## Deployment notes

- Run Prisma schema synchronization/migration before starting the updated control plane. A formal migration should be added for production release processes currently relying on `prisma db push`.
- Rebuild and redeploy the Go agent to receive log tailing, player polling, mod actions, wipe sequencing, and verified restart behavior.
- `deploy-agent.sh` requires `MASTERMIND_ADMIN_EMAIL` and `MASTERMIND_ADMIN_PASSWORD`; do not place credentials in Git.
- Deployment-specific `.env`, agent keys, JWTs, pairing tokens, telnet passwords, Discord webhooks, SSH keys, WireGuard keys, saves, and server configuration must remain outside the repository.
- RegionHealer source/runtime is not vendored. Install it separately and preserve its upstream MIT license.
- Reinstall the tracked `mastermind-agent.service` when deploying Saves support; its systemd write-path whitelist changed.
- The scheduler stores the full-backup policy in a normal `Schedule` row rather than adding organization schema fields, so no new Prisma migration is required specifically for retention/interval settings.
- Do not commit deployment credentials or the generated `.mastermind-save.json` files. Save data remains outside the repository.

## Validation status

The customized deployment previously verified web/control-plane health, agent heartbeats, server discovery, log ingestion and retention, keyword alerts, health samples, player parsing/reconciliation, password changes, per-server job filtering, telnet console jobs, RegionHealer controls, mod inventory, quarantine/restore round trips, responsive production web builds, and fresh-world creation after a wipe. No live destructive mod operation should be repeated only for testing.

Windows publishing workstation lacks Go, Node/pnpm, Docker, and WSL tooling in its current shell, so release-time source checks may be limited to Git whitespace and static inspection unless validation runs inside the Linux deployment host or CI.

The 0.0.6 Saves work was validated on the Linux VM with Go formatting, `go test ./internal/games/7dtd/...`, a full agent build, NestJS/Next.js production image builds, and container health checks. A live non-disruptive full backup succeeded as `mastermind_2026-08-10_20-05-07` (66 MB, game day 11), and `SAVE_LIST` returned that backup plus 24 RegionHealer snapshots. Restore and delete were intentionally not executed against production data. Retention was then verified with a fresh successful `SAVE_RETENTION` job after fixing the slice-bound panic.

Current customized deployment policy at handoff: full backup every 60 minutes, retain 20 full backups, next-run state persisted in PostgreSQL. `7dtd`, `mastermind-agent`, `regionhealer`, and `wg-quick@wg0` were active; web and control-plane containers were healthy.

## Release/push checklist

1. Review the complete dirty worktree and separate any unrelated user changes.
2. Ensure the new untracked Saves page and player identity helper are included in the intended commit.
3. Do not add root-level duplicate artwork unless intentionally required; deployed web artwork already lives under the web public assets.
4. Run `git diff --check`.
5. Run agent tests/build and control-plane/web production builds on Linux or in CI.
6. Review `CHANGELOG.md`, choose the next semantic version, and update package/health versions consistently.
7. Confirm no `.env`, token, password, key, save, VM image, or deployment-only configuration is staged.
8. Commit and push only after reviewing `git diff --cached`.
