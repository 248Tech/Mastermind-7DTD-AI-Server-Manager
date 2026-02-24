# Security: Agent Pairing

## Flow summary

1. **Admin** generates a pairing token in the UI (org-scoped, expiry, single-use).
2. **Agent** sends token + host metadata to `POST /api/agent/pair` (no auth).
3. **Control plane** validates token, creates host, issues signed agent key (JWT), marks token used, writes audit log.
4. **Agent** stores key locally; all future requests use `Authorization: Bearer <agentKey>`.
5. **Rotation**: Admin can rotate key per host; old key is invalidated via `agentKeyVersion` check.

## Requirements addressed

| Requirement | Implementation |
|------------|----------------|
| Token expiry | `PairingToken.expiresAt`; validated on pair. Default 15 min; configurable 60s–24h. |
| Single-use | `PairingToken.usedAt` set on first successful pair; reject if already used. |
| Agent key rotation | `Host.agentKeyVersion`; JWT includes `keyVersion`; guard verifies against current version. Rotate endpoint issues new JWT and increments version. |
| Audit log | `AuditLog` entry on pair: `action: agent_pair`, `resourceType: host`, `resourceId: host.id`, `details: { pairingTokenId, hostName, clientIp }`. |
| Org isolation | Tokens belong to `orgId`; host created in same org. Agent JWT contains `orgId`; all agent APIs must scope by `orgId` + `hostId`. |

## Security considerations

### Token handling

- **Never store plaintext** pairing token. Store only `tokenHash` (SHA-256). Plaintext is returned once in the create-token response.
- **HTTPS only** for `/api/agent/pair` and all agent endpoints in production.
- **Rate limiting**: Apply rate limit by IP on `POST /api/agent/pair` to prevent brute-force (e.g. 10 req/min per IP). Token space is 32 bytes base64url; still limit attempts.
- **Short expiry**: Prefer 10–15 minute token lifetime so leaked tokens are useless quickly.

### Agent key (JWT)

- **Separate secret**: Use `JWT_AGENT_SECRET` (or similar) for signing agent JWTs, distinct from user JWT secret. Rotating user auth does not invalidate agents.
- **Claims**: `sub` = hostId, `orgId`, `keyVersion`, `type: 'agent'`. Validate `type` and `keyVersion` in guard.
- **Expiry**: Long-lived (e.g. 365d) is acceptable because rotation invalidates by version; optionally use shorter exp and agent refreshes key via authenticated endpoint.

### Guard (agent-authenticated routes)

- Verify JWT signature and exp.
- Load host by `sub`; ensure host exists and `host.agentKeyVersion === payload.keyVersion`.
- Attach `orgId` and `hostId` to request for downstream use; reject if host not in DB or org mismatch.

### Admin endpoints

- `POST /api/orgs/:orgId/pairing-tokens`: Require JWT + user in org with role admin (or operator). Validate `orgId` param matches user’s org membership.
- `POST /api/orgs/:orgId/hosts/:hostId/rotate-key`: Same; ensure host belongs to org.

### Audit

- Log pairing with `clientIp` (from `X-Forwarded-For` when behind proxy). Do not log the plaintext token or the issued agent key.

### Cleanup

- Periodically delete expired unused tokens (`expiresAt < now() AND usedAt IS NULL`) to limit table growth and reduce value of old token hashes.
