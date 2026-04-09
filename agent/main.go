// Mastermind Host Agent — single static binary, systemd-deployable.
// Pairing, heartbeat, job polling, command execution, log streaming.
package main

import (
	"context"
	"errors"
	"flag"
	"log/slog"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"time"

	"github.com/mastermind/agent/internal/client"
	"github.com/mastermind/agent/internal/config"
	"github.com/mastermind/agent/internal/discovery"
	"github.com/mastermind/agent/internal/execute"
	"github.com/mastermind/agent/internal/games"
	sevendtd "github.com/mastermind/agent/internal/games/7dtd"
	"github.com/mastermind/agent/internal/games/minecraft"
	"github.com/mastermind/agent/internal/heartbeat"
	"github.com/mastermind/agent/internal/jobs"
	"github.com/mastermind/agent/internal/pairing"
)

var (
	configPath = flag.String("config", "/etc/mastermind-agent/config.yaml", "Config file (YAML or JSON)")
	logLevel   = flag.String("log", "info", "Log level: debug, info, warn, error")
)

func main() {
	flag.Parse()
	setupLog(*logLevel)

	cfg, err := config.Load(*configPath)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			// No config file — rely entirely on MASTERMIND_* env vars.
			cfg = new(config.Config)
		} else {
			slog.Error("load config", "path", *configPath, "err", err)
			os.Exit(1)
		}
	}
	cfg.Defaults()
	cfg.Env() // env vars always override file values

	// Resolve agent key and host ID: if no key file yet, require pairing token and pair first
	var agentKey, hostID string
	keyPath := cfg.AgentKeyPath
	if b, err := os.ReadFile(keyPath); err == nil && len(b) > 0 {
		agentKey = strings.TrimSpace(string(b))
		hostID, err = loadHostID(keyPath)
		if err != nil {
			slog.Error("agent key present but host_id missing", "err", err)
			os.Exit(1)
		}
	} else if cfg.PairingToken != "" {
		cl := client.NewHTTPClient(cfg.ControlPlaneURL, "")
		var key string
		hostID, key, err = pairing.Do(context.Background(), cl, cfg.PairingToken, keyPath, cfg.Host.Name)
		if err != nil {
			slog.Error("pairing failed", "err", err)
			os.Exit(1)
		}
		slog.Info("paired", "host_id", hostID)
		agentKey = key
		if err := os.WriteFile(filepath.Join(filepath.Dir(keyPath), "host_id"), []byte(hostID), 0600); err != nil {
			slog.Warn("could not write host_id", "err", err)
		}
	} else {
		slog.Error("no agent key and no pairing_token; run with pairing_token in config once")
		os.Exit(1)
	}

	cl := client.NewHTTPClient(cfg.ControlPlaneURL, agentKey)

	if shouldDiscoverSevenDTD(cfg) {
		discovered, err := discovery.DiscoverSevenDTD(cfg.Discovery.SevenDTD)
		if err != nil {
			slog.Warn("7dtd discovery failed", "err", err)
		} else {
			err = cl.SyncDiscoveredServer(context.Background(), hostID, "7dtd", &client.DiscoveredServer{
				Name:           discovered.Name,
				InstallPath:    discovered.InstallPath,
				StartCommand:   discovered.StartCommand,
				TelnetHost:     discovered.TelnetHost,
				TelnetPort:     discovered.TelnetPort,
				TelnetPassword: discovered.TelnetPassword,
				Config:         discovered.Config,
			})
			if err != nil {
				slog.Warn("7dtd discovery sync failed", "err", err)
			} else {
				slog.Info("7dtd discovery synced", "install_path", discovered.InstallPath, "name", discovered.Name)
			}
		}
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()

	// Heartbeat loop
	interval := time.Duration(cfg.Heartbeat.IntervalSec) * time.Second
	go heartbeat.Run(ctx, cl, hostID, cfg.Host.Name, interval, "")

	registry := games.NewRegistry()
	registry.Register(sevendtd.NewAdapter())
	registry.Register(minecraft.NewAdapter())
	exec := &execute.RegistryExecutor{Registry: registry}

	// Job polling loop (long-poll if configured)
	go jobs.Loop(ctx, cl, hostID, cfg.Jobs.PollIntervalSec, cfg.Jobs.LongPollSec, exec)

	<-ctx.Done()
	slog.Info("shutting down")
}

func setupLog(level string) {
	var lvl slog.Level
	switch level {
	case "debug":
		lvl = slog.LevelDebug
	case "warn":
		lvl = slog.LevelWarn
	case "error":
		lvl = slog.LevelError
	default:
		lvl = slog.LevelInfo
	}
	slog.SetDefault(slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: lvl})))
}

// loadHostID reads host ID from a file next to agent key: <dir>/host_id.
func loadHostID(agentKeyPath string) (string, error) {
	p := filepath.Join(filepath.Dir(agentKeyPath), "host_id")
	b, err := os.ReadFile(p)
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(string(b)), nil
}

func shouldDiscoverSevenDTD(cfg *config.Config) bool {
	if cfg == nil {
		return false
	}
	d := cfg.Discovery.SevenDTD
	return cfg.Discovery.Enabled ||
		d.Enabled ||
		d.InstallPath != "" ||
		d.ServerConfigPath != "" ||
		d.ModsPath != "" ||
		d.SavesPath != "" ||
		d.ServerAdminXMLPath != ""
}
