# Changelog

## [0.0.12] - 2026-08-18

- Added the Steam-aware player portal, live map layers, player profiles, map history/trails, claims, inventory/stat displays, and supporter/shop flows.
- Added Mailgun confirmation, account approval, Steam-link indicators, administrator portal links, escalating login protection, registration quotas, reCAPTCHA support, and encrypted Cloudflare/DigitalOcean settings.
- Added Allocs/PrismaCore live-data integrations and preserved server-side handling of webtokens and credentials.
- Reworked the mod editor into an IDE-style editor with tabs, line numbers, syntax coloring, search, wrapping, keyboard save, and AI diff approval.
- Fixed ServerTools inventory stack quantities being displayed as one item; `Slot N: quantity * item` and common Allocs quantity fields are now preserved.
- Continued safe restart/save/mod/profile/chat/alert/health/log/Discord operations and agent resilience improvements.

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

Post-0.0.11 work (2026-08-17 and 2026-08-18) is included in `0.0.12`.

### Added

- Steam-signed-in player portal profile (`/player/profile`) with own stats, last `lp` position, last logout time, last inventory snapshot, and supporter summary.
- Steam-tied Stripe Checkout donations with a signed webhook, org-stored encrypted keys, and Settings → Stripe Donations. Custom gifts are $5–$500; supporter status is granted only from signed Stripe events.
- Donator shop: public catalog at `/player/shop`, item pages, localStorage cart, multi-item checkout, admin `/donator-shop` and `/purchases`. JPEG/PNG/WebP uploads are magic-byte validated and resized to WebP (master 1920px / thumb 400px).
- In-game-name password accounts for shop checkout (`auth: name`). Name sessions cannot read profile inventory/location or unlock live-map player markers.
- PrismaCore ClaimCreator WebAPI client (control-plane only) for staff map overlays (claims, vehicles, drones, homes, traders, POIs, reset regions, advanced claims) and shop live status (`serverReachable`, `playersOnline` count only).
- Allocs WebAPI client (control-plane only) for hostiles, animals, player inventory JSON, and allowlisted `visitmap` console commands.

### Changed

- Staff and player live maps read entities from Allocs + PrismaCore instead of telnet `le`. Allocs Webinterface 52 authenticates with `X-SDTD-API-TOKENNAME` / `X-SDTD-API-SECRET` headers. Allocs failures return empty arrays and a feed error; there is no telnet fallback.
- Staff inventory and background snapshots use Allocs `getplayerinventory` JSON instead of `st-pil` RCON jobs.
- Live-map `visitmap` start/stop is sent through Allocs `executeconsolecommand` (numeric bounds or `stop` only). Progress still comes from the server log file.
- Telnet `lp` remains the player roster source (ping, IP, kills) until PrismaCore `getplayersonline` can be probed after ClaimCreator `:11111` is up.

### Security

- PrismaCore `apiuser` password and Allocs webtoken stay in control-plane env. They never appear in Next public env, shop JSON, or map JSON.
- Shop status public keys are only `serverName`, `checkoutEnabled`, `serverReachable`, `playersOnline`.
- Allocs `executeconsolecommand` rejects `kick`, `give`, `st-pil`, `visitmap full`, and command chaining.
- Player `/me` omits IP addresses, Stripe identifiers, and other players’ data.

## [0.0.11] - 2026-08-14

### Added

- Added Kimi Code as a selectable Mod Editor agent alongside Codex, with encrypted Moonshot API-key storage, model selection, live connection testing, provider attribution, and the existing mandatory proposal/diff approval boundary.
- Added native chat moderation with an editable blocked-word directory, per-rule log/warn/kick actions, flood thresholds, mute/unmute controls, audited enforcement, and suppression of moderated messages from Discord relay.
- Added authenticated ZIP mod uploads up to 256 MiB. Archives are validated against traversal, symlinks, ambiguous nested mods, file-count/expanded-size limits, redundant `Mods`/wrapper folders, duplicate targets, and unsafe permissions before being placed in quarantine.
- Added live-map generation controls based on `map_info.xml`, including configurable section generation, explicitly warned full-world generation, current `visitmap` state/progress, and verified stop behavior.
- Added queued/applied profile-injection status and timestamps to the Profile Editor.
- Added lightweight agent operational instrumentation for goroutines, job concurrency/totals, heartbeat and poll failures, log throughput/failures, and in-memory backlog.

### Changed

- Reworked the Go log tailer to keep the server log open, follow truncation/rotation/replacement/deletion, batch at 64 KiB or 350 ms, retry failed chunks in order, and upload direct byte slices without the former reader/read-all copy.
- Configured pooled HTTP transports and request-specific deadlines so normal requests remain bounded while long polls receive their configured duration plus network grace.
- Added bounded exponential backoff with jitter to heartbeat, job polling, and log delivery failures.
- Bounded explicitly audited read-only jobs with `jobs.max_concurrent_reads` (default 8, maximum 64) and serialized arbitrary RCON/SEND_COMMAND jobs in both agent and control-plane classification.
- Removed the hard-coded `127.0.0.1:26900` host probe; reachability now uses the discovered/configured 7DTD endpoint on a slower cadence.
- Added build-time agent version reporting, cached static host metadata, SIGTERM-aware shutdown, safe empty-poll pacing, long-poll validation, and stale-running-job recovery.
- Scheduler occurrences now skip when the same schedule already has pending/running work instead of stacking duplicate long operations.
- Bumped repository, control-plane, web, health endpoint, and provider user-agent versions to `0.0.11`.

### Fixed

