# Mastermind security audit — 2026-08-14

Scope: dashboard/control-plane authentication, authorization, account lifecycle,
public endpoints, secret handling, containers, and the DigitalOcean production
deployment. This is an application review, not a formal penetration test.

## Implemented in this pass

- Public registration no longer accepts an organization ID or grants elevated
  access. New users join the default organization as pending viewers.
- Email confirmation and administrator approval are separate gates. Confirming
  an email does not create a dashboard session.
- The Accounts page lets administrators approve or suspend lower-tier users.
  Approval requires a confirmed email and an enabled password.
- `frosty@mg7d.com` is the explicit production bootstrap administrator. The old
  `admin@mastermind.local` bootstrap login is disabled during migration.
- Mastermind no longer ships or displays a default dashboard password.
- Passwords use salted scrypt. Unknown-user logins perform the same expensive
  verification operation to reduce email-enumeration timing differences.
- Persistent brute-force controls use HMAC-hashed IP/account buckets; raw IPs
  and emails are not stored in the limiter table. Current limits are five
  failures per IP/account pair, ten per account, or twenty per IP in 15 minutes,
  with 15–30 minute blocks. Registration and verification resend are limited to
  five requests per IP per hour.
- User JWT lifetime is reduced from seven days to twelve hours. Tokens contain
  an account authorization version and are checked against the database on
  every guarded request. Password changes/resets, suspension, and approval
  changes immediately revoke previous dashboard tokens.
- Organization membership is no longer sufficient for sensitive mutations.
  Job creation and mod upload, schedules, alert endpoints, organization
  settings/integrations, account management, and connection tests now require
  administrator or operator roles as appropriate.
- Stored integration credentials are no longer returned in normal organization
  responses. Administrators receive configuration state; the Discord webhook
  value remains admin-only where editing it requires the current value.
- Production startup fails closed for missing/default JWT, agent JWT, email,
  and integration-encryption secrets, or a non-HTTPS public URL.
- API CORS is restricted to the configured public web origin. API and web
  security headers now cover HSTS, CSP, framing, MIME sniffing, referrer, and
  browser permission policies.
- Docker-published services bind to loopback by default. A direct LAN bind must
  be explicitly selected with `BIND_ADDRESS`.
- The control plane no longer silently selects another port when its configured
  port is occupied.
- Production dependency lockfiles are now committed for deterministic builds.
  Nest was upgraded to 11.2, Next.js to the patched 15.5 line, React/React DOM
  to 19.2, React Leaflet to 5, and patched Multer, `qs`, PostCSS, and Sharp
  versions are enforced. Final production-dependency audits reported no known
  vulnerabilities for either control-plane or web.

## Production controls verified

- The public web entry point is Cloudflare Tunnel over HTTPS.
- PostgreSQL, Redis, control-plane, and web published ports bind to
  `127.0.0.1` on the Droplet.
- DigitalOcean network firewall exposure is limited to the management/tunnel
  paths already required by the deployment; database and application ports are
  not directly Internet-facing.
- Database backup is required immediately before applying the additive account
  approval schema and account migration.

## Remaining findings and recommendations

### Medium: browser token storage

The dashboard currently keeps its bearer token in `localStorage`. A successful
same-origin script injection could read it. The new CSP and twelve-hour expiry
reduce exposure, and server-side authorization-version checks allow immediate
revocation, but the preferred long-term change is an HttpOnly, Secure,
SameSite cookie with CSRF protection or a same-origin backend-for-frontend.

### Medium: multi-factor authentication

Administrators do not yet have MFA. Add passkeys/WebAuthn or TOTP, require it
for administrators, and issue recovery codes. Do not use email alone as the
second factor.

### Medium: edge rate limiting

The database-backed limiter protects application login and registration even
across restarts. Add Cloudflare rules as an independent outer layer for
`/api/auth/*`, `/api/player-auth/*`, and unusually high request rates. Edge
limits must complement, not replace, the application controls.

### Medium: public Steam verification — addressed 2026-08-17

Steam verification remains public and still makes an outbound Steam request.
It now has a persistent hashed-IP limit (20 / 15 minutes), a decorated DTO,
a 32-key OpenID cap, and the global 256 KiB JSON body limit. Cloudflare edge
limits are still recommended as an outer layer.

### Low: Frigate webhook — addressed 2026-08-17

The route is retained. Webhooks now require a configured organization secret,
compare it in constant time, validate a DTO, and apply a persistent IP limit
(60 / minute). Organizations without a secret receive HTTP 403.

### Medium: pairing brute-force / DoS — addressed 2026-08-17

`POST /api/agent/pair` now uses the same persistent limiter (10 / minute / IP)
and prefers `CF-Connecting-IP` over a spoofable first `X-Forwarded-For` hop.

### Low/medium: legacy DTO coverage

Several older controllers use undecorated TypeScript request shapes. Decorated
DTOs now enforce strict size/format constraints for new authentication,
account, pairing, Steam verify, and Frigate routes, but global unknown-field
rejection cannot be enabled without breaking remaining legacy bodies. Migrate
each remaining mutation DTO to `class-validator`, then enable global whitelist
and unknown-field rejection.

### Operational follow-up

- Rotate all integration/API tokens after any suspected disclosure; stored
  credentials are encrypted but a running administrator session can use them.
- Preserve `OPENAI_KEY_ENCRYPTION_SECRET`; changing it makes existing stored
  integration credentials unreadable.
- Review audit logs for repeated login failures, account approval/revocation,
  password resets, integration changes, pairing, and destructive server jobs.
- Add dependency scanning, secret scanning, container image scanning, and SAST
  to CI. Re-run this review before exposing new deployment automation.

## Validation checklist

- Build control-plane and web production images.
- Back up PostgreSQL, apply the additive schema, approve/promote the bootstrap
  administrator, preserve approval for pre-existing legitimate users, and
  disable the legacy bootstrap account.
- Confirm a new public registration is an unapproved viewer and login is denied.
- Confirm an administrator can approve it and suspension revokes its JWT.
- Confirm the sixth failed login for one IP/account pair is HTTP 429.
- Confirm disallowed origins receive no CORS permission and security headers are
  present on both API and web responses.
- Confirm agent heartbeat/jobs, player portal, health checks, and 7DTD service
  remain healthy after rollout.

The production checklist above passed on 2026-08-14. The synthetic registration
account used for validation was removed immediately after testing.

Guidance used: OWASP Authentication, Session Management, HTTP Headers, Content
Security Policy, and Bot Management/Anti-Automation cheat sheets.
