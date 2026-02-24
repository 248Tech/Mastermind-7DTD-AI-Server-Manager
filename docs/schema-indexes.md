# Index recommendations (MVP)

All indexes below support multi-tenant (org-scoped) queries and common access patterns. Add with migrations after table creation.

## Tenant isolation (every org-scoped table)

| Table | Index | Purpose |
|-------|--------|--------|
| user_orgs | `(org_id)` | List users in org |
| hosts | `(org_id)` | List hosts by org |
| server_instances | `(org_id)` | List servers by org |
| jobs | `(org_id)` | List jobs by org |
| job_runs | via job_id → job.org_id | Use job_id + optional (job_id, created_at) |
| events | `(org_id, created_at DESC)` | Recent events per org |
| alert_rules | `(org_id)` | List rules by org |
| ban_entries | `(org_id)` | List bans by org |
| audit_logs | `(org_id, created_at DESC)` | Audit trail per org, time-bound |
| mod_artifacts | `(org_id)`, `(game_type_id)` | List mods by org or game |

## Lookups & joins

| Table | Index | Purpose |
|-------|--------|--------|
| server_instances | `(host_id)` | Servers on a host (heartbeat → host → instances) |
| jobs | `(server_instance_id)`, `(org_id, created_at DESC)` | Jobs for a server; recent jobs in org |
| job_runs | `(job_id)`, `(job_id, created_at DESC)` | Runs for a job; order runs |
| job_runs | `(host_id)` | Runs executed on a host |
| user_server_roles | `(server_instance_id)` | Who has access to a server |
| ban_entries | `(server_instance_id)`, `(org_id, identifier_type, identifier_value)` | Bans per server; lookup by identifier |

## Uniques (already in schema)

- orgs.slug
- users.email
- roles.name
- game_types.slug
- user_orgs (user_id, org_id)
- user_server_roles (user_id, server_instance_id)

## Optional (add when needed)

- **Partitioning:** `audit_logs`, `events` by `created_at` (monthly) when volume grows.
- **Partial:** `job_runs (job_id) WHERE status = 'running'` for active-run lookup.
- **GIN:** `events.payload`, `alert_rules.condition` for JSONB queries if you filter by payload/condition.
