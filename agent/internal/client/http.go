package client

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
)

// HTTPClient is the default Client implementation.
type HTTPClient struct {
	BaseURL    string
	AgentKey   string // loaded from file after pairing
	HTTPClient *http.Client
}

// NewHTTPClient creates a client. AgentKey can be empty before pairing; set after Pair succeeds.
func NewHTTPClient(baseURL string, agentKey string) *HTTPClient {
	return &HTTPClient{
		BaseURL:  baseURL,
		AgentKey: agentKey,
		HTTPClient: &http.Client{
			Timeout: 30 * time.Second,
		},
	}
}

// Pair implements Client.
func (c *HTTPClient) Pair(ctx context.Context, pairingToken string, meta *HostMetadata) (*PairResponse, error) {
	meta.ReportedAt = time.Now().UTC()
	body, err := json.Marshal(map[string]interface{}{
		"pairingToken": pairingToken,
		"hostMetadata": meta,
	})
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.BaseURL+"/api/agent/pair", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.HTTPClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("pair: %s", resp.Status)
	}
	var out PairResponse
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return nil, err
	}
	return &out, nil
}

// Heartbeat implements Client.
func (c *HTTPClient) Heartbeat(ctx context.Context, hostID string, meta *HostMetadata) error {
	meta.ReportedAt = time.Now().UTC()
	heartbeat := map[string]interface{}{
		"metrics": map[string]interface{}{
			"agentVersion": meta.AgentVersion,
		},
	}
	body, _ := json.Marshal(heartbeat)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.BaseURL+"/api/agent/hosts/"+url.PathEscape(hostID)+"/heartbeat", bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+c.AgentKey)
	resp, err := c.HTTPClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("heartbeat: %s", resp.Status)
	}
	return nil
}

// PollJobs implements Client. Uses GET with timeout query for long-poll.
func (c *HTTPClient) PollJobs(ctx context.Context, hostID string, longPollSec int) ([]Job, error) {
	url := c.BaseURL + "/api/agent/hosts/" + hostID + "/jobs/poll"
	if longPollSec > 0 {
		url += fmt.Sprintf("?wait=%d", longPollSec)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+c.AgentKey)
	resp, err := c.HTTPClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("poll jobs: %s", resp.Status)
	}
	rawBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	trimmed := bytes.TrimSpace(rawBody)
	if len(trimmed) == 0 {
		return nil, nil
	}

	// Backward/forward compatibility:
	// - legacy: [job, ...]
	// - current: { "job": { ... } } or { "jobs": [ ... ] }
	if trimmed[0] == '[' {
		var list []Job
		if err := json.Unmarshal(trimmed, &list); err != nil {
			return nil, err
		}
		return list, nil
	}

	var envelope struct {
		Job  *Job  `json:"job"`
		Jobs []Job `json:"jobs"`
	}
	if err := json.Unmarshal(trimmed, &envelope); err != nil {
		return nil, err
	}
	if envelope.Job != nil {
		return []Job{*envelope.Job}, nil
	}
	if len(envelope.Jobs) > 0 {
		return envelope.Jobs, nil
	}
	return nil, nil
}

// SubmitJobResult implements Client.
func (c *HTTPClient) SubmitJobResult(ctx context.Context, hostID string, runID string, result *JobResultPayload) error {
	body, _ := json.Marshal(result)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.BaseURL+"/api/agent/hosts/"+hostID+"/jobs/"+runID+"/result", bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+c.AgentKey)
	resp, err := c.HTTPClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("submit result: %s", resp.Status)
	}
	return nil
}

// StreamLog implements Client.
func (c *HTTPClient) StreamLog(ctx context.Context, hostID string, serverInstanceID string, r io.Reader) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.BaseURL+"/api/agent/hosts/"+hostID+"/log", r)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+c.AgentKey)
	req.Header.Set("X-Server-Instance-ID", serverInstanceID)
	resp, err := c.HTTPClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("stream log: %s", resp.Status)
	}
	return nil
}

// LoadAgentKey reads the stored key from path (after pairing).
func LoadAgentKey(path string) (string, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(string(b)), nil
}
