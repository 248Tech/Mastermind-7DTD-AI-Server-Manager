# Migration order (FK-safe)

Run migrations in this order when applying raw SQL or creating Prisma migrations:

1. **orgs**
2. **users**
3. **roles**
4. **game_types** — then run 20250223000008 (add `capabilities`), then 20250223000009 (seed minecraft)
5. **user_orgs** (depends: orgs, users, roles)
6. **hosts** (depends: orgs) — then run migration 20250223000006 to add status, last_metrics, labels for multi-host/health
7. **server_instances** (depends: orgs, hosts, game_types)
8. **user_server_roles** (depends: users, server_instances, roles)
9. **job_batches** (depends: orgs, users)
10. **jobs** (depends: orgs, server_instances, users, job_batches optional)
11. **job_runs** (depends: jobs, hosts)
12. **events** (depends: orgs)
13. **alert_rules** (depends: orgs)
14. **org_bans** (depends: orgs, users)
15. **ban_entries** (depends: orgs, server_instances, users, org_bans optional)
16. **audit_logs** (depends: orgs, users)
17. **command_macros** (depends: orgs, server_instances, users)
18. **schedules** (depends: orgs, server_instances, users)
19. **mod_artifacts** (depends: orgs, game_types)
20. **pairing_tokens** (depends: orgs, users, hosts)

**Seed after migrations:** Insert default `roles` (admin, operator, viewer) and at least one `game_type` (e.g. slug `7dtd`).
