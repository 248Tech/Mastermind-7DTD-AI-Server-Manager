# Minecraft adapter — required server config

The Minecraft game adapter (agent-side) uses **RCON** for commands and **process control** for start/stop. Mod management is not supported in MVP.

## Capability registration (control plane)

The **minecraft** game type must have these capabilities so the UI shows the right actions:

- `start`, `stop`, `restart`, `status`, `send_command`, `kick_player`, `ban_player`, `get_log_path`

Seeded by migration `20250223000009_seed_minecraft_capabilities` (or run the SQL from design-game-adapter-capabilities.md with the list above).

## Required server instance fields

Stored on **server_instances** (and passed in job payload to the agent). For Minecraft, **telnet_*** fields are used as **RCON** (host, port, password).

| Field | Required | Description |
|-------|----------|-------------|
| **install_path** | Yes | Server root directory (contains `server.jar` and `logs/`). |
| **start_command** | Recommended | Command to start the server (e.g. `java -Xmx2G -jar server.jar`). If omitted, adapter runs `java -jar server.jar` from `install_path`. |
| **telnet_host** | Yes (for RCON) | RCON host (e.g. `127.0.0.1`). |
| **telnet_port** | Yes (for RCON) | RCON port; enable in `server.properties`: `enable-rcon=true`, `rcon.port=25575`. Default adapter port if unset: `25575`. |
| **telnet_password** | Yes (for RCON) | RCON password; set `rcon.password=...` in `server.properties`. |
| **stop_command** | No | If set, used to stop the server (e.g. a script). If omitted, adapter sends RCON `stop` for graceful shutdown. |

## server.properties (Minecraft server)

Enable RCON on the Minecraft server:

```properties
enable-rcon=true
rcon.port=25575
rcon.password=your-secure-password
```

## Job types (agent)

- `SERVER_START`, `SERVER_STOP`, `SERVER_RESTART` — process control.
- `STATUS` — RCON `list`; if it succeeds, status is `running`, else `stopped`.
- `RCON`, `SEND_COMMAND` — payload `command`: raw command string; response in `output`.
- `LIST_PLAYERS` — runs `list` and returns result in `result.players`.
- Kick: `SendCommand` / job with `command: "kick <player>"`.
- Ban: `SendCommand` / job with `command: "ban <player> [reason]"`.

## Player list

Use RCON command `list` (e.g. via `SEND_COMMAND` job or adapter `SendCommand(ctx, cfg, "list")`). Output format is server-dependent (e.g. "There are 2/20 players online: Alice, Bob").
