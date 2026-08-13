# Mastermind 0.0.10 release context

## Release scope

Version 0.0.10 packages Codex-assisted mod editing, connection-protection tools, richer player telemetry and UX, profile-name association, exact live-map region labels, and safer organization account administration completed after 0.0.9.

## Major changes

- Added organization-scoped OpenAI integration settings. Administrators can save, test, replace, or remove an API key and choose a supported Codex model.
- API keys are encrypted with AES-256-GCM using `OPENAI_KEY_ENCRYPTION_SECRET`; plaintext is never stored or returned to the browser.
- Added Ask Codex inside supported mod config editors. Current content is treated as untrusted data, output uses a strict JSON schema, and proposals include a summary and warnings.
- Added mandatory line-level diff review. Removed lines are red, added lines green, manual edits invalidate approval, and Save remains disabled until an AI proposal is approved.
- Replaced `gpt-5-codex` with verified `gpt-5.3-codex`. The former appeared in the Models API but returned `404 Model not found` from Responses API. Connection testing now makes a real minimal Responses request.
- Added Server > Tools with high-ping kicking based on consecutive `lp` samples and country-based kick/ban policies.
- Added player IP storage/display/search plus level, zombie kills, player kills, deaths, and inventory inspection.
- Redesigned Players with status counts, filters, sorting, last-refresh feedback, better empty states, and mobile cards.
- Added Profile Editor player-name matching from `players.xml`, exact live-map region labels from real `.7rg` files, and administrator password resets for lower-tier accounts.

## Safety and operational notes

- Codex proposals never auto-save. Existing `MOD_CONFIG_WRITE` path validation, symlink protection, size limits, atomic replacement, and Jobs audit trail remain authoritative.
- Set a stable, random `OPENAI_KEY_ENCRYPTION_SECRET` before storing API keys. Losing or changing it makes existing encrypted keys unreadable; users must replace them.
- OpenAI API use is billed to the configured API account and is independent of ChatGPT subscriptions.
- Country enforcement needs a real public client IP in `lp`. This deployment's VPS MASQUERADE can make every client appear as `10.77.0.1`; private and relay-masked IPs are skipped intentionally.
- High-ping enforcement requires `lp` to include a numeric `ping=` field. It uses consecutive bad readings and a cooldown to avoid reacting to one spike.
- IP addresses are sensitive operational data. Access remains limited to authenticated organization members and should follow applicable privacy/retention rules.
- Never commit OpenAI keys, encryption secrets, deployment `.env`, JWT secrets, Discord secrets, telnet credentials, agent keys, save data, or player data.

## Schema changes

- Player combat counters and level.
- Player last-known IP address.
- Per-server connection-protection settings.
- Organization OpenAI model and encrypted API-key fields.

Migrations are included for all fields and for migration of `gpt-5-codex` settings to `gpt-5.3-codex`.

## Validation checklist

1. Run `gofmt` and `go test ./...` in `agent`.
2. Build control plane and web production images.
3. Apply schema changes and verify `/health` reports `0.0.10`.
4. Verify OpenAI key save/test/remove without exposing key in API responses or logs.
5. Generate a mod proposal, review diff, confirm Save is blocked before approval, approve, then save through the agent.
6. Verify high-ping and country policies remain disabled by default and private relay IPs are skipped.
7. Verify player IP/stat parsing, search/filter/sort, mobile cards, profile-name matching, and exact region labels.
8. Scan staged changes for credentials and private deployment data before tagging.

## Deployment notes

- Rebuild and deploy control plane and web; redeploy agent for profile-name association changes.
- Configure `OPENAI_KEY_ENCRYPTION_SECRET` before enabling Codex editing.
- No OpenAI key is bundled. Configure one in Settings after deployment.
