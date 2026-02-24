# Global Command Palette (⌘K) — Design

Keyboard-first command palette: server search, macro execution, job triggering, quick restart. Filtered by permissions; fast query; cached index; extensible.

---

## 1. Features (MVP)

| Feature | Description | Permission |
|--------|-------------|------------|
| **Server search** | Type to find servers by name; select to navigate to server detail (or show server context). | Org member (viewer+). |
| **Macro execution** | List and search saved command macros; select → (params form if needed) → execute. | Macro’s `allowed_role_names` (org or server role). |
| **Job triggering** | Built-in “Restart server” (and future: Start, Stop, RCON) for a server. | Admin/operator (or server role if enforced); server must have capability. |
| **Quick restart** | One-step “Restart &lt;server name&gt;” without opening server page. | Same as job triggering. |
| **Filtered by permissions** | Backend returns only items the user may see/execute; UI disables or hides actions user cannot run. | Enforced per item. |

---

## 2. Backend search API

### 2.1 Index endpoint (cached by client)

**GET** `/api/orgs/:orgId/command-palette/index`

**Auth:** JWT + OrgMemberGuard (any org member).

**Purpose:** Return a full, permission-filtered snapshot for the command palette. Client caches this (e.g. in memory or short-lived storage) so opening ⌘K is instant and filtering is local.

**Response:**

```ts
interface CommandPaletteIndex {
  servers: PaletteServerItem[];
  macros: PaletteMacroItem[];
  quickActions: PaletteQuickActionItem[];
  meta: { at: string }; // ISO timestamp for cache invalidation
}

interface PaletteServerItem {
  type: 'server';
  id: string;
  label: string;           // server name
  subtitle?: string;       // host name, game type, or status
  capabilities?: string[]; // from game type (restart, etc.)
  canNavigate: boolean;    // true for any org member
  canTriggerJob: boolean;  // true if user may create jobs for this server (admin/operator or server role)
}

interface PaletteMacroItem {
  type: 'macro';
  id: string;
  label: string;           // macro name
  subtitle?: string;       // description or server name if fixed
  serverInstanceId?: string;
  serverInstanceName?: string;
  paramDefinitions?: { name: string; label?: string; required?: boolean }[];
  canExecute: boolean;     // user's role in allowed_role_names
}

interface PaletteQuickActionItem {
  type: 'quick_action';
  id: string;              // e.g. 'restart'
  label: string;           // e.g. "Restart server"
  jobType: string;         // e.g. SERVER_RESTART
  requiresServer: true;    // user must pick a server (from list)
  capability: string;     // e.g. 'restart' — only show for servers with this capability
}
```

**Behavior:**

- **Servers:** Load all server instances in org; for each, set `canNavigate = true` for all org members; set `canTriggerJob` if user’s org role is admin/operator (or, if using server-level roles, user has a role on that server that is in a set that may run jobs). Attach `capabilities` from server’s game type.
- **Macros:** Load all command macros in org; for each, resolve user’s effective role (org role or server role when macro is server-scoped); set `canExecute = allowed_role_names` includes that role. Include `paramDefinitions` so the client can show a param form.
- **Quick actions:** Static list for MVP: `{ id: 'restart', label: 'Restart server', jobType: 'SERVER_RESTART', requiresServer: true, capability: 'restart' }`. Later: start, stop, RCON. No per-user filtering at index level; “can run” is determined when user picks a server (server has capability + user has permission for that server).

**Index size:** One response per org; keep payload small (ids, labels, subtitles, flags). No secrets (no telnet passwords). Client cache TTL e.g. 60–120 seconds; invalidate on focus or explicit refresh.

### 2.2 Search endpoint (optional, for large orgs)

**GET** `/api/orgs/:orgId/command-palette/search?q=...&limit=20`

**Auth:** JWT + OrgMemberGuard.

**Purpose:** Server-side search when the client does not want to hold the full index (e.g. 100+ servers, 50+ macros). Same permission rules as index; filter by query string.

**Query params:**

| Param | Type | Description |
|-------|------|-------------|
| q | string | Search string; min 1 char. |
| limit | number | Max items per section (default 10, max 30). |
| types | string | Optional comma list: `servers,macros,quick_actions`. Omit = all. |

**Response:** Same shape as index but with only matching items; `servers`, `macros`, `quickActions` each truncated to `limit`. Matching rules:

