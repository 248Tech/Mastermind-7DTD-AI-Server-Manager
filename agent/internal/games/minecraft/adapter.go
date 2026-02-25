package minecraft

import (
	"context"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/mastermind/agent/internal/agent"
)

const gameSlug = "minecraft"

// Adapter implements agent.GameAdapter for Minecraft (RCON + process control). Mod management not supported.
type Adapter struct {
	rconTimeout time.Duration
	stopTimeout time.Duration
}

// NewAdapter returns a Minecraft game adapter.
func NewAdapter() *Adapter {
	return &Adapter{
		rconTimeout: 15 * time.Second,
		stopTimeout: 30 * time.Second,
	}
}

func (a *Adapter) Name() string { return gameSlug }

// Capabilities returns the subset this adapter supports; control plane registry must match.
func (a *Adapter) Capabilities() []string {
	return []string{
		agent.CapStart,
		agent.CapStop,
		agent.CapRestart,
		agent.CapStatus,
		agent.CapSendCommand,
		agent.CapKickPlayer,
		agent.CapBanPlayer,
		agent.CapGetLogPath,
	}
}

// Execute dispatches job types to the appropriate capability.
func (a *Adapter) Execute(ctx context.Context, job agent.Job) (agent.JobResult, error) {
	cfg := payloadToConfig(job.Payload)
	switch job.Type {
	case "SERVER_START":
		return resultOrErr(a.Start(ctx, cfg))
	case "SERVER_STOP":
		return resultOrErr(a.Stop(ctx, cfg))
	case "SERVER_RESTART":
		return resultOrErr(a.Restart(ctx, cfg))
	case "STATUS":
		st, err := a.Status(ctx, cfg)
		if err != nil {
			return agent.JobResult{Status: "failed", Error: err.Error()}, nil
		}
		return agent.JobResult{Status: "success", Result: map[string]interface{}{"status": st}}, nil
	case "RCON", "SEND_COMMAND":
		cmd := getString(job.Payload, "command", "")
		out, err := a.SendCommand(ctx, cfg, cmd)
		if err != nil {
			return agent.JobResult{Status: "failed", Error: err.Error()}, nil
		}
		return agent.JobResult{Status: "success", Output: out}, nil
	case "LIST_PLAYERS":
		out, err := a.listPlayers(ctx, cfg)
		if err != nil {
			return agent.JobResult{Status: "failed", Error: err.Error()}, nil
		}
		return agent.JobResult{Status: "success", Result: map[string]interface{}{"players": out}}, nil
	default:
		return agent.JobResult{Status: "failed", Error: "unsupported job type: " + job.Type}, nil
	}
}

func resultOrErr(err error) (agent.JobResult, error) {
	if err != nil {
		return agent.JobResult{Status: "failed", Error: err.Error()}, nil
	}
	return agent.JobResult{Status: "success"}, nil
}

func payloadToConfig(p map[string]interface{}) *agent.InstanceConfig {
	if p == nil {
		return &agent.InstanceConfig{}
	}
	cfg := &agent.InstanceConfig{}
	if v, ok := p["server_instance_id"].(string); ok {
		cfg.ServerInstanceID = v
	}
	if v, ok := p["install_path"].(string); ok {
		cfg.InstallPath = v
	}
	if v, ok := p["start_command"].(string); ok {
		cfg.StartCommand = v
	}
	if v, ok := p["stop_command"].(string); ok {
		cfg.StopCommand = v
	}
	if v, ok := p["telnet_host"].(string); ok {
		cfg.TelnetHost = v
	}
	if cfg.TelnetHost == "" {
		cfg.TelnetHost = "127.0.0.1"
	}
	if v, ok := p["telnet_port"].(float64); ok {
		cfg.TelnetPort = int(v)
	} else if v, ok := p["telnet_port"].(int); ok {
		cfg.TelnetPort = v
	}
	if v, ok := p["telnet_password"].(string); ok {
		cfg.TelnetPassword = v
	}
	return cfg
}

func getString(m map[string]interface{}, key, def string) string {
	if v, ok := m[key].(string); ok {
		return v
	}
	return def
}

func (a *Adapter) withRCON(ctx context.Context, cfg *agent.InstanceConfig, fn func(*Client) error) error {
	if cfg.TelnetPassword == "" {
		return fmt.Errorf("rcon password required (telnet_password)")
	}
	port := cfg.TelnetPort
	if port <= 0 {
		port = 25575
	}
	client, err := Connect(cfg.TelnetHost, port, cfg.TelnetPassword, a.rconTimeout)
	if err != nil {
		return err
	}
	defer client.Close()
	return fn(client)
}

