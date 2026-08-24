# Release 0.0.13 context

Release `0.0.13` documents the current Mastermind deployment and the verified player mod-request workflow. This is a maintainer and future-agent handoff; it describes implementation boundaries, validation, and release state without including credentials or deployment secrets.

## Recent change

- Added a **Request a mod** flow to the player portal at `/player`.
- Authenticated players can upload a ZIP archive (maximum 256 MiB) and provide a short description of what it adds or improves.
- The control plane validates the ZIP signature, stages it with restrictive permissions, and creates a `MOD_UPLOAD_PENDING` job for the player’s configured server.
- The player’s verified in-game name and player record ID are stored as the recommendation attribution. The user cannot type or override this attribution.
- Eligibility is enforced by `requirePlayer`: the session must be a Steam identity previously observed on that server or a name account bound to an exact known in-game profile.
- The Go agent safely extracts redundant wrapper/`Mods` folders, requires `ModInfo.xml`, normalizes permissions, and stores recommendation metadata in the pending area.
- Staff see pending requests in Dashboard → Mods, including the recommender and description, and can approve into active Mods or reject/delete the pending request.
- The player portal proxy keeps the player session cookie and multipart upload away from public control-plane credentials.

## Current architecture and boundaries

- NestJS control plane: authentication, eligibility, job creation, attribution, and staff authorization.
- Next.js web app: player upload UI, authenticated proxy route, and staff pending-mod review.
- Go host agent: archive normalization, pending storage, approval/rejection, and game-host filesystem operations.
- The game service is not restarted by this feature. Mods apply only after staff approval and a normal managed restart.
- Dashboard identities and game-player identities remain separate records; only a verified player session can submit a request.
- ZIP uploads are limited to `.zip`, validated by magic bytes, staged with mode `0600`, and removed after the agent reports completion.

## Validation performed

- Control-plane Docker production build passed on the deployment host.
- Web Docker production build passed on the deployment host.
- Host-agent Go package compilation passed with pending-mod support.
- Host-agent service restarted successfully; `7dtd.service` remained running and was not restarted.
- `POST /api/player-auth/mod-request` returns `401 Player sign-in required` without a player session.
- Production `/api/health` returns `status: ok`.

## Release checklist

1. Review the staged diff for secrets, deployment-only files, and unrelated dirty-worktree changes.
2. Run `git diff --check` and focused Go/TypeScript builds.
3. Confirm package versions and README/CHANGELOG references are `0.0.13`.
4. Tag `v0.0.13` and push the release branch and tag.
5. Verify `/player`, Steam/name eligibility, upload validation, pending staff review, approve/reject, and post-approval restart behavior.

## Security notes

- Never commit player JWT secrets, dashboard JWT secrets, Steam/OpenID credentials, API tokens, webhook secrets, telnet passwords, WireGuard keys, SSH keys, or production `.env` files.
- Do not broaden player access to dashboard jobs, telnet, raw logs, claims, or private map layers.
- Keep pending archives outside the active `Mods` directory until an administrator explicitly approves them.
