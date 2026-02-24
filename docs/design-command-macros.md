# Saved Command Macros — Design

Stored per org, parameterized, optional server scope, scoped permissions, command-palette visible, audit on execution.

---

## 1. Schema

### 1.1 Table: `command_macros`

| Column | Type | Description |
|--------|------|-------------|
| id | cuid | PK |
| org_id | FK → orgs | Tenant |
| name | text | Display name (command palette) |
| description | text nullable | Tooltip / help |
| job_type | text | e.g. SERVER_RESTART, RCON, custom |
| payload_template | jsonb | Job payload with `{{paramName}}` placeholders in string values |
| param_definitions | jsonb | Array of `{ name, label?, default?, required? }` |
| server_instance_id | FK nullable → server_instances | If set, macro is fixed to that server; if null, org-wide (server chosen at run time) |
| allowed_role_names | jsonb | Array of role names allowed to execute, e.g. `["admin","operator"]` |
| created_by_id | FK nullable → users | Creator |
| created_at, updated_at | timestamptz | |

**Indexes:** `org_id`, `server_instance_id`.

**Example row (7DTD “Say message”):**
- name: `Say in-game message`
- description: `Send a message to all players via RCON`
- job_type: `RCON`
- payload_template: `{ "command": "say {{message}}" }`
- param_definitions: `[{ "name": "message", "label": "Message", "required": true }]`
- server_instance_id: `abc123` (or null for org-wide)
- allowed_role_names: `["admin", "operator"]`

---

## 2. API Endpoints

All under `api/orgs/:orgId/...`. Auth: JWT + org membership. List/get: any org member. Create/update/delete: admin or operator. Execute: see execution flow (role check against macro’s `allowed_role_names`).

| Method | Path | Who | Description |
|--------|------|-----|-------------|
| GET | `/api/orgs/:orgId/command-macros` | Org member | List macros (for command palette). Optional query: `?serverInstanceId=` to filter by server or org-wide. |
| GET | `/api/orgs/:orgId/command-macros/:id` | Org member | Get one (includes param definitions for form). |
| POST | `/api/orgs/:orgId/command-macros` | Admin/operator | Create macro. Body: name, description?, jobType, payloadTemplate, paramDefinitions, serverInstanceId?, allowedRoleNames. |
| PATCH | `/api/orgs/:orgId/command-macros/:id` | Admin/operator | Update macro (partial). |
| DELETE | `/api/orgs/:orgId/command-macros/:id` | Admin/operator | Delete macro. |
| POST | `/api/orgs/:orgId/command-macros/:id/execute` | See below | Execute macro with params (and optional serverInstanceId if macro is org-wide). Body: `{ params: { paramName: value }, serverInstanceId? }`. |

**List response (palette):** Include `id`, `name`, `description`, `serverInstanceId`, `paramDefinitions` (so UI can show param form). Optionally `serverInstanceName` from join.

---

## 3. Execution Flow

1. **Client:** User picks macro from command palette (or list). If macro has params, UI shows form from `paramDefinitions`; if macro is org-wide, UI may let user pick a server (or require `serverInstanceId` in execute body).
2. **Request:** `POST .../command-macros/:id/execute` with body:
   - `params`: `{ "message": "Hello" }` (keys match param definitions).
   - `serverInstanceId`: required if macro is org-wide and job type targets a server; optional and ignored if macro has fixed `server_instance_id`.
3. **Backend:**
   - Load macro by id; verify `macro.orgId === req.orgId`.
   - **Permission:** Resolve user’s role in org (and, if server-scoped or `serverInstanceId` provided, on that server). If user’s role is not in `macro.allowed_role_names`, return **403**.
   - **Server scope:** If macro has `server_instance_id`, use it. Else use body’s `server_instance_id`; if still missing and job type requires a server, return **400**.
   - **Parameter substitution:** For each key in `payload_template`, if value is string, replace `{{paramName}}` with `params[paramName]`. Validate that all required params (from `param_definitions`) are present and non-empty; reject otherwise.
   - **Job creation:** Create `Job` with `orgId`, `serverInstanceId` (resolved above), `type = macro.jobType`, `payload = resolvedPayload`, `createdById = userId`.
   - **Audit:** Write `AuditLog`: `action = macro_executed`, `resourceType = command_macro`, `resourceId = macro.id`, `details = { macroName, jobId, serverInstanceId, params (no secrets) }`, `actorId`, `ip`.
   - Return `{ jobId }` (and optionally job status URL).
4. **Downstream:** Existing job system (queue, agent, job run) handles the created job as usual.

---

## 4. Security Restrictions

| Rule | Implementation |
|------|-----------------|
| **Org isolation** | All reads/writes keyed by `orgId` from URL; macro must belong to org; execute only uses macro’s org and server instances in that org. |
| **Scoped permissions** | Only roles listed in `allowed_role_names` may execute. Compare resolved role (org-level, or server-level if applicable) against this array. |
| **Server scope** | If macro has `server_instance_id`, user must have access to that server (org membership + server role if using UserServerRole). If macro is org-wide, user must have access to the chosen `serverInstanceId` when provided. |
| **Parameter injection** | Only substitute params that appear in `param_definitions`. Keys in `params` that are not in param definitions are ignored. No arbitrary code or template engine; literal `{{name}}` replace only. Sanitize or length-cap param values if needed (e.g. max length per param). |
| **Payload template** | Store and substitute only in string values of the payload JSON. Nested objects supported; do not allow template expressions (e.g. no `{{eval}}`). |
| **Create/update/delete** | Require org role admin or operator (same as server-instance CRUD). |

---

## 5. Command Palette (UI)

- **Data:** `GET /api/orgs/:orgId/command-macros` (optionally filtered by current server or “all”).
- **Display:** Show `name` (+ optional `description`). If `paramDefinitions.length > 0`, on select open a small form; on submit call execute with collected `params` and current server (if needed).
- **Execute:** Single “Execute” or “Run” action that calls `POST .../execute` and then navigates to job detail or shows “Job queued”.

---

## 6. Migration Order

Add `command_macros` after `server_instances` and `users` (for created_by_id). In the migrations list: after audit_logs, e.g. step 15 (see schema.sql).
