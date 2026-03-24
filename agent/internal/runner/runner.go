package runner

import (
	"bytes"
	"context"
	"fmt"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/mastermind/agent/internal/agent"
)

// Runner executes local commands (allowlist, timeout). Implements agent.JobExecutor.
type Runner struct {
	AllowedCommands []string      // e.g. ["start", "stop", "update"]
	Timeout         time.Duration // per-job timeout
	// CommandTemplate: optional map job type -> command line (e.g. type "start" -> "/opt/7dtd/start.sh")
	CommandTemplate map[string]string
}

// Execute runs the job. For type "exec", payload may contain "command" and "args"; otherwise uses CommandTemplate.
func (r *Runner) Execute(ctx context.Context, job agent.Job) (agent.JobResult, error) {
	if r.Timeout == 0 {
		r.Timeout = 5 * time.Minute
	}

	ctx, cancel := context.WithTimeout(ctx, r.Timeout)
	defer cancel()

	cmdName, cmdArgs, err := r.resolveCommand(job)
	if err != nil {
		return agent.JobResult{
			Status: "failed",
			Error:  err.Error(),
		}, nil
	}

	allowedKey := filepath.Base(cmdName)
	if !r.IsAllowed(cmdName) && !r.IsAllowed(allowedKey) {
		return agent.JobResult{
			Status: "failed",
			Error:  fmt.Sprintf("command %q is not in allowlist", cmdName),
		}, nil
	}

	cmd := exec.CommandContext(ctx, cmdName, cmdArgs...)
	if cwd := getPayloadString(job.Payload, "cwd"); cwd != "" {
		cmd.Dir = cwd
	}

	var output bytes.Buffer
	cmd.Stdout = &output
	cmd.Stderr = &output

	if err := cmd.Run(); err != nil {
		return agent.JobResult{
			Status: "failed",
			Output: strings.TrimSpace(output.String()),
			Error:  err.Error(),
		}, nil
	}

	return agent.JobResult{
		Status: "success",
		Output: strings.TrimSpace(output.String()),
		Result: nil,
	}, nil
}

// IsAllowed returns true if the command (e.g. "start") is in the allowlist.
func (r *Runner) IsAllowed(cmd string) bool {
	if len(r.AllowedCommands) == 0 {
		return true
	}
	for _, a := range r.AllowedCommands {
		if strings.EqualFold(a, cmd) {
			return true
		}
	}
	return false
}

func (r *Runner) resolveCommand(job agent.Job) (string, []string, error) {
	switch strings.ToUpper(strings.TrimSpace(job.Type)) {
	case "SERVER_START", "START":
		return r.resolveTemplate("start")
	case "SERVER_STOP", "STOP":
		return r.resolveTemplate("stop")
	case "SERVER_RESTART", "RESTART":
		if cmd, args, err := r.resolveTemplate("restart"); err == nil {
			return cmd, args, nil
		}
		return "", nil, fmt.Errorf("restart command template is not configured")
	case "SERVER_UPDATE", "UPDATE":
		return r.resolveTemplate("update")
	case "RCON", "SEND_COMMAND", "EXEC", "CUSTOM":
		cmdName := getPayloadString(job.Payload, "command")
		if cmdName == "" {
			return "", nil, fmt.Errorf("payload.command is required for %s jobs", job.Type)
		}
		return cmdName, getPayloadArgs(job.Payload, "args"), nil
	default:
		// Fallback: try lower-case template key from type value.
		return r.resolveTemplate(strings.ToLower(strings.TrimSpace(job.Type)))
	}
}

func (r *Runner) resolveTemplate(key string) (string, []string, error) {
	if r.CommandTemplate == nil {
		return "", nil, fmt.Errorf("no command template configured for %q", key)
	}
	template, ok := r.CommandTemplate[key]
	if !ok || strings.TrimSpace(template) == "" {
		return "", nil, fmt.Errorf("no command template configured for %q", key)
	}
	parts := strings.Fields(template)
	if len(parts) == 0 {
		return "", nil, fmt.Errorf("empty command template for %q", key)
	}
	return parts[0], parts[1:], nil
}

func getPayloadString(payload map[string]interface{}, key string) string {
	if payload == nil {
		return ""
	}
	if v, ok := payload[key].(string); ok {
		return strings.TrimSpace(v)
	}
	return ""
}

func getPayloadArgs(payload map[string]interface{}, key string) []string {
	if payload == nil {
		return nil
	}
	raw, ok := payload[key]
	if !ok || raw == nil {
		return nil
	}

	switch vv := raw.(type) {
	case []string:
		return append([]string(nil), vv...)
	case []interface{}:
		out := make([]string, 0, len(vv))
		for _, item := range vv {
			if s, ok := item.(string); ok {
				out = append(out, s)
			}
		}
		return out
	default:
		return nil
	}
}
