package client

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestNewHTTPClientConfiguresReusableTransport(t *testing.T) {
	c := NewHTTPClient("http://control.invalid", "key")
	transport, ok := c.HTTPClient.Transport.(*http.Transport)
	if !ok {
		t.Fatalf("Transport type = %T, want *http.Transport", c.HTTPClient.Transport)
	}
	if transport.MaxIdleConns < 1 || transport.MaxIdleConnsPerHost < 1 {
		t.Fatalf("idle pool is not configured: total=%d per-host=%d", transport.MaxIdleConns, transport.MaxIdleConnsPerHost)
	}
	if transport.IdleConnTimeout <= 0 {
		t.Fatal("IdleConnTimeout must be positive")
	}
	if c.HTTPClient.Timeout != 0 {
		t.Fatalf("global client timeout = %s, want request-specific timeouts", c.HTTPClient.Timeout)
	}
}

func TestOrdinaryRequestIsBounded(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Respond well after the client deadline. A finite handler avoids making
		// this assertion depend on server-side disconnect detection semantics.
		time.Sleep(200 * time.Millisecond)
		w.WriteHeader(http.StatusNoContent)
	}))
	defer server.Close()

	c := NewHTTPClient(server.URL, "key")
	c.requestTimeout = 40 * time.Millisecond
	start := time.Now()
	err := c.Heartbeat(context.Background(), "host", &HostMetadata{})
	if err == nil {
		t.Fatal("Heartbeat succeeded, want timeout")
	}
	if elapsed := time.Since(start); elapsed > 500*time.Millisecond {
		t.Fatalf("Heartbeat timeout took %s", elapsed)
	}
}

func TestLongPollCanExceedOrdinaryTimeout(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(80 * time.Millisecond)
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"job":null}`)
	}))
	defer server.Close()

	c := NewHTTPClient(server.URL, "key")
	c.requestTimeout = 20 * time.Millisecond
	c.longPollGrace = 100 * time.Millisecond
	jobs, err := c.PollJobs(context.Background(), "host", 1, false)
	if err != nil {
		t.Fatalf("PollJobs error = %v", err)
	}
	if len(jobs) != 0 {
		t.Fatalf("PollJobs returned %d jobs, want none", len(jobs))
	}
}

func TestRequestCancellationStopsLongPoll(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(200 * time.Millisecond)
		w.WriteHeader(http.StatusNoContent)
	}))
	defer server.Close()

	c := NewHTTPClient(server.URL, "key")
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	start := time.Now()
	_, err := c.PollJobs(ctx, "host", 30, false)
	if err == nil {
		t.Fatal("PollJobs succeeded, want cancellation")
	}
	if elapsed := time.Since(start); elapsed > 100*time.Millisecond {
		t.Fatalf("cancelled PollJobs took %s", elapsed)
	}
}

func TestErrorBodyIsUsefulAndBounded(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusServiceUnavailable)
		_, _ = io.WriteString(w, "temporary outage\n"+strings.Repeat("x", 10*1024))
	}))
	defer server.Close()

	c := NewHTTPClient(server.URL, "key")
	err := c.Heartbeat(context.Background(), "host", &HostMetadata{})
	if err == nil || !strings.Contains(err.Error(), "temporary outage") {
		t.Fatalf("Heartbeat error = %v, want bounded response detail", err)
	}
	if len(err.Error()) > maxErrorBodyBytes+100 {
		t.Fatalf("error length = %d, want bounded response body", len(err.Error()))
	}
	if strings.Contains(err.Error(), "\n") {
		t.Fatalf("error contains newline: %q", err)
	}
}

func TestErrorBodyRedactsCommonCredentials(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = io.WriteString(w, `{"message":"bad auth","agentKey":"private-key","authorization":"Bearer private-token"}`)
	}))
	defer server.Close()

	c := NewHTTPClient(server.URL, "key")
	err := c.Heartbeat(context.Background(), "host", &HostMetadata{})
	if err == nil {
		t.Fatal("Heartbeat succeeded, want unauthorized error")
	}
	if strings.Contains(err.Error(), "private-key") || strings.Contains(err.Error(), "private-token") {
		t.Fatalf("error leaked credentials: %v", err)
	}
	if !strings.Contains(err.Error(), "bad auth") {
		t.Fatalf("error lost useful detail: %v", err)
	}
}

func TestStreamLogBytesPreservesWireContract(t *testing.T) {
	var content, instance, authorization string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		instance = r.Header.Get("X-Server-Instance-ID")
		authorization = r.Header.Get("Authorization")
		var payload map[string]string
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Errorf("decode request: %v", err)
		}
		content = payload["content"]
		w.WriteHeader(http.StatusNoContent)
	}))
	defer server.Close()

	c := NewHTTPClient(server.URL, "secret")
	if err := c.StreamLogBytes(context.Background(), "host", "server", []byte("line one\n")); err != nil {
		t.Fatalf("StreamLogBytes error = %v", err)
	}
	if content != "line one\n" || instance != "server" || authorization != "Bearer secret" {
		t.Fatalf("request content=%q instance=%q authorization=%q", content, instance, authorization)
	}
}
