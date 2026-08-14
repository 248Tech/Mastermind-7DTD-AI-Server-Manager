package config

import "testing"

func TestDefaultsMaxConcurrentReads(t *testing.T) {
	for _, configured := range []int{0, -1} {
		cfg := &Config{Jobs: JobsCfg{MaxConcurrentReads: configured}}
		cfg.Defaults()
		if cfg.Jobs.MaxConcurrentReads != 8 {
			t.Fatalf("configured %d: max concurrent reads = %d, want 8", configured, cfg.Jobs.MaxConcurrentReads)
		}
	}

	cfg := &Config{Jobs: JobsCfg{MaxConcurrentReads: 3}}
	cfg.Defaults()
	if cfg.Jobs.MaxConcurrentReads != 3 {
		t.Fatalf("explicit max concurrent reads = %d, want 3", cfg.Jobs.MaxConcurrentReads)
	}
}

func TestEnvMaxConcurrentReads(t *testing.T) {
	t.Setenv("MASTERMIND_JOBS_MAX_CONCURRENT_READS", "4")
	cfg := &Config{}
	cfg.Defaults()
	cfg.Env()
	if cfg.Jobs.MaxConcurrentReads != 4 {
		t.Fatalf("environment max concurrent reads = %d, want 4", cfg.Jobs.MaxConcurrentReads)
	}
}

func TestEnvRejectsInvalidMaxConcurrentReads(t *testing.T) {
	for _, value := range []string{"bad", "0", "-2"} {
		t.Run(value, func(t *testing.T) {
			t.Setenv("MASTERMIND_JOBS_MAX_CONCURRENT_READS", value)
			cfg := &Config{}
			cfg.Defaults()
			cfg.Env()
			if cfg.Jobs.MaxConcurrentReads != 8 {
				t.Fatalf("environment %q changed max concurrent reads to %d", value, cfg.Jobs.MaxConcurrentReads)
			}
		})
	}
}

func TestDefaultsClampUnsafeJobSettings(t *testing.T) {
	cfg := &Config{Jobs: JobsCfg{LongPollSec: 3600, MaxConcurrentReads: 10000}}
	cfg.Defaults()
	if cfg.Jobs.LongPollSec != maxLongPollSeconds {
		t.Fatalf("long poll = %d, want %d", cfg.Jobs.LongPollSec, maxLongPollSeconds)
	}
	if cfg.Jobs.MaxConcurrentReads != maxConcurrentReads {
		t.Fatalf("max concurrent reads = %d, want %d", cfg.Jobs.MaxConcurrentReads, maxConcurrentReads)
	}

	cfg = &Config{Jobs: JobsCfg{LongPollSec: -1}}
	cfg.Defaults()
	if cfg.Jobs.LongPollSec != 0 {
		t.Fatalf("negative long poll = %d, want 0", cfg.Jobs.LongPollSec)
	}
}
