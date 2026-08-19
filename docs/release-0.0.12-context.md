# Release 0.0.12 context

Release `0.0.12` packages the current Mastermind 7DTD management platform after the 0.0.11 agent-resilience work. This document is a handoff for maintainers and future agents preparing, deploying, or reviewing the release.

## What changed

- Added a player-facing portal with Steam verification, individual player profiles, live map access, inventory/stat displays, supporter information, and a public shop flow.
- Added public live-map layers for Steam-verified players, animals, and hostiles, with persistent tiles, map history/trails, region labels, claims, nametags, player selection, and up to 72-hour tracking windows.
- Added Allocs and PrismaCore integrations for live entities, inventory, location data, claims, and map overlays while keeping webtokens and credentials server-side.
- Added Mailgun email confirmation, first-account administrator bootstrap, pending-account approval, escalating login lockouts, registration IP quotas, math challenges, optional reCAPTCHA, and a Security settings page.
- Added Cloudflare and DigitalOcean credential storage for future infrastructure automation, with encrypted secrets and connection tests.
- Added donator shop, Stripe checkout/webhooks, supporter status, cart flows, and player portal purchase identity handling.
- Added account Steam-link indicators and administrator-aware links from the player portal back to the dashboard.
- Improved player inventory quantity parsing for ServerTools `Slot N: quantity * item` snapshots and additional Allocs quantity field variants.
- Reworked the mod configuration editor as an IDE-style workspace with file tabs, line numbers, syntax coloring, search, wrapping, keyboard save, dirty-state indicators, AI edit proposals, and mandatory diff approval.
- Continued server operations: safe restart countdowns, bloodmoon-aware scheduling, save backup/restore/wipe workflows, mod quarantine/restore/delete/upload, profile staging, chat moderation, alerts, health telemetry, log streaming, Discord relay/bot support, and job accountability.
- Hardened the Go agent with bounded reads, serialized mutations, cancellation-aware backpressure, persistent log tailing, rotation handling, reusable backoff, bounded HTTP diagnostics, and connection pooling.

## Important behavior

- Dashboard and game-player identities remain separate. Steam-link status is shown when an organization account display name exactly matches a known player with a Steam ID.
- The player portal never receives dashboard credentials. The administrator dashboard link is only rendered for a portal profile recognized as an organization administrator.
- Player map markers require a verified Steam session. Animals and hostiles remain available without exposing player identities.
- API tokens, JWT secrets, passwords, Discord credentials, save data, profile data, SSH/WireGuard keys, and deployment `.env` files must not be committed.
- Mods and profile edits remain staged/queued until an explicit save, approval, or managed reboot operation applies them.

## Validation

- Go agent focused tests cover inventory/read parsing, log tailing, backoff, HTTP behavior, and job concurrency.
- Control-plane inventory parser tests cover ServerTools stack quantities and Allocs quantity variants.
- Production control-plane and web Docker builds were used for type/build validation where the deployment host was available.
- `git diff --check` should be run before tagging. Review staged files for secrets and deployment-only artifacts.

## Release checklist

1. Confirm the intended full worktree scope and inspect the staged diff.
2. Run focused tests and production builds on Linux/CI.
3. Update package/provider versions and README/CHANGELOG references to `0.0.12`.
4. Build and deploy control-plane/web and restart only the affected services; do not restart the game server solely for an application release.
5. Verify `/api/health`, dashboard login, player Steam login, map layers, inventory quantities, account Steam status, and admin dashboard link behavior.
6. Tag `v0.0.12`, push the branch/tag, and publish release notes from this context.
