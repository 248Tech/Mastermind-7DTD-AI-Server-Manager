# Security

## Reporting a vulnerability

Please **do not** open a public GitHub issue for security vulnerabilities.

- **Email:** Send details to your security contact (e.g. security@yourdomain.com). Include steps to reproduce, impact, and suggested fix if any.
- We will acknowledge and respond as soon as possible. We may ask for more detail.
- Do not disclose publicly until we have had a chance to address the issue.

## Threat model (summary)

- **Control Plane:** REST + WebSocket API; JWT for users, separate JWT for agents. Org-scoped data; RBAC (admin/operator/viewer). See [docs/security-review.md](docs/security-review.md) and [docs/security-agent-pairing.md](docs/security-agent-pairing.md).
- **Agent:** Runs on game host; pairs via one-time token; receives jobs and reports results. Commands are executed locally (allowlist / game adapters). No arbitrary shell by default.
- **Secrets:** Pairing tokens and agent keys are sensitive. Never log or expose them. Use HTTPS in production.

## Secure configuration

- Use strong `JWT_SECRET` and `JWT_AGENT_SECRET` in production (not defaults).
- Run Control Plane and Web over HTTPS. Restrict CORS and rate-limit public endpoints (e.g. pairing).
- Keep dependencies updated (`pnpm update`, `go get -u`); run audits (`pnpm audit`, etc.).
