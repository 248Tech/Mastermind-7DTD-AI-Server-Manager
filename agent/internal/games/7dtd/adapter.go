package sevendtd

import (
	"context"
	"fmt"
	"io"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/mastermind/agent/internal/agent"
)

const gameSlug = "7dtd"

// Adapter implements agent.GameAdapter for 7 Days to Die (telnet admin + process control).
type Adapter struct {
	// Runner is used for Start/Stop/Restart when no custom commands are set.
	Runner *runnerShim
}

// runnerShim allows the adapter to run start/stop commands (could be replaced by agent runner).
type runnerShim struct {
	timeout time.Duration
}

func (r *runnerShim) run(ctx context.Context, dir, name string, args ...string) error {
	cmd := exec.CommandContext(ctx, name, args...)
	cmd.Dir = dir
	if r != nil && r.timeout > 0 {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, r.timeout)
		defer cancel()
	}
	return cmd.Run()
}

// NewAdapter returns a 7DTD game adapter.
func NewAdapter() *Adapter {
	return &Adapter{
		Runner: &runnerShim{timeout: 5 * time.Minute},
	}
}

func (a *Adapter) Name() string { return gameSlug }

func (a *Adapter) Capabilities() []string {
	return append([]string(nil), agent.AllCapabilities...)
}

