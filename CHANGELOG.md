# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- (none)

### Changed

- (none)

### Fixed

- (none)

## [0.0.7] - 2026-08-11

### Added

- Added a persistent, optional auto-scroll/follow toggle to the Logs page so operators can follow new output or hold their reading position.
- Added a privileged emergency Kill process control with an explicit data-corruption warning and immediate SIGKILL semantics.
- Added mod activation date/time tracking and sortable name, activation date, and author columns to the Mods page.
- Added a Safe restart server control that broadcasts a six-message 60-second countdown, flushes and backs up the world, kicks and verifies all players, and performs a verified restart.
- Added a beginner-friendly day, hour, and minute schedule builder while retaining direct cron expressions as an advanced option.
- Bumped repository, control-plane, web, and health endpoint versions to `0.0.7`.

### Changed

- Improved Logs page load and refresh performance with incremental log polling, bounded rendering, and less frequent alert refreshes.
- Corrected health charts to scope samples by host, plot the complete selected time window using real timestamps, and distinguish current values from historical averages.
- Added a customizable dashboard Quick Access section for Logs, Health, Players, Mods, Saves, Jobs, Schedules, Alerts, and Region Healer, with per-browser saved preferences.
- Added role-protected rename and unregister controls for registered hosts and server instances, with destructive-action confirmations that distinguish registry removal from deleting game files.
- Improved mod inventory loading by allowing read-only active/quarantine scans alongside long serialized server actions and reducing UI job-result polling latency.
- Fixed restored mods retaining quarantine permissions that prevented the 7DTD service account from reading `ModInfo.xml`; restored trees now receive loader-safe directory and file modes.
- Added per-rule alert pipeline testing with real Discord delivery, inline success/failure results, role protection, webhook validation, retries/rate limiting, and audit logging.
- Added Player Connected and Player Disconnected Discord alert rules driven by real 7DTD log state transitions, including server, player name, Steam ID, and EOS ID details with duplicate-event suppression.
- Added a dedicated player-only Chat section that parses genuine 7DTD chat lines, stores clean history, filters server messages, and optionally relays each server’s chat to a validated Discord webhook with mention suppression.
- Added a Chat reply box that safely sends operator messages through the audited RCON job pipeline with an automatic `say` prefix so they appear in-game as Server.

### Fixed

- Prevented duplicate Discord player lifecycle alerts by ignoring preliminary login and teleport spawn lines and deduplicating repeated connect/disconnect deliveries for 15 seconds.
- Routed scheduled 7DTD restart jobs through the full safe-restart protocol while preserving immediate manual Restart behavior.
- Fixed successful server kills appearing ineffective by waiting for job completion and using game reachability—not host-agent connectivity—for server online status.
- Made Kill idempotent so clicking it when 7DTD is already stopped verifies success instead of creating a failed job.
- Fixed restored 7DTD saves being owned exclusively by the agent, which prevented the game from rewriting ConfigsDump XML files.
- Hardened save wipes to flush the world, attempt a bounded graceful shutdown, escalate hung processes to SIGKILL, verify PID removal, and only then delete the configured save.
- Fixed save restores blocked by stale rollback directories using privileged cleanup restricted to the configured save's exact `.mastermind-restore-old` sibling.
- Ensured full-world restores return ownership to the 7DTD service account before startup, preventing restored `main.ttw` backup/write failures.
- Fixed active mod inventory and game loading failures by granting the shared server/agent group inherited read/write access to the configured Mods directory.

## [0.0.6] - 2026-08-10

### Added

- Added a Saves page for manual full-world backups, Region Healer snapshot inventory, recorded backup time/game day, server-off restore, and confirmed deletion.
- Saves now supports persistent full-backup retention and automatic intervals from 15 minutes through daily; retention never removes Region Healer snapshots.
- Added an interactive telnet command console to the Logs page with inline command responses, timeout/error feedback, and single-command input validation.
- Players page can read administrator membership and permission levels from the configured `serveradmin.xml`.
- Organization administrators can promote or demote players through constrained 7DTD console jobs; the game remains responsible for updating its XML.
- Settings includes optional Blood Moon restart protection. Restart jobs on in-game days divisible by 7 remain running until the next game day, then restart normally.
- Players and server management include Kick all with an operator-provided reason and an automatic `lp` verification requiring 0 remaining players.

### Changed

- Bumped repository, control-plane, web, and health endpoint versions to `0.0.6`.
- Scheduled jobs now receive resolved server configuration, and cron scheduling supports minute/hour step expressions.
- Hardened the agent service with narrowly scoped access to RegionHealer save snapshots.

