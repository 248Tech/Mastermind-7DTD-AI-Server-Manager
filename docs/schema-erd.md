# PostgreSQL Schema — ERD (Text)

- **SQL:** `control-plane/prisma/schema.sql` (raw Postgres, run in order).
- **Prisma:** `control-plane/prisma/schema.prisma`.
- **Indexes:** `docs/schema-indexes.md`.
- **Migration order:** `control-plane/prisma/migrations/README-migration-order.md`.

```
┌─────────────┐       ┌─────────────┐       ┌─────────────┐
│    orgs     │       │   users     │       │    roles    │
├─────────────┤       ├─────────────┤       ├─────────────┤
│ id (PK)     │       │ id (PK)     │       │ id (PK)     │
│ name        │       │ email       │       │ name        │
│ slug (UQ)   │       │ name        │       └──────┬──────┘
└──────┬──────┘       └──────┬──────┘              │
       │                     │                     │
       │    ┌────────────────┴────────────────────┤
       │    │ user_orgs                            │
       │    │ (user_id, org_id) PK → role_id       │
       └────┼──────────────────────────────────────┘
            │
       ┌────┴──────┬──────────────┬──────────────┬──────────────┬──────────────┐
       │           │              │              │              │              │
       ▼           ▼              ▼              ▼              ▼              ▼
┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐
│   hosts     │ │ server_     │ │ game_types  │ │  events     │ │ alert_rules │ │ audit_logs  │
│             │ │ instances   │ │             │ │             │ │             │ │             │
├─────────────┤ ├─────────────┤ ├─────────────┤ ├─────────────┤ ├─────────────┤ ├─────────────┤
│ id (PK)     │ │ id (PK)     │ │ id (PK)     │ │ id (PK)     │ │ id (PK)     │ │ id (PK)     │
│ org_id (FK) │◄┤ org_id (FK) │ │ slug (UQ)   │ │ org_id (FK) │ │ org_id (FK) │ │ org_id (FK) │
│ name        │ │ host_id(FK) │ │ name        │ │ source_type │ │ name        │ │ actor_id(FK)│
│ last_       │ │ game_type_id│ │ config_     │ │ source_id   │ │ condition   │ │ action      │
│  heartbeat  │ │ name        │ │  schema     │ │ event_type  │ │ channel     │ │ resource_   │
└──────┬──────┘ │ install_path│ └──────┬──────┘ │ payload     │ │ enabled     │ │  type/id     │
       │        │ config      │        │        └─────────────┘ └─────────────┘ │ details     │
       │        └──────┬──────┘        │                                        └─────────────┘
       │               │               │
       │        ┌──────┴──────┐        │
       │        │ user_server_│        │
       │        │ roles       │        │
       │        │ (user_id,   │        │
       │        │  server_    │        │
       │        │  instance_id)       │
       │        │ → role_id   │        │
       │        └─────────────┘        │
       │               │               │
       │        ┌──────┴───────────────┴──────┐
       │        │                             │
       ▼        ▼                             ▼
┌─────────────┐ ┌─────────────┐       ┌─────────────┐
│   jobs      │ │ job_runs   │       │ mod_        │
│             │ │             │       │ artifacts   │
├─────────────┤ ├─────────────┤       ├─────────────┤
│ id (PK)     │ │ id (PK)     │       │ id (PK)     │
│ org_id (FK) │ │ job_id (FK) │       │ org_id (FK) │
│ server_     │ │ host_id(FK) │       │ game_type_id│
│  instance_id│ │ status      │       │ name        │
│ type        │ │ started_at  │       │ version     │
│ payload     │ │ finished_at │       │ file_ref    │
│ created_by  │ │ result      │       └─────────────┘
└─────────────┘ └─────────────┘

┌─────────────┐
│ ban_entries │
├─────────────┤
│ id (PK)     │
│ org_id (FK) │
│ server_     │
│  instance_id│
│ identifier_ │
│  type/value │
│ reason      │
│ banned_at   │
│ expires_at  │
│ created_by  │
└─────────────┘
```

## Relationships (summary)

| Parent       | Child            | Relationship |
|-------------|------------------|--------------|
| Org         | User (via user_orgs) | M:N, role per org |
| Org         | Host             | 1:N |
| Org         | ServerInstance   | 1:N |
| Org         | Job, Event, AlertRule, BanEntry, AuditLog, ModArtifact | 1:N |
| Host        | ServerInstance   | 1:N (MVP: 1:1 for 7DTD) |
| GameType    | ServerInstance   | N:1 |
| GameType    | ModArtifact      | N:1 (optional) |
| ServerInstance | Job (nullable) | N:1 |
| ServerInstance | JobRun (via Job→Host) | indirect |
| User        | Job (created_by) | N:1 |
| Job         | JobRun           | 1:N (retries / history) |
| Host        | JobRun           | N:1 |
| User        | ServerInstance   | M:N via user_server_roles (server-scoped role) |
| ServerInstance | BanEntry       | 1:N |
| User        | AuditLog (actor) | N:1 |