// Execute dispatches job types to the appropriate capability (e.g. SERVER_START -> Start).
func (a *Adapter) Execute(ctx context.Context, job agent.Job) (agent.JobResult, error) {
	cfg := jobPayloadToConfig(job.Payload)
	switch strings.ToUpper(job.Type) {
	case "SERVER_START":
		return resultOrErr(a.Start(ctx, cfg))
	case "SERVER_STOP":
		return resultOrErr(a.Stop(ctx, cfg))
	case "SERVER_RESTART":
		return resultOrErr(a.Restart(ctx, cfg))
	case "RCON", "SEND_COMMAND":
		cmd := getString(job.Payload, "command", "")
		out, err := a.SendCommand(ctx, cfg, cmd)
		if err != nil {
			return agent.JobResult{Status: "failed", Error: err.Error()}, nil
		}
		return agent.JobResult{Status: "success", Output: out}, nil
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

func jobPayloadToConfig(p map[string]interface{}) *agent.InstanceConfig {
	if p == nil {
		return &agent.InstanceConfig{}
	}
	cfg := &agent.InstanceConfig{
		ServerInstanceID: getString(p, "server_instance_id", ""),
		InstallPath:       getString(p, "install_path", ""),
		StartCommand:     getString(p, "start_command", ""),
		StopCommand:      getString(p, "stop_command", ""),
		TelnetHost:       getString(p, "telnet_host", "127.0.0.1"),
		TelnetPort:       getInt(p, "telnet_port", 8081),
		TelnetPassword:   getString(p, "telnet_password", ""),
	}
	return cfg
}

func getString(m map[string]interface{}, key, def string) string {
	if v, ok := m[key].(string); ok {
		return v
	}
	return def
}

func getInt(m map[string]interface{}, key string, def int) int {
	switch v := m[key].(type) {
	case float64:
		return int(v)
	case int:
		return v
	}
	return def
}

func (a *Adapter) Start(ctx context.Context, cfg *agent.InstanceConfig) error {
	if cfg.StartCommand != "" {
		parts := strings.Fields(cfg.StartCommand)
		if len(parts) == 0 {
			return fmt.Errorf("empty start_command")
		}
		return a.Runner.run(ctx, cfg.InstallPath, parts[0], parts[1:]...)
	}
	// Default: run start.sh in install path if present
	startPath := filepath.Join(cfg.InstallPath, "start.sh")
	if _, err := os.Stat(startPath); err == nil {
		return a.Runner.run(ctx, cfg.InstallPath, "/bin/sh", startPath)
	}
	return fmt.Errorf("no start_command and no start.sh in install_path %q", cfg.InstallPath)
}

func (a *Adapter) Stop(ctx context.Context, cfg *agent.InstanceConfig) error {
	if cfg.StopCommand != "" {
		parts := strings.Fields(cfg.StopCommand)
		if len(parts) == 0 {
			return fmt.Errorf("empty stop_command")
		}
		return a.Runner.run(ctx, cfg.InstallPath, parts[0], parts[1:]...)
	}
	// Try to send "quit" via telnet for graceful shutdown
	resp, err := a.SendCommand(ctx, cfg, "quit")
	if err == nil && resp != "" {
		return nil
	}
	// Fallback: kill script or pkill (platform-dependent)
	stopPath := filepath.Join(cfg.InstallPath, "stop.sh")
	if _, err := os.Stat(stopPath); err == nil {
		return a.Runner.run(ctx, cfg.InstallPath, "/bin/sh", stopPath)
	}
	return fmt.Errorf("no stop_command, telnet quit failed, and no stop.sh")
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
	// Try telnet "status" or "version" to see if server responds
	out, err := a.SendCommand(ctx, cfg, "version")
	if err == nil && len(out) > 0 {
		return "running", nil
	}
	// Heuristic: check if log file is being written (optional)
	logPath, _ := a.GetLogPath(cfg)
	if logPath != "" {
		if fi, err := os.Stat(logPath); err == nil && fi.Size() > 0 {
			return "running", nil
		}
	}
	return "stopped", nil
}

func (a *Adapter) SendCommand(ctx context.Context, cfg *agent.InstanceConfig, command string) (string, error) {
	return sendTelnet(ctx, cfg.TelnetHost, cfg.TelnetPort, cfg.TelnetPassword, command)
}

func (a *Adapter) StreamChat(ctx context.Context, cfg *agent.InstanceConfig, w io.Writer) error {
	logPath, err := a.GetLogPath(cfg)
	if err != nil || logPath == "" {
		return agent.ErrUnsupported
	}
	// Tail log file and stream lines that look like chat (simplified: stream all)
	return tailFile(ctx, logPath, w)
}

// sanitizeRCONArg removes metacharacters that could inject additional RCON/telnet commands.
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
	cmd := "ban add " + sanitizeRCONArg(playerID)
	if reason != "" {
		cmd += " " + sanitizeRCONArg(reason)
	}
	_, err := a.SendCommand(ctx, cfg, cmd)
	return err
}

func (a *Adapter) InstallMod(ctx context.Context, cfg *agent.InstanceConfig, modID string, opts map[string]interface{}) error {
	// 7DTD mod install is typically file-based or workshop; not a single telnet command.
	return agent.ErrUnsupported
}

func (a *Adapter) GetLogPath(cfg *agent.InstanceConfig) (string, error) {
	if cfg.InstallPath == "" {
		return "", fmt.Errorf("install_path required")
	}
	// 7DTD dedicated server log path
	p := filepath.Join(cfg.InstallPath, "7DaysToDieServer_Data", "output_log.txt")
	return p, nil
}

// sendTelnet connects to 7DTD telnet, sends password, then command; returns response.
func sendTelnet(ctx context.Context, host string, port int, password, command string) (string, error) {
	addr := fmt.Sprintf("%s:%d", host, port)
	dialer := &net.Dialer{}
	conn, err := dialer.DialContext(ctx, "tcp", addr)
	if err != nil {
		return "", err
	}
	defer conn.Close()
	conn.SetDeadline(time.Now().Add(15 * time.Second))
	// 7DTD: server may send "password:" or similar; send password then command
	buf := make([]byte, 4096)
	n, _ := conn.Read(buf)
	_ = n
	if password != "" {
		if _, err := conn.Write([]byte(password + "\n")); err != nil {
			return "", err
		}
		time.Sleep(200 * time.Millisecond)
		n, _ = conn.Read(buf)
		_ = n
	}
	if _, err := conn.Write([]byte(command + "\n")); err != nil {
		return "", err
	}
	time.Sleep(500 * time.Millisecond)
	var out []byte
	for {
		conn.SetReadDeadline(time.Now().Add(2 * time.Second))
		n, err := conn.Read(buf)
		if n > 0 {
			out = append(out, buf[:n]...)
		}
		if err != nil || n == 0 {
			break
		}
	}
	return strings.TrimSpace(string(out)), nil
}

// tailFile reads the file and writes new content to w, respecting ctx (simplified: one-shot read for placeholder).
func tailFile(ctx context.Context, path string, w io.Writer) error {
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()
	_, err = io.Copy(w, f)
	return err
}
