package backoff

import (
	"context"
	"errors"
	"testing"
	"time"
)

func TestGrowthCapAndReset(t *testing.T) {
	b := New(Config{Initial: 10 * time.Millisecond, Maximum: 35 * time.Millisecond, Multiplier: 2, DisableJitter: true})
	want := []time.Duration{10 * time.Millisecond, 20 * time.Millisecond, 35 * time.Millisecond, 35 * time.Millisecond}
	for i, expected := range want {
		if got := b.Next(); got != expected {
			t.Fatalf("Next %d = %s, want %s", i, got, expected)
		}
	}
	b.Reset()
	if got := b.Next(); got != 10*time.Millisecond {
		t.Fatalf("Next after Reset = %s, want 10ms", got)
	}
}

func TestMaximumAlsoBoundsInitialDelay(t *testing.T) {
	b := New(Config{Initial: time.Second, Maximum: 25 * time.Millisecond, DisableJitter: true})
	if got := b.Next(); got != 25*time.Millisecond {
		t.Fatalf("Next = %s, want configured 25ms maximum", got)
	}
}

func TestJitterStaysWithinBounds(t *testing.T) {
	b := New(Config{Initial: time.Second, Maximum: 2 * time.Second, Multiplier: 2, Jitter: 0.25})
	for i := 0; i < 100; i++ {
		b.Reset()
		got := b.Next()
		if got < 750*time.Millisecond || got > 1250*time.Millisecond {
			t.Fatalf("jittered delay %s outside [750ms, 1.25s]", got)
		}
	}

	// Even positive jitter at the exponential cap cannot exceed Maximum.
	b.Next()
	for i := 0; i < 100; i++ {
		if got := b.Next(); got > 2*time.Second {
			t.Fatalf("capped delay = %s, want <= 2s", got)
		}
	}
}

func TestWaitCancellation(t *testing.T) {
	b := New(Config{Initial: time.Minute, Maximum: time.Minute, DisableJitter: true})
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	start := time.Now()
	err := b.Wait(ctx)
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("Wait error = %v, want context.Canceled", err)
	}
	if elapsed := time.Since(start); elapsed > 100*time.Millisecond {
		t.Fatalf("cancelled Wait took %s", elapsed)
	}
}
