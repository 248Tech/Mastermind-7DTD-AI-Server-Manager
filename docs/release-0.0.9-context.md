# Mastermind 0.0.9 release context

## Release scope

Version 0.0.9 packages the live map, integrated player-profile workflow, organization account administration, interface themes/navigation, server-chat parsing, and beginner-oriented Discord setup completed after 0.0.8.

## Major changes

- Added an authenticated live server map backed by official 7DTD rendered map tiles and a private server-side proxy. It shows current players, animals, hostiles, coordinates, game time, and region boundaries.
- Added land-claim markers and 51-by-51 protection rectangles from the active save's `players.xml`, including owner, Steam ID, EOS ID, and block coordinates.
- Added browser-local map snapshots, timeline scrubbing, selectable windows from 5 minutes through 72 hours, player-specific tracking, dimming of unrelated players, and customizable high-contrast trail colors.
- Integrated RussDev7 / DannyRuss's GPL-3.0 7D2D Profile Editor at pinned upstream commit `270f998adf70f3724afd93ba0e08569e3ba78c95`. Attribution appears in the UI, API, integration README, and container build.
- Added agent jobs to list/read/stage player `.ttp` files. Edited files are validated, queued outside the save, and installed only while the server is stopped during the next Mastermind-managed start or restart.
- Before profile installation, the current `.ttp` and companion `.ttp.bak` are archived with timestamps and JSON audit metadata. Replacement uses an atomic same-directory rename.
- Added an administrator-only Accounts page for creating operator/viewer accounts, including dedicated Discord bot identities, and deleting organization access. Self-deletion and removal of the final administrator are blocked; historic job attribution remains intact.
- Added Original, Dark, and Light browser-local themes and reorganized the long sidebar into grouped, scrollable sections that retain compact and mobile behavior.
- Added parsing of non-player `say` output into the Chat page under the name `Server`. These entries are deliberately excluded from the player-chat Discord relay to prevent echo loops.
- Rewrote Discord bot setup guidance for first-time users with explanations of every credential, exact `.env` location and purpose, safe temporary-note handling, Windows commands, and Accounts-page creation.

## Runtime and safety model

- Live-map browser access requires an authenticated Mastermind session. The 7DTD Web Dashboard and telnet listener are not exposed publicly.
- The Docker telnet relay binds only to the Docker bridge address and forwards to the host-loopback listener. It does not publish a LAN/public port.
- Map history is browser-local and accumulates while the Live Map is open. It is not a server-side surveillance archive or a cross-browser history store.
- Save and map mounts are read-only inside the web container. Land-claim parsing never changes the save.
- Profile paths must resolve beneath the configured save root, target regular `.ttp` files inside a `Player` directory, remain below 2 MiB, and contain a valid TTP header.
- Profile changes never overwrite a running server's live file. Application requires a fully stopped process and creates recoverable timestamped originals first.
- Account creation/deletion requires organization administrator access. Passwords use the current salted-scrypt format; secrets are never returned after creation.
- Never commit Discord tokens, webhook URLs, Mastermind passwords, API secrets, JWT secrets, telnet passwords, agent keys, SSH/WireGuard keys, save data, profile data, or deployment `.env` files.

## Deployment notes

- Rebuild and redeploy the Go agent for profile list/read/stage jobs and apply-on-start behavior.
- Rebuild the control plane for organization account APIs, profile-editor attribution, server-chat parsing, and new job types.
- Rebuild the web application for Accounts, Profile Editor, Live Map, themes, sidebar navigation, and revised Discord instructions.
- Start the isolated `profile-editor` service and private `telnet-relay` service from Compose.
- Configure `SEVENDTD_WEB_URL`, `SEVENDTD_WEB_API_TOKEN_NAME`, and `SEVENDTD_WEB_API_SECRET` for live map access. Update the read-only save/map mount paths for each installation rather than copying the example host paths blindly.
- No Prisma schema migration is required for this release.

## Validation checklist

1. Run `gofmt` and `go test ./...` in `agent`.
2. Run production builds for the control plane and web application.
3. Confirm the control-plane `/health` response reports `0.0.9`.
4. Verify authenticated live-map entity and claim feeds without exposing 7DTD dashboard or telnet ports.
5. Verify profile discovery, staged download interception, stopped-server installation, and timestamped backup creation.
6. Verify an administrator can create/delete a non-admin account, cannot delete themself, and cannot remove the last administrator.
7. Verify all three UI themes and desktop, compact, and mobile navigation.
8. Review the staged diff and scan tracked files for secrets before tagging.

## Release checklist

1. Confirm versions are `0.0.9` in the root, control-plane, web, lockfile, and health response.
2. Commit the complete scoped change set to `main` and push `origin/main`.
3. Create and push annotated tag `v0.0.9`.
4. Publish GitHub release `v0.0.9` using the changelog highlights.
5. Update the GitHub repository description to mention live maps, player profiles, accounts, safe operations, Discord, mods, saves, and automation.
