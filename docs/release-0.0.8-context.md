# Mastermind 0.0.8 release context

## Release scope

Version 0.0.8 packages the Discord command bridge, mod configuration editor, and reliability work completed after 0.0.7. The release improves remote operations without changing the server-first architecture or weakening the agent's constrained execution model.

## Major changes

- Added an optional Discord bot with `/start`, `/stop`, `/reboot`, and `/safereboot`. It authenticates through a dedicated Mastermind account, waits for the resulting job, and edits its Discord reply with success or failure.
- Discord bot access can be restricted by Discord role IDs and/or individual user IDs. Guild-scoped registration makes commands appear quickly during setup.
- Added a Settings download and plain-language setup guide, copyable environment template, standalone Dockerfile, and opt-in Compose profile.
- Added mod config discovery and editing. The agent only exposes approved text extensions, rejects traversal and symlinks, limits files to 64 KiB, and atomically replaces files while preserving their permissions.
- Safe Restart jobs waiting on Blood Moon protection now publish `queued` progress with current/target day details, then return to `running` when restart begins.
- Long Blood Moon waits no longer block interactive RCON, chat replies, or read-only player polling.
- Discord chat relay now isolates enrichment failures, deduplicates replayed log timestamps, avoids the generic alert-rule limiter for unique chat events, and persists failed deliveries for retry.
- Player Disconnected Discord alerts now include the completed session duration.
- Frigate is deprecated and hidden from Settings and new alert creation. Backend endpoints, model fields, and stored configuration remain intact so deprecation is reversible.

## Runtime and safety model

- Discord commands enter the normal authenticated Mastermind job pipeline; the bot does not contact 7DTD or the host agent directly.
- Use a dedicated least-privilege Mastermind account for the bot and restrict Discord commands to trusted roles or users.
- Never commit Discord tokens, Mastermind credentials, webhook URLs, agent keys, JWT secrets, telnet passwords, SSH/WireGuard keys, save data, VM images, or deployment `.env` files.
- Mod config editing is intentionally limited to regular files under the selected active mod folder. Changes may require the mod's reload command or a game-server restart.
- Frigate deprecation is non-destructive: existing data is retained, but users cannot create new Frigate alerts or edit its settings through the current UI.

## Deployment notes

- Rebuild and redeploy the Go agent for mod config jobs and Safe Restart progress reporting.
- Rebuild the control plane for progress callbacks, queued-state normalization, resilient chat relay, and disconnect session durations.
- Rebuild the web application for the mod editor, Discord bot setup/download, queued job presentation, and Frigate deprecation.
- The Discord bot is optional. Configure the documented environment values and start the `discord-bot` Compose profile only when wanted.
- No Prisma schema migration is required for this release.

## Validation checklist

1. Run `gofmt` and `go test ./...` in `agent`.
2. Run production builds for the control plane, web application, and Discord bot syntax check.
3. Confirm the control-plane `/health` response reports `0.0.8`.
4. Verify the web, control-plane, database, Redis, agent, game server, and WireGuard tunnel remain healthy after deployment.
5. Review the staged diff and scan tracked files for secrets before tagging.

## Release checklist

1. Confirm versions are `0.0.8` in the root, control-plane, web, and health response.
2. Commit the complete scoped change set to `main` and push `origin/main`.
3. Create and push annotated tag `v0.0.8`.
4. Publish GitHub release `v0.0.8` using the changelog highlights.
5. Update the GitHub repository description to mention the Discord bot, safe operations, chat, mods, saves, and schedules.
