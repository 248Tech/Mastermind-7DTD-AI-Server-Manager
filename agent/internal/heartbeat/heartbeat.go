package heartbeat

import (
	"context"
	"log/slog"
	"time"

	"github.com/mastermind/agent/internal/client"
	"github.com/mastermind/agent/internal/hostinfo"
)

// Run runs the heartbeat loop every interval until ctx is cancelled.
func Run(ctx context.Context, c client.Client, hostID string, hostName string, interval time.Duration, agentVersion string) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		meta, err := hostinfo.Gather()
		if err != nil {
			slog.Warn("heartbeat gather failed", "err", err)
			select { case <-ctx.Done(): return; case <-ticker.C: continue }
		}
		meta.Name = hostName
		meta.AgentVersion = agentVersion
		if err := c.Heartbeat(ctx, hostID, meta); err != nil {
			slog.Warn("heartbeat send failed", "err", err)
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}
