package jobs

import (
	"context"
	"log/slog"
	"time"

	"github.com/mastermind/agent/internal/agent"
	"github.com/mastermind/agent/internal/client"
)

// Loop polls for jobs and executes them via the given JobExecutor until ctx is cancelled.
func Loop(ctx context.Context, c client.Client, hostID string, pollIntervalSec int, longPollSec int, exec agent.JobExecutor) {
	for {
		jobs, err := c.PollJobs(ctx, hostID, longPollSec)
		if err != nil {
			slog.Warn("poll jobs failed", "err", err)
			select {
			case <-ctx.Done():
				return
			case <-time.After(time.Duration(pollIntervalSec) * time.Second):
				continue
			}
		}
		for _, j := range jobs {
			runOne(ctx, c, hostID, j, exec)
		}
		select {
		case <-ctx.Done():
			return
		default:
		}
	}
}

func runOne(ctx context.Context, c client.Client, hostID string, j client.Job, exec agent.JobExecutor) {
	job := agent.Job{
		ID:               j.ID,
		Type:             j.Type,
		ServerInstanceID: j.ServerInstanceID,
		Payload:          j.Payload,
	}
	result, err := exec.Execute(ctx, job)
	if err != nil {
		_ = c.SubmitJobResult(ctx, hostID, j.ID, &client.JobResultPayload{
			Status: "failed",
			Error:  err.Error(),
		})
		return
	}
	_ = c.SubmitJobResult(ctx, hostID, j.ID, &client.JobResultPayload{
		Status: result.Status,
		Output: result.Output,
		Result: result.Result,
		Error:  result.Error,
	})
}
