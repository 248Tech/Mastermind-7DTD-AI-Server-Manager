# Server instances (7DTD) API — MVP

## Prerequisites

- **Game type:** Seed `game_types` with a row where `slug = '7dtd'` (e.g. name "7 Days to Die"). Create and list endpoints will fail until this exists.
- **Auth:** All endpoints require `Authorization: Bearer <user-jwt>`. User must be a member of the org (see roles below).

## Endpoints

| Method | Path | Permission | Description |
|--------|------|------------|-------------|
| GET | `/api/orgs/:orgId/server-instances` | Org member (viewer ok) | List instances |
| GET | `/api/orgs/:orgId/server-instances/:id` | Org member | Get one (includes `telnetPassword` for editing) |
| POST | `/api/orgs/:orgId/server-instances` | Admin or Operator | Create |
| PATCH | `/api/orgs/:orgId/server-instances/:id` | Admin or Operator | Update (partial) |
| DELETE | `/api/orgs/:orgId/server-instances/:id` | Admin or Operator | Delete |

## Permissions

- **Viewer:** Can only list and get one. Create/update/delete return 403.
- **Admin / Operator:** Full CRUD.

Org membership and role are resolved from `UserOrg` + `Role` by org id (from URL) and user id (from JWT).

## Request/response

- **Create body:** `CreateServerInstanceDto` — `name`, `hostId`, `gameType` (must be `"7dtd"`), optional `installPath`, `startCommand`, `telnetHost`, `telnetPort`, `telnetPassword`.
- **Update body:** `UpdateServerInstanceDto` — same fields, all optional (partial).
- **List response:** Array of instances; `telnetPassword` is omitted.
- **Get-one response:** Single instance; `telnetPassword` included for admin editing.

## Validation

- `name`: 1–128 chars.
- `hostId`: Required; must be a host that belongs to the same org.
- `gameType`: Must be `"7dtd"` in MVP.
- `installPath`, `startCommand`: max 2048 chars.
- `telnetHost`: hostname or IP, max 255 chars.
- `telnetPort`: 1–65535 if present.
- `telnetPassword`: max 256 chars; never logged in audit.

## Audit

- Every create/update/delete writes to `audit_log`: `action` (create | update | delete), `resourceType: 'server_instance'`, `resourceId`, `actorId`, `ip`. Details object excludes `telnetPassword`.
