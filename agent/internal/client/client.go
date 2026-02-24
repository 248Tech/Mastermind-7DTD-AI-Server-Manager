package client

import (
	"context"
	"io"
	"time"
)

// Client talks to the control plane (pairing, heartbeat, jobs, log upload).
// Auth: after pairing, use the stored agent key in Authorization header.
type Client interface {
	// Pair exchanges pairingToken for a signed agent key. On success, caller stores key at agentKeyPath.
	Pair(ctx context.Context, pairingToken string, hostMetadata *HostMetadata) (*PairResponse, error)
	// Heartbeat sends host id + metadata. Uses stored key for auth.
	Heartbeat(ctx context.Context, hostID string, meta *HostMetadata) error
	// PollJobs long-polls or short-polls for jobs for this host. Returns when at least one job is ready or timeout.
	PollJobs(ctx context.Context, hostID string, longPollSec int) ([]Job, error)
	// SubmitJobResult sends the result of a job run.
	SubmitJobResult(ctx context.Context, hostID string, jobID string, result *JobResultPayload) error
	// StreamLog uploads log chunks (e.g. multipart or chunked body). Optional for MVP.
	StreamLog(ctx context.Context, hostID string, serverInstanceID string, r io.Reader) error
}

// HostMetadata is sent at pairing and on each heartbeat.
type HostMetadata struct {
	Name        string       `json:"name,omitempty"`
	CPU         string       `json:"cpu,omitempty"`
	MemTotalMB  uint64       `json:"mem_total_mb,omitempty"`
	MemFreeMB   uint64       `json:"mem_free_mb,omitempty"`
	DiskPath    string       `json:"disk_path,omitempty"`
	DiskFreeMB  uint64       `json:"disk_free_mb,omitempty"`
	AgentVersion string      `json:"agent_version,omitempty"`
	ReportedAt  time.Time    `json:"reported_at"`
}

// PairResponse is returned on successful pairing.
type PairResponse struct {
	HostID    string `json:"host_id"`
	AgentKey  string `json:"agent_key"` // signed JWT or opaque token; store and use for subsequent requests
}

// Job is a work unit from the control plane.
type Job struct {
	ID               string                 `json:"id"`
	Type             string                 `json:"type"`
	ServerInstanceID string                 `json:"server_instance_id,omitempty"`
	Payload          map[string]interface{} `json:"payload,omitempty"`
}

// JobResultPayload is sent when submitting a job result.
type JobResultPayload struct {
	Status string                 `json:"status"`
	Output string                 `json:"output,omitempty"`
	Result map[string]interface{} `json:"result,omitempty"`
	Error  string                 `json:"error,omitempty"`
}
