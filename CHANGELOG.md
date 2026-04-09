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
