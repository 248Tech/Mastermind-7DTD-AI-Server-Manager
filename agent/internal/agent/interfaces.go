package agent

import (
	"context"
	"io"
	"time"
)

// Job represents a work unit from the control plane.
type Job struct {
	ID               string                 `json:"id"`
	Type             string                 `json:"type"`
	ServerInstanceID string                 `json:"server_instance_id,omitempty"`
	Payload          map[string]interface{} `json:"payload,omitempty"`
}

// JobResult is returned after executing a job.
type JobResult struct {
	Status string                 `json:"status"` // success | failed
	Output string                 `json:"output,omitempty"`
	Result map[string]interface{} `json:"result,omitempty"`
	Error  string                 `json:"error,omitempty"`
}

// JobExecutor runs jobs (e.g. start/stop/update). Runner is the default implementation;
// game adapters can implement this for game-specific commands.
type JobExecutor interface {
	Execute(ctx context.Context, job Job) (JobResult, error)
}

// LogStreamer tails a log source and streams chunks. Used to send server logs to the control plane.
type LogStreamer interface {
	// Stream tails the given path (or identifier) and writes chunks to w.
	// Implementations should respect ctx cancellation and backpressure.
	Stream(ctx context.Context, path string, w io.Writer) error
	// Supports returns true if this streamer can handle the given path/source.
	Supports(path string) bool
}

// StreamChunk is an optional interface for streamers that emit structured chunks with metadata.
type StreamChunk struct {
	At   time.Time
	Line string
}
