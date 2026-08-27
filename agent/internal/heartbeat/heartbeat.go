package heartbeat

import (
	"context"
	"log/slog"
	"net"
	"time"

	"github.com/mastermind/agent/internal/backoff"
	"github.com/mastermind/agent/internal/client"
	"github.com/mastermind/agent/internal/hostinfo"
	"github.com/mastermind/agent/internal/metrics"
)

const gameProbeInterval = 15 * time.Second

// GameProbe identifies the configured game endpoint represented by the legacy
// host-level gameReachable heartbeat field. An empty address disables probing.
// The control-plane contract is host-level today, so callers must not aggregate
// multiple server instances into this value.
type GameProbe struct {
	Address      string
	Timeout      time.Duration
	CloseCommand string
}

// Run runs the heartbeat loop every interval until ctx is cancelled.
func Run(ctx context.Context, c client.Client, hostID string, hostName string, interval time.Duration, agentVersion string, probe GameProbe) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	var reachable bool
	var latencyMS float64
	var lastProbe time.Time
	retry := backoff.New(backoff.Config{})
	for {
		started := time.Now()
		meta, err := hostinfo.Gather()
		if err != nil {
			slog.Warn("heartbeat gather failed", "err", err)
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				continue
			}
		}
		meta.Name = hostName
		meta.AgentVersion = agentVersion
		if probe.Address != "" && (lastProbe.IsZero() || time.Since(lastProbe) >= gameProbeInterval) {
			reachable, latencyMS = probeEndpoint(ctx, probe)
			lastProbe = time.Now()
		}
		if probe.Address != "" {
			meta.GameReachable = reachable
			meta.LatencyMS = latencyMS
		}
		if err := c.Heartbeat(ctx, hostID, meta); err != nil {
			metrics.HeartbeatFailed()
			delay := retry.Next()
			slog.Warn("heartbeat send failed", "err", err, "retry_in", delay)
			timer := time.NewTimer(delay)
			select {
			case <-ctx.Done():
				if !timer.Stop() {
					<-timer.C
				}
				return
			case <-timer.C:
				continue
			}
		}
		retry.Reset()
		operational := metrics.Current()
		slog.Debug("heartbeat completed",
			"duration", time.Since(started),
			"goroutines", operational.Goroutines,
			"read_active", operational.ReadActive,
			"read_queued", operational.ReadQueued,
			"mutation_queued", operational.MutationQueued,
			"jobs_completed", operational.JobsCompleted,
			"jobs_failed", operational.JobsFailed,
			"heartbeat_failures", operational.HeartbeatFailures,
			"poll_failures", operational.PollFailures,
			"log_upload_bytes", operational.LogUploadBytes,
			"log_upload_failures", operational.LogUploadFailures,
			"log_backlog_bytes", operational.LogBacklogBytes,
		)
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func probeEndpoint(ctx context.Context, probe GameProbe) (bool, float64) {
	timeout := probe.Timeout
	if timeout <= 0 {
		timeout = 2 * time.Second
	}
	started := time.Now()
	dialer := net.Dialer{Timeout: timeout}
	conn, err := dialer.DialContext(ctx, "tcp", probe.Address)
	latency := float64(time.Since(started).Microseconds()) / 1000
	if conn != nil {
		if probe.CloseCommand != "" {
			// 7DTD's Telnet server writes a greeting as soon as it accepts a
			// connection.  Closing a bare TCP probe at that point resets the
			// socket and makes the game log an IOException.  End the console
			// session explicitly instead.
			_ = conn.SetDeadline(time.Now().Add(timeout))
			buf := make([]byte, 256)
			_, _ = conn.Read(buf)
			_, _ = conn.Write([]byte(probe.CloseCommand + "\n"))
			// Drain the server's remaining banner and wait for its clean EOF.
			// Closing with unread bytes would send an RST and merely turn the
			// health check back into a noisy server error.
			for {
				if _, readErr := conn.Read(buf); readErr != nil {
					break
				}
			}
		}
		_ = conn.Close()
	}
	return err == nil, latency
}