- Fixed live-map maximum zoom-out disappearing by aligning tile-layer and map minimum zoom.
- Fixed stale Map Generation controls that claimed generation was active after `visitmap` had ended.
- Fixed missing profile injection feedback by deriving queued/applied state from the agent staging and backup metadata.
- Fixed active player polling continuing against known-unreachable game hosts.
- Fixed successful empty job polls becoming a tight API request loop on control planes that return immediately.

### Security

- Kimi and OpenAI credentials remain encrypted and server-side; neither provider key is returned to browsers.
- Mod uploads are agent-authenticated, host-bound, short-lived, size-bounded, ZIP-signature checked, path constrained, symlink rejected, and removed after job completion.
- Machine-specific sudoers policy remains excluded from the public repository.

## [0.0.10] - 2026-08-13

### Added

- Added Codex-assisted mod configuration editing through the OpenAI Responses API, encrypted API-key storage, configurable Codex models, live connection testing, structured edit proposals, line-by-line diffs, and mandatory approval before saving.
- Added per-server high-ping kicking with configurable threshold, required consecutive samples, reason, cooldown, and minute-based enforcement.
- Added country-based connection enforcement with ISO country-code lists, kick/ban selection, duration/reason controls, lookup caching, and safe skipping of private or relay-masked addresses.
- Added player IP address capture from authoritative `lp` output, player level, zombie kills, player kills, deaths, and inventory inspection.
- Added player search, online/offline/admin filters, sorting, summary cards, manual refresh feedback, and responsive mobile player cards.
- Added player-name association to Profile Editor entries by matching EOS/Steam profile filenames against the active save's `players.xml`.
- Added administrator password resets for lower-tier organization accounts without exposing or requiring their original password.

### Changed

- Region-grid labels now come from actual `.7rg` filenames found in the active save and remain visible for every displayed region.
- OpenAI connection testing now sends a real Responses API request instead of trusting model-list presence. Default supported model changed from the listed-but-unusable `gpt-5-codex` alias to verified `gpt-5.3-codex`.
- Bumped repository, control-plane, web, and health endpoint versions to `0.0.10`.

### Security

- OpenAI API keys remain control-plane-only, are encrypted with AES-256-GCM at rest, never returned to browsers, and can be tested, replaced, or removed only by organization administrators.
- AI-generated mod edits never write automatically. Users must inspect and approve the diff, then explicitly save through the existing constrained atomic config-write job.

## [0.0.9] - 2026-08-12

### Added

- Added an authenticated live 7DTD map using official rendered terrain tiles, live players, animals, hostiles, coordinates, game time, and region-grid overlays.
- Added owned land-claim block markers and protection rectangles parsed from the active save.
- Added browser-local map history with selectable 5-minute through 72-hour windows, timeline scrubbing, player-specific tracking, and selectable highlighted trail colors.
- Integrated RussDev7's GPL-3.0 7D2D Profile Editor as an isolated service with visible credit, server profile discovery, staged editing, TTP validation, timestamped original archives, and atomic apply-on-next-start handling.
- Added an administrator-only Accounts page for creating operator/viewer accounts and removing organization access while retaining historical attribution.
- Added Original, Dark, and Light UI themes stored per browser.

### Changed

- Reorganized the sidebar into scrollable Overview, Server, Automation, and System groups for compact and mobile layouts.
- Expanded Discord bot instructions for users without technical or Discord experience, including exact file locations and an Accounts-page workflow for creating the bot login.
- Bumped repository, control-plane, web, and health endpoint versions to `0.0.9`.

### Fixed

- Server-authored `say` messages are now parsed into the Chat page as `Server` while remaining excluded from the player-only Discord relay.
- Profile staging is applied only while 7DTD is fully stopped and preserves both original `.ttp` and companion `.ttp.bak` files with audit metadata.

## [0.0.8] - 2026-08-11

### Added

- Added an optional downloadable Discord bot with `/start`, `/stop`, `/reboot`, and `/safereboot` commands, Mastermind job completion/failure replies, dedicated-account attribution, and Discord role/user authorization.
- Added beginner-oriented Discord bot setup and credential instructions to Settings, a copyable environment template, standalone/Docker packaging, and an optional Compose profile.
- Added constrained mod configuration discovery, reading, and atomic saving for supported text formats up to 64 KiB, with traversal and symlink protections.
- Added session playtime to Player Disconnected Discord messages.

### Changed

- Deprecated Frigate in the current UI by removing its Settings card and new-alert option while preserving backend support and stored configuration.
- Interactive RCON and read-only player queries can run concurrently while a long Safe Restart waits for Blood Moon protection.
- Bumped repository, control-plane, web, and health endpoint versions to `0.0.8`.

### Fixed

- Safe Restart jobs deferred by Blood Moon protection now report a nonterminal Queued phase with the current and target game day instead of appearing stuck Running.
- Fixed partial/replayed Discord chat ingestion by preventing player identity reconciliation failures from rejecting otherwise valid log chunks.
- Prevented busy Discord chat relays from silently dropping messages at the generic alert-rule rate limit; each persisted chat event now receives normal webhook delivery and retry handling.
- Prevented a Blood Moon-deferred Safe Restart from blocking chat replies and player polling by moving interactive RCON and read-only player queries onto the agent's concurrent execution lane.
- Added durable retry records for failed Discord chat webhooks and log-timestamp deduplication so transient delivery failures no longer lose messages and agent replays do not repost them.
- Normalized Blood Moon-deferred Safe Restart status to `queued` in the jobs API so every dashboard consumer shows the wait state consistently.

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