- **Servers:** `name` ILIKE `%q%` (or split q into tokens and match all). Order by name.
- **Macros:** `name` (and optionally `description`) ILIKE `%q%`. Order by name.
- **Quick actions:** Label match; typically return full static list if q is short or empty.

**When to use:** Prefer **index + client-side filter** for MVP (simplest, instant). Add **search** when orgs have many servers/macros and the index response or client-side filtering becomes too large.

### 2.3 Execute actions (existing + one addition)

- **Macro:** **POST** `/api/orgs/:orgId/command-macros/:id/execute` (existing). Body: `{ params?: Record<string, string>, serverInstanceId?: string }`.
- **Quick restart (and future job triggers):** Either:
  - **Option A:** **POST** `/api/orgs/:orgId/command-palette/trigger-job` with body `{ jobType: 'SERVER_RESTART', serverInstanceId: string }`. Backend creates Job (same as macro execution path), returns `{ jobId }`. Permission: user must be admin/operator or have server role; server must have `restart` capability.
  - **Option B:** Reuse a generic “run macro” style: have a system macro or a dedicated **POST** `/api/orgs/:orgId/servers/:serverInstanceId/jobs` with body `{ type: 'SERVER_RESTART' }`. Backend creates job, enqueues, returns job id.

Recommendation: **Option A** — single trigger endpoint for built-in job types; keeps command palette and “quick actions” consistent.

---

## 3. Cached server index (implementation)

### 3.1 Backend

- **No server-side cache required for MVP:** Index endpoint runs a single Prisma query (servers + macros in parallel), applies permission logic in code, returns JSON. For small/medium orgs this is fast enough (< 100–200 ms).
- **Optional later:** In-memory cache per org (e.g. TTL 60 s) keyed by `orgId` and optionally `userId` (if permissions differ per user). Invalidate on server/macro create/update/delete (or rely on TTL). Use when response time or DB load matters.

### 3.2 Client (UI)

- On app load or org switch: call `GET .../command-palette/index`, store in React state or context (e.g. `CommandPaletteProvider`).
- Optional: persist to `sessionStorage` with timestamp; reuse if age < 60 s on next open.
- On ⌘K open: filter cached index by current query string (client-side). No network call if cache is fresh; optional “Refresh” in palette to refetch index.
- If you add search endpoint: for large orgs, call search when `q.length >= 2` and debounce (e.g. 150 ms), then merge or replace cached sections with search result.

---

## 4. UI architecture

### 4.1 Keyboard-first UX

| Key | Action |
|-----|--------|
| **⌘K** / **Ctrl+K** | Open command palette (global). |
| **Escape** | Close palette. |
| **↑ / ↓** | Move selection. |
| **Enter** | Execute selected item (or open param form for macros with params). |
| **Tab** | Optional: cycle sections (Servers → Macros → Quick actions). |
| **Type** | Filter list by label (and optionally subtitle); fuzzy or substring. |

- Focus trap inside the modal; restore focus to previous element on close.
- Announce section and selection to screen readers (e.g. “Servers, 3 of 12”, “Restart server – Quick action”).

### 4.2 Layout and sections

- **Single list with section headers** (recommended): “Servers”, “Macros”, “Quick actions”. One contiguous list; headers are not selectable; arrow keys skip headers.
- **Grouped results:** Under each header, show only items matching the query. Empty sections are hidden.
- **Selection:** One highlighted item; Enter runs it. For “Quick restart”, selection might be two-step: first select “Restart server”, then show a second list “Choose server” (filtered by name and by `canTriggerJob` + capability).

### 4.3 Flow per item type

1. **Server**
   - **Enter:** Navigate to `/orgs/:orgId/servers/:id` (or emit event for router). No params.
   - If `canTriggerJob` is false, still allow navigate (viewer can open server detail).

2. **Macro**
   - **Enter:** If `paramDefinitions.length === 0`, call execute immediately with `{}`. If macro is org-wide, no `serverInstanceId` in body (or require user to pick server in a follow-up step). If macro has params, open inline form in palette (or small modal); on submit call execute with `params` and optional `serverInstanceId`.
   - If `canExecute` is false, show item but disabled (or hide entirely; recommend disabled so user sees it exists).

3. **Quick restart**
   - **Enter:** Show “Choose server” sublist (servers with `restart` capability and `canTriggerJob`), filtered by current query if applicable. User picks server → **POST** trigger-job with `serverInstanceId` → show “Job queued” toast and close palette (or navigate to job).

