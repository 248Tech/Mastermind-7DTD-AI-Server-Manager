package runner

import (
	"context"
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
	// TODO: resolve command from job.Type + payload; validate against allowlist; exec with timeout
	// Stub: reject unknown types; for "exec" run payload["command"] with payload["args"]
	_ = r.AllowedCommands
	_ = r.CommandTemplate
	if r.Timeout == 0 {
		r.Timeout = 5 * time.Minute
	}
	ctx, cancel := context.WithTimeout(ctx, r.Timeout)
	defer cancel()
	// Placeholder: return success with empty output until real exec is implemented
	return agent.JobResult{
		Status: "success",
		Output: "",
		Result: nil,
	}, nil
}

// IsAllowed returns true if the command (e.g. "start") is in the allowlist.
func (r *Runner) IsAllowed(cmd string) bool {
	for _, a := range r.AllowedCommands {
		if strings.EqualFold(a, cmd) {
			return true
		}
	}
	return false
}
