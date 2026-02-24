package pairing

import (
	"context"
	"os"
	"path/filepath"

	"github.com/mastermind/agent/internal/client"
	"github.com/mastermind/agent/internal/hostinfo"
)

// Do performs pairing: exchange token for agent key, then store key at keyPath.
// Returns hostID and agentKey on success.
func Do(ctx context.Context, c client.Client, pairingToken string, keyPath string, hostName string) (hostID string, agentKey string, err error) {
	meta, err := hostinfo.Gather()
	if err != nil {
		return "", "", err
	}
	meta.Name = hostName
	resp, err := c.Pair(ctx, pairingToken, meta)
	if err != nil {
		return "", "", err
	}
	dir := filepath.Dir(keyPath)
	if err := os.MkdirAll(dir, 0700); err != nil {
		return "", "", err
	}
	if err := os.WriteFile(keyPath, []byte(resp.AgentKey), 0600); err != nil {
		return "", "", err
	}
	return resp.HostID, resp.AgentKey, nil
}
