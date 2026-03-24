package jobs

import (
	"context"
	"strings"

	"github.com/mastermind/agent/internal/agent"
	"github.com/mastermind/agent/internal/games"
)

// DispatchExecutor routes jobs to a registered game adapter when game_type is present,
// otherwise it falls back to the default executor.
type DispatchExecutor struct {
	Registry *games.Registry
	Fallback agent.JobExecutor
}

func (e *DispatchExecutor) Execute(ctx context.Context, job agent.Job) (agent.JobResult, error) {
	if e.Registry != nil {
		gameType := strings.TrimSpace(getPayloadString(job.Payload, "game_type"))
		if gameType != "" {
			if adapter := e.Registry.Get(gameType); adapter != nil {
				return adapter.Execute(ctx, job)
			}
		}
	}

	if e.Fallback != nil {
		return e.Fallback.Execute(ctx, job)
	}

	return agent.JobResult{
		Status: "failed",
		Error:  "no executor configured",
	}, nil
}

func getPayloadString(payload map[string]interface{}, key string) string {
	if payload == nil {
		return ""
	}
	v, _ := payload[key].(string)
	return v
}
