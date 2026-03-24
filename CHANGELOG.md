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

## [0.0.4] - 2026-03-24

### Added

- A Windows bootstrap + start flow (`scripts/setup.ps1`, `scripts/start.ps1`) that mirrors the Linux one-command experience and builds Go binaries.
- `scripts/doctor.sh` now validates Node 20+, pnpm 9+, Go 1.22+, Docker Compose v2 and reports Postgres/Redis reachability.
- Scheduler/fire-and-forget jobs now annotate `scheduleId` from the control plane through `QueueJobData`, `client.Job`, and the agent executor.
- Alerts, schedules, and settings dashboards drop the “API coming soon” notices and use the backend job/alert enum values.
- `web/package.json` gains `lint:ci` and `check-env` helpers for CI/production validation.

### Changed

- Control-plane package/health version bump to `0.0.4`; README now reflects the latest release notes.
- Alert rule creation defaults to `SERVER_DOWN` and scheduler job form defaults to `SERVER_START`.

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
