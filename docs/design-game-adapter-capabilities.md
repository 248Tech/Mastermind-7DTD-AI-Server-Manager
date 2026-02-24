# Game Adapter Interface & Capability Registry

Agent-side game adapters with a control-plane capability registry so the UI renders only supported actions.

---

## 1. Interface (Go — agent)

Defined in `agent/internal/agent/gameadapter.go`.

### Capabilities (constants)

| Constant         | Description                    |
|------------------|--------------------------------|
| `start`          | Start the game server          |
| `stop`           | Stop the game server           |
| `restart`        | Restart (stop then start)      |
| `status`         | Return running/stopped/unknown |
| `send_command`   | Send raw command (e.g. RCON)   |
| `stream_chat`    | Stream chat/log to writer      |
| `kick_player`    | Kick player by ID/name         |
| `ban_player`     | Ban player with optional reason |
| `install_mod`    | **(Optional)** Install/update mod |
| `get_log_path`   | Path to main log file          |

### GameAdapter interface

- **JobExecutor** (Execute(ctx, job) → JobResult)
- **Name()** string — game type slug (e.g. `"7dtd"`, `"minecraft"`)
- **Capabilities()** []string — list of supported capability slugs
- **Start**, **Stop**, **Restart** (ctx, cfg)
- **Status** (ctx, cfg) → (string, error)
- **SendCommand** (ctx, cfg, command) → (string, error)
- **StreamChat** (ctx, cfg, w io.Writer) error
- **KickPlayer**, **BanPlayer** (ctx, cfg, playerID [, reason])
- **InstallMod** (ctx, cfg, modID, opts) — may return **ErrUnsupported**
- **GetLogPath** (cfg) → (string, error)

**InstanceConfig** (per server instance): `ServerInstanceID`, `InstallPath`, `StartCommand`, `StopCommand`, `TelnetHost`, `TelnetPort`, `TelnetPassword`, `Extra`.

---

## 2. Capability registry (control plane)

- **Schema:** `game_types.capabilities` (JSONB array of strings). Example: `["start","stop","restart","status","send_command","stream_chat","kick_player","ban_player","install_mod","get_log_path"]`.
- **API:** **GET /api/game-types** — returns all game types with `id`, `slug`, `name`, `capabilities[]`. No auth required (public registry).
- **Server instance response:** When listing or fetching a server instance, include **capabilities** from its `gameType` so the UI can show only supported actions for that server.

**UI:** Fetch game types once (or per server from instance payload). For each action (e.g. “Restart”, “Send command”), only render if the server’s game type has the matching capability (e.g. `restart`, `send_command`).

---

## 3. Agent registration

Register adapters in **games.Registry** by game type slug:

```go
registry := games.NewRegistry()
registry.Register(sevendtd.NewAdapter())
registry.Register(minecraft.NewAdapter())
// When executing a job: adapter := registry.GetOrNoop(serverGameType)
```

Use **GetOrNoop(gameType)** so unknown game types get a no-op adapter (all capability methods return **ErrUnsupported** or safe defaults).

---

## 4. Example adapters

- **7DTD** (`agent/internal/games/7dtd`): Implements all capabilities; Start/Stop/Restart via scripts or commands; Status/SendCommand/Kick/Ban via telnet; GetLogPath from install path; InstallMod returns ErrUnsupported.
- **Minecraft** (`agent/internal/games/minecraft`): MVP with RCON: **start**, **stop**, **restart**, **status**, **send_command**, **kick_player**, **ban_player**, **get_log_path**; player list via `list` command. StreamChat and InstallMod return ErrUnsupported. See `docs/minecraft-adapter-config.md` for required server config (install_path, start_command, RCON host/port/password).

---

## 5. Seed data (game_types)

After migrations, seed or update game types with capabilities:

**7dtd:**

```sql
UPDATE game_types SET capabilities = '["start","stop","restart","status","send_command","stream_chat","kick_player","ban_player","install_mod","get_log_path"]'::jsonb WHERE slug = '7dtd';
```

**minecraft** (MVP: RCON + start/stop, kick/ban, player list). Seeded by migration `20250223000009_seed_minecraft_capabilities`:

```sql
INSERT INTO game_types (id, slug, name, capabilities, created_at)
VALUES (gen_random_uuid()::text, 'minecraft', 'Minecraft', '["start","stop","restart","status","send_command","kick_player","ban_player","get_log_path"]'::jsonb, now())
ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, capabilities = EXCLUDED.capabilities;
```
