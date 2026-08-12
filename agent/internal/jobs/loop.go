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
	mutationQueue := make(chan client.Job, 64)
	go func() {
		for {
			select {
			case <-ctx.Done():
				return
			case job := <-mutationQueue:
				runOne(ctx, c, hostID, job, exec)
			}
		}
	}()
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
			if isReadOnly(j.Type) {
				go runOne(ctx, c, hostID, j, exec)
			} else {
				select {
				case mutationQueue <- j:
				case <-ctx.Done():
					return
				}
			}
		}
		select {
		case <-ctx.Done():
			return
		default:
		}
	}
}

// Inventory reads can run during a long restart or backup. All state-changing
// jobs remain strictly ordered through the single mutation worker above.
func isReadOnly(jobType string) bool {
	switch jobType {
	case "MOD_LIST", "MOD_QUARANTINE_LIST", "MOD_CONFIG_READ", "PLAYER_LIST_SYNC", "PLAYER_ADMIN_LIST", "RCON", "SEND_COMMAND":
		return true
	default:
		return false
	}
}

func runOne(ctx context.Context, c client.Client, hostID string, j client.Job, exec agent.JobExecutor) {
	started := time.Now()
	jobCtx := agent.WithProgressReporter(ctx, func(phase, message string) {
		if err := c.SubmitJobProgress(ctx, hostID, j.ID, phase, message); err != nil {
			slog.Warn("report job progress failed", "jobRunId", j.ID, "err", err)
		}
	})
	job := agent.Job{
		ID:               j.ID,
		Type:             j.Type,
		ServerInstanceID: j.ServerInstanceID,
		Payload:          j.Payload,
		ScheduleID:       j.ScheduleID,
	}
	result, err := exec.Execute(jobCtx, job)
	if err != nil {
		_ = c.SubmitJobResult(ctx, hostID, j.ID, &client.JobResultPayload{
			Status:       "failed",
			ErrorMessage: err.Error(),
			DurationMs:   time.Since(started).Milliseconds(),
		})
		return
	}
	errorMessage := result.Error
	if result.Result != nil {
		if errValue, ok := result.Result["error"].(string); ok && errorMessage == "" {
			errorMessage = errValue
		}
	}
	_ = c.SubmitJobResult(ctx, hostID, j.ID, &client.JobResultPayload{
		Status:       result.Status,
		Output:       result.Output,
		Result:       result.Result,
		ErrorMessage: errorMessage,
		DurationMs:   time.Since(started).Milliseconds(),
	})
}