### Fixed

- Fixed duplicate player identities across name, Steam, and EOS observations.
- Fixed rejected promote, demote, kick, ban, kick-all, and restart actions through corrected identifiers and result verification.
- Fixed save-policy retention hanging when fewer full backups exist than the configured retention count.

## [0.0.5] - 2026-08-10

### Added

- Server-first dashboard with per-server management and filtered job history.
- Persistent log tailing, retention settings, keyword alerts, and alert history.
- Host/game health monitoring with CPU, memory, disk, latency, reachability, and configurable intervals.
- Authoritative 7DTD player polling with Steam/EOS identity, session/lifetime playtime, last-seen, kick, and ban controls.
- Mod inventory with metadata parsing, multi-select, quarantine, restore, and constrained permanent deletion.
- RegionHealer service controls, account password changes, job actor attribution, responsive/mobile layouts, and branded artwork.
- Confirmed, path-constrained world-save wipe and fresh-save verification.

### Changed

- Bumped repository, control-plane, web, and health endpoint versions to `0.0.5`.
- Hardened agent deployment and service permissions around 7DTD, Mods, Saves, and RegionHealer.
- Deployment helper now requires administrator credentials through environment variables instead of embedding defaults.

### Fixed

- Pairing authorization/token generation, successful 2xx handling, BullMQ queue names, and normal-job claiming.
- False online players and incorrect session totals by making scheduled `lp` results authoritative.
- Save-wipe I/O failures by stopping and verifying 7DTD before deletion.
- Restart jobs that reported success without restarting; agent now waits for complete shutdown, starts, and verifies active state.
- Command runner timeout context now applies to the spawned process.

## [0.0.4] - 2026-04-08

### Added

- Windows bootstrap + start flow via `scripts/setup.ps1` and `scripts/start.ps1`, matching the Linux one-command setup.
- Agent-side 7DTD autodiscovery for same-host installs using local `serverconfig.xml` / `sdtdserver.xml`, `Mods/`, and `serveradmin.xml`.
- Agent-authenticated server discovery sync endpoint so paired hosts can auto-create or update their own 7DTD server instance records.
- Frigate webhook ingestion plus org-level Frigate settings and connection test support.
- Scheduler/fire-and-forget jobs now annotate `scheduleId` through queue data to the agent executor.

### Changed

- Bumped repo, control-plane, and web package versions to `0.0.4`.
- README, quickstart, install guide, and agent docs now document autodiscovery-based onboarding and current startup flows.
- Agent now dispatches jobs through registered game adapters instead of the placeholder runner path.
- Alerts, schedules, and settings dashboards now use live backend routes and current enum values.

### Fixed

- Agent/control-plane JSON field mismatches in pairing, heartbeat, job polling, and job result submission.
- Job polling now reads the actual `{ job: ... }` response envelope from the control plane.
- Control plane now normalizes UI job aliases like `start`, `stop`, `restart`, and `rcon` to backend job types.
- Job payloads now include resolved server instance config so 7DTD adapter executions have install path and telnet settings.
- Host onboarding docs now align with available schedules, alerts, org settings, and same-host 7DTD autodiscovery APIs.

## [0.0.3] - 2026-03-18

### Added

- One-line startup command via `make start` / `scripts/start.sh`.
- Agent binary download endpoints: `GET /agent/download/:platform`.
- Alerts CRUD API routes under `/api/orgs/:orgId/alerts`.
- Schedules CRUD API routes under `/api/orgs/:orgId/schedules`.
- Org settings update route `PATCH /api/orgs/:orgId` (Discord webhook support).
- Host onboarding improvements: setup wizard + agent download/build panel.
- `QUICKSTART.md` with expanded setup/API reference.

### Changed

- README updated for release `0.0.3` and new one-line quickstart.
- Bootstrap flow now builds agent binaries into `control-plane/public/agents`.
- Control-plane startup now auto-selects an available port if the preferred port is occupied.

### Fixed

- Host onboarding docs now align with available schedules/alerts/org settings APIs.

## [0.0.1] - 2026-03-11

### Added

- Initial usable control-plane + web + agent workflow.
- Auth endpoints and login/register UI.
- Org, host, server-instance, and job API modules.
- Agent pairing + heartbeat + job poll/result loop.
- Dashboard/Hosts/Jobs pages for daily operations.

### Changed

- README now documents current implemented features and install/first-run guide.

### Fixed

- (none)
