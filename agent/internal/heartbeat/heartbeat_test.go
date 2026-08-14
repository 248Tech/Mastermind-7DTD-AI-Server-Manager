package heartbeat

import (
	"context"
	"net"
	"testing"
	"time"
)

func TestProbeEndpointUsesConfiguredAddress(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()

	done := make(chan struct{})
	go func() {
		conn, acceptErr := listener.Accept()
		if acceptErr == nil {
			_ = conn.Close()
		}
		close(done)
	}()

	reachable, latency := probeEndpoint(context.Background(), GameProbe{
		Address: listener.Addr().String(),
		Timeout: time.Second,
	})
	if !reachable {
		t.Fatal("configured endpoint should be reachable")
	}
	if latency < 0 {
		t.Fatalf("latency must not be negative: %f", latency)
	}
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("probe did not connect to configured listener")
	}
}

func TestProbeEndpointHonorsCancellation(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	started := time.Now()
	reachable, _ := probeEndpoint(ctx, GameProbe{
		Address: "192.0.2.1:26900",
		Timeout: time.Minute,
	})
	if reachable {
		t.Fatal("cancelled probe cannot be reachable")
	}
	if elapsed := time.Since(started); elapsed > time.Second {
		t.Fatalf("cancelled probe took too long: %s", elapsed)
	}
}