// startAndCheck runs cmd.Start(), then waits briefly; if the process exits within that window, returns an error.
func (a *Adapter) startAndCheck(ctx context.Context, cmd *exec.Cmd) error {
	if err := cmd.Start(); err != nil {
		return err
	}
	done := make(chan error, 1)
	go func() { done <- cmd.Wait() }()
	startupWindow := 2 * time.Second
	select {
	case err := <-done:
		if err != nil {
			return fmt.Errorf("process exited immediately: %w", err)
		}
		return fmt.Errorf("process exited immediately with code 0")
	case <-time.After(startupWindow):
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

func (a *Adapter) Start(ctx context.Context, cfg *agent.InstanceConfig) error {
	if cfg.InstallPath == "" {
		return fmt.Errorf("install_path required")
	}
	if cfg.StartCommand != "" {
		parts := strings.Fields(cfg.StartCommand)
		if len(parts) == 0 {
			return fmt.Errorf("empty start_command")
		}
		cmd := exec.CommandContext(ctx, parts[0], parts[1:]...)
		cmd.Dir = cfg.InstallPath
		return a.startAndCheck(ctx, cmd)
	}
	// Default: java -jar server.jar (or common jar name)
	jar := filepath.Join(cfg.InstallPath, "server.jar")
	if _, err := os.Stat(jar); err != nil {
		return fmt.Errorf("no start_command and server.jar not found in %q", cfg.InstallPath)
	}
	cmd := exec.CommandContext(ctx, "java", "-jar", "server.jar")
	cmd.Dir = cfg.InstallPath
	return a.startAndCheck(ctx, cmd)
}

func (a *Adapter) Stop(ctx context.Context, cfg *agent.InstanceConfig) error {
	if cfg.StopCommand != "" {
		parts := strings.Fields(cfg.StopCommand)
		if len(parts) == 0 {
			return fmt.Errorf("empty stop_command")
		}
		cmd := exec.CommandContext(ctx, parts[0], parts[1:]...)
		cmd.Dir = cfg.InstallPath
		return cmd.Run()
	}
	// Graceful: RCON "stop"
	return a.withRCON(ctx, cfg, func(c *Client) error {
		_, err := c.Exec("stop")
		return err
	})
}

func (a *Adapter) Restart(ctx context.Context, cfg *agent.InstanceConfig) error {
	if err := a.Stop(ctx, cfg); err != nil {
		return err
	}
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-time.After(3 * time.Second):
	}
	return a.Start(ctx, cfg)
}

func (a *Adapter) Status(ctx context.Context, cfg *agent.InstanceConfig) (string, error) {
	err := a.withRCON(ctx, cfg, func(c *Client) error {
		_, err := c.Exec("list")
		return err
	})
	if err != nil {
		return "stopped", nil
	}
	return "running", nil
}

func (a *Adapter) SendCommand(ctx context.Context, cfg *agent.InstanceConfig, command string) (string, error) {
	var out string
	err := a.withRCON(ctx, cfg, func(c *Client) error {
		var err error
		out, err = c.Exec(command)
		return err
	})
	return out, err
}

// listPlayers returns the output of "list" (e.g. "There are 2/20 players online: Alice, Bob").
func (a *Adapter) listPlayers(ctx context.Context, cfg *agent.InstanceConfig) (string, error) {
	return a.SendCommand(ctx, cfg, "list")
}

func (a *Adapter) StreamChat(ctx context.Context, cfg *agent.InstanceConfig, w io.Writer) error {
	return agent.ErrUnsupported
}

// sanitizeRCONArg removes metacharacters that could inject additional RCON commands.
func sanitizeRCONArg(s string) string {
	var b strings.Builder
	for _, r := range s {
		if r != ';' && r != '\n' && r != '\r' {
			b.WriteRune(r)
		}
	}
	return b.String()
}

func (a *Adapter) KickPlayer(ctx context.Context, cfg *agent.InstanceConfig, playerID string) error {
	_, err := a.SendCommand(ctx, cfg, "kick "+sanitizeRCONArg(playerID))
	return err
}

func (a *Adapter) BanPlayer(ctx context.Context, cfg *agent.InstanceConfig, playerID string, reason string) error {
	cmd := "ban " + sanitizeRCONArg(playerID)
	if reason != "" {
		cmd += " " + sanitizeRCONArg(reason)
	}
	_, err := a.SendCommand(ctx, cfg, cmd)
	return err
}

func (a *Adapter) InstallMod(ctx context.Context, cfg *agent.InstanceConfig, modID string, opts map[string]interface{}) error {
	return agent.ErrUnsupported
}

func (a *Adapter) GetLogPath(cfg *agent.InstanceConfig) (string, error) {
	if cfg.InstallPath == "" {
		return "", fmt.Errorf("install_path required")
	}
	return filepath.Join(cfg.InstallPath, "logs", "latest.log"), nil
}
