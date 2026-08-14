// Package backoff provides context-aware bounded exponential retry delays.
package backoff

import (
	"context"
	"math/rand"
	"sync"
	"time"
)

const (
	defaultInitial    = time.Second
	defaultMaximum    = 30 * time.Second
	defaultMultiplier = 2
	defaultJitter     = 0.2
)

// Config controls a Backoff. Zero values select conservative agent defaults.
type Config struct {
	Initial    time.Duration
	Maximum    time.Duration
	Multiplier float64
	// Jitter is the fractional random variation applied to each delay. It must
	// be between 0 and 1. For example, 0.2 varies delays by up to 20 percent.
	Jitter float64
	// DisableJitter is primarily useful for deterministic tests.
	DisableJitter bool
}

// Backoff produces retry delays that grow after each call to Next. It is safe
// for concurrent use, although retry loops normally own one Backoff each.
type Backoff struct {
	mu         sync.Mutex
	initial    time.Duration
	maximum    time.Duration
	multiplier float64
	jitter     float64
	next       time.Duration
}

// New constructs a bounded exponential backoff.
func New(cfg Config) *Backoff {
	if cfg.Initial <= 0 {
		cfg.Initial = defaultInitial
	}
	if cfg.Maximum <= 0 {
		cfg.Maximum = defaultMaximum
	}
	if cfg.Maximum < cfg.Initial {
		cfg.Initial = cfg.Maximum
	}
	if cfg.Multiplier <= 1 {
		cfg.Multiplier = defaultMultiplier
	}
	if cfg.DisableJitter {
		cfg.Jitter = 0
	} else if cfg.Jitter <= 0 || cfg.Jitter > 1 {
		cfg.Jitter = defaultJitter
	}

	return &Backoff{
		initial:    cfg.Initial,
		maximum:    cfg.Maximum,
		multiplier: cfg.Multiplier,
		jitter:     cfg.Jitter,
		next:       cfg.Initial,
	}
}

// Next returns the next retry delay and advances the exponential sequence.
// The returned value never exceeds Maximum.
func (b *Backoff) Next() time.Duration {
	b.mu.Lock()
	defer b.mu.Unlock()

	delay := b.next
	if b.jitter > 0 {
		factor := 1 + ((rand.Float64()*2)-1)*b.jitter
		delay = time.Duration(float64(delay) * factor)
		if delay < 0 {
			delay = 0
		}
		if delay > b.maximum {
			delay = b.maximum
		}
	}

	grown := time.Duration(float64(b.next) * b.multiplier)
	if grown < b.next || grown > b.maximum {
		grown = b.maximum
	}
	b.next = grown
	return delay
}

// Reset returns the sequence to its initial delay. Call it after a successful
// control-plane request so healthy traffic is never delayed.
func (b *Backoff) Reset() {
	b.mu.Lock()
	b.next = b.initial
	b.mu.Unlock()
}

// Wait waits for the next retry delay or returns immediately when ctx is
// cancelled. It advances the sequence in the same way as Next.
func (b *Backoff) Wait(ctx context.Context) error {
	timer := time.NewTimer(b.Next())
	defer timer.Stop()
	select {
	case <-timer.C:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}
