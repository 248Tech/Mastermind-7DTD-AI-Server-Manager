# Mastermind Host Agent

Go agent for the control plane. Single static binary, systemd-deployable.

## Folder structure

```
agent/
├── main.go                 # Entry: config, pairing, heartbeat, job loop
├── go.mod
├── config.yaml.example
├── README.md
└── internal/
    ├── agent/
    │   └── interfaces.go   # JobExecutor, GameAdapter, LogStreamer
    ├── config/
    │   └── config.go       # YAML/JSON config load + defaults
    ├── client/
    │   ├── client.go       # Client interface (CP API)
    │   └── http.go         # HTTP implementation
    ├── pairing/
    │   └── pairing.go      # Pair via token; store agent key
    ├── heartbeat/
    │   └── heartbeat.go   # 5–10s heartbeat loop
    ├── hostinfo/
    │   └── hostinfo.go    # CPU, RAM, disk metadata
    ├── jobs/
    │   └── loop.go        # Job polling loop, dispatch to JobExecutor
    ├── runner/
    │   └── runner.go      # Command execution (JobExecutor impl)
    ├── stream/
    │   └── streamer.go    # Log tail streaming (LogStreamer impl)
    └── games/
        └── adapter.go    # Game adapter registry (plugin-style)
```

## Interfaces

- **JobExecutor** — `Execute(ctx, job) (JobResult, error)`. Default: `runner.Runner` (allowlist, timeout). Game adapters can implement for custom job types.
- **GameAdapter** — extends JobExecutor with `Name() string`. Register in `games.Registry` for game-specific commands (e.g. 7DTD RCON).
- **LogStreamer** — `Stream(ctx, path, w) error`, `Supports(path) bool`. Default: `stream.FileStreamer` (file tail).

## Build (static binary)

```bash
go build -o mastermind-agent -ldflags="-s -w" .
```

## Run

```bash
./mastermind-agent -config=./config.yaml -log=info
```

First run: set `pairing_token` in config; after success remove it. Key and `host_id` are stored under `agent_key_path` directory.

## Same-host 7DTD autodiscovery

If the agent runs on same Linux box as the 7DTD dedicated server, set discovery paths in `config.yaml`:

```yaml
discovery:
  enabled: true
  seven_dtd:
    enabled: true
    install_path: "/home/xxxxxxx/serverfiles"
    server_config_path: "/home/xxxxxxx/serverfiles/sdtdserver.xml"
    mods_path: "/home/xxxxxxx/serverfiles/Mods"
    saves_path: "/home/xxxxxxxx/.local/share/7DaysToDie/Saves"
    server_admin_xml_path: "/home/xxxxxxxx/.local/share/7DaysToDie/Saves/serveradmin.xml"
    start_command: "/bin/sh /home/xxxxxxx/serverfiles/startserver.sh"
```

On startup the agent will:

- pair with control plane
- read local 7DTD config/mod/admin files
- sync discovered server instance metadata to control plane
- execute jobs through registered game adapters

## systemd

See `infra/agent/systemd/mastermind-agent.service.example`.
