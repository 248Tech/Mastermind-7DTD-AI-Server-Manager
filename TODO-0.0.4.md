# TODO 0.0.4

## Control plane
- Finish full scheduler UI + queue wiring (enable jobType payload, last-run status, enable/disable controls).
- Wire alert rule CRUD into real Discord plumbing, persist channel metadata, and hook the UI buttons to the new API.
- Harden pairing & job error paths that surfaced while adding new fields (timeouts, backoff, logging).
- Rationalize pairing + heartbeat docs in /docs and make sure health root lists every new endpoint.

## Web
- Complete the alerts and schedules dashboard pages (list, edit, delete) so the API work is discoverable.
- Finish settings page updates so org webhooks can be edited in place and invalid URLs surface validation.
- Polish the new setup wizard interactions (tours, skip/next) and ensure host pairing tokens flow cleanly.
- Sync /web/package.json scripts with CI and ensure NEXT_PUBLIC_CONTROL_PLANE_URL is feature-flagged when env var missing.

## Agent & Scripts
- Validate scripts/start.sh and scripts/bootstrap.sh produce deterministic binaries; document path for downloads.
- Ensure PowerShell helpers (scripts/*.ps1) cover Windows user onboarding; test scripts/start.ps1 and scripts/setup.ps1 end-to-end.
- Update agent/internal/jobs executor and runner to expose new job metadata needed for schedule-driven dispatch.
- Align scripts/doctor.sh with the new dependencies (Go 1.22+, pnpm 9, Docker Compose v2) and add explicit health checks for required ports.