### 4.4 Extensibility

- **Provider pattern:** Define a `CommandPaletteSource` interface that returns sections and items. Built-in providers: Servers, Macros, Quick actions. Register in a palette context or config.
- **New section:** Add a provider that returns e.g. “Recent batches” or “Go to schedule” with type `navigate` and a route. Index or search API can be extended with a `navigations` or `custom` section.
- **New quick actions:** Add entries to the static `quickActions` list (e.g. “Start server”, “Stop server”) and enforce capability + permission in trigger-job.
- **Client:** Keep list rendering generic (icon + label + subtitle + optional meta); each item has `type`, `id`, and an `onSelect()` that the provider supplies.

---

## 5. Security considerations

### 5.1 Org isolation

- All endpoints are under `/api/orgs/:orgId/...`. Enforce **OrgMemberGuard** so only members of that org can call index/search/trigger.
- Index and search: load only servers and macros where `orgId === req.params.orgId`. No cross-org data.

### 5.2 Permission filtering

- **Servers:** Return all org servers for “navigate”. Set `canTriggerJob` only if the user is allowed to create jobs for that server (org role admin/operator, or server-level role that is allowed to run jobs). If you do not yet enforce server-level roles, treat “can create job” as org role in [admin, operator].
- **Macros:** Return all org macros so the palette can show them. Set `canExecute` only if the user’s effective role (org role or server role for macro’s server) is in `macro.allowed_role_names`. Backend execute endpoint already enforces this; index only drives UI state (disabled vs runnable).
- **Quick actions:** Trigger-job endpoint must verify: (1) user is org member with admin/operator (or server role that may run jobs), (2) server belongs to org, (3) server’s game type has the required capability (e.g. `restart` for SERVER_RESTART). Return 403 if any check fails.

### 5.3 No secrets in index/search

- Index and search responses must not include `telnetPassword`, agent keys, or webhook URLs. Use the same DTOs as server list (e.g. no password in server item); macros have no secrets in payload template in response (or only non-secret keys).

### 5.4 Rate limiting (optional)

- Index and search are read-only but can be called often (e.g. every palette open). Optionally rate limit per user (e.g. 60/min for index, 30/min for search) to avoid abuse. Trigger-job and macro execute are already write operations; apply existing or new rate limits if needed.

### 5.5 Audit

- Macro execute already creates an audit log. Trigger-job (quick restart) should create an audit entry: e.g. `action: job_triggered`, `resourceType: server_instance`, `resourceId: serverInstanceId`, `details: { jobType, jobId }`, `actorId`, `ip`.

---

## 6. API summary

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/orgs/:orgId/command-palette/index` | Full permission-filtered index for client cache. |
| GET | `/api/orgs/:orgId/command-palette/search?q=&limit=` | Optional server-side search. |
| POST | `/api/orgs/:orgId/command-palette/trigger-job` | Create job for built-in type (e.g. SERVER_RESTART). Body: `{ jobType, serverInstanceId }`. |
| POST | `/api/orgs/:orgId/command-macros/:id/execute` | Existing; used for macro execution from palette. |

---

## 7. Implementation checklist (MVP)

**Backend**

- [ ] Add `CommandPaletteController` under `api/orgs/:orgId/command-palette`.
- [ ] Implement `GET index`: load servers (with capabilities) + macros; compute `canTriggerJob` and `canExecute` per user; return static quick actions.
- [ ] Implement `POST trigger-job`: validate org, server, permission, capability; create Job + JobRun, enqueue, audit, return jobId.
- [ ] (Optional) Implement `GET search` with `q` and `limit`.

**Frontend**

- [ ] Global shortcut ⌘K / Ctrl+K to open palette.
- [ ] Fetch and cache index on org load or first palette open.
- [ ] Single list with sections (Servers, Macros, Quick actions); filter by query (client-side).
- [ ] Keyboard nav (arrows, Enter, Escape); focus trap.
- [ ] Handlers: server → navigate; macro → execute or param form; quick restart → server picker → trigger-job.
- [ ] Disable or visually distinguish items with `canExecute === false` / `canTriggerJob === false`.

**Security**

- [ ] OrgMemberGuard on all palette endpoints; trigger-job checks role + capability; no secrets in index/search; audit for trigger-job.
