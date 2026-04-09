package execute

import (
	"context"
	"fmt"
	"strings"

	"github.com/mastermind/agent/internal/agent"
	"github.com/mastermind/agent/internal/games"
)

// RegistryExecutor dispatches jobs to the adapter selected by payload.game_type.
type RegistryExecutor struct {
	Registry *games.Registry
}

func (r *RegistryExecutor) Execute(ctx context.Context, job agent.Job) (agent.JobResult, error) {
	if r == nil || r.Registry == nil {
		return agent.JobResult{Status: "failed", Error: "adapter registry not configured"}, nil
	}
	gameType, _ := job.Payload["game_type"].(string)
	gameType = strings.ToLower(strings.TrimSpace(gameType))
	if gameType == "" {
		return agent.JobResult{Status: "failed", Error: "job payload missing game_type"}, nil
	}
	adapter := r.Registry.GetOrNoop(gameType)
	if adapter == nil {
		return agent.JobResult{Status: "failed", Error: fmt.Sprintf("no adapter for game_type %q", gameType)}, nil
	}
	return adapter.Execute(ctx, job)
}
